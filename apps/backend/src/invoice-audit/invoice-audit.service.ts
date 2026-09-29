import { Injectable } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripRepository } from "../trips/trip.repository";
import {
  InvoiceRowStatus,
  type InvoiceRowMatch,
} from "./matching/invoice-row-matching.service";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "./pricing/invoice-reconciliation";
import {
  InvoiceAuditResultDto,
  toInvoiceAuditRowDto,
  toInvoiceAuditSummaryDto,
  toMissingTripDto,
} from "./dto/invoice-audit.dto";
import { InvalidInvoiceFileException } from "./exceptions/invoice-audit.exceptions";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import {
  MissingTripsService,
  type MissingTrip,
} from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { toFirstAddedRowNumber } from "./workbook/invoice-row-appender";
import {
  InvoiceSheetReader,
  type OpenedInvoiceWorkbook,
} from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";
import { toInvoicePeriod } from "./workbook/invoice-sheet";

/** What the final processing produced. */
export interface AppliedInvoiceAudit {
  readonly fileName: string;
  /** The corrected document, ready to be handed to the browser. */
  readonly workbook: Buffer;
  readonly result: InvoiceAuditResultDto;
  readonly cellsWritten: number;
  readonly rowsAdded: number;
  readonly rowsMarked: number;
  /** The Trips this run settled. */
  readonly paidTripIds: readonly string[];
  readonly paidTrips: number;
  readonly alreadyPaid: number;
  readonly notPayableLines: number;
}

/** Everything one reading of a document produced, before anything is written. */
interface ExaminedInvoice {
  readonly opened: OpenedInvoiceWorkbook;
  readonly pricing: ReadonlyMap<number, InvoiceRowPricing>;
  readonly missing: readonly MissingTrip[];
  readonly matches: readonly InvoiceRowMatch[];
  readonly result: InvoiceAuditResultDto;
}

interface PaymentOutcome {
  readonly paidTripIds: readonly string[];
  readonly paidTrips: number;
  readonly alreadyPaid: number;
  readonly notPayableLines: number;
}

/** An uploaded file, as multer hands it over. */
export interface UploadedInvoiceFile {
  readonly originalname?: string;
  readonly buffer?: Buffer;
  readonly size?: number;
}

/**
 * Every XLSX begins with the ZIP local-file header, because an XLSX IS a ZIP.
 *
 * Checked in the bytes rather than in the declared content type, for the same
 * reason the PDF upload checks `%PDF-`: the content type is whatever the client
 * chose to write. This does not prove the file is a workbook — a .docx starts
 * the same way — so it is only the first gate; opening it as a workbook is the
 * real test, and that failure has its own message.
 */
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** What the upload accepts, in the words a refusal uses. */
const XLSX_EXTENSION = ".xlsx";

/**
 * Checks a customer's weekly invoice against what this system holds.
 *
 * ── THIS PHASE READS, AND ONLY READS ────────────────────────────────────────
 * It uploads, reads, identifies and matches. It does not correct a price, does
 * not mark anything paid, does not add a missing transport and does not touch
 * the uploaded file — which is kept in memory for the length of the request and
 * never written to disk. Every one of those is the next phase, and the result
 * of this one is deliberately shaped so they can be built on it: each line
 * carries its own Excel row number.
 *
 * ── AND NOTHING IS STORED ───────────────────────────────────────────────────
 * No audit table, no upload history. The invoice is the customer's record and
 * the result is a view of it; keeping a copy would be a second truth that could
 * disagree with the file an operator is holding.
 */
@Injectable()
export class InvoiceAuditService {
  constructor(
    private readonly reader: InvoiceSheetReader,
    private readonly matching: InvoiceRowMatchingService,
    private readonly pricing: InvoicePricingService,
    private readonly missingTrips: MissingTripsService,
    private readonly writer: InvoiceSheetWriter,
    private readonly trips: TripRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceAuditService.name);
  }

  async check(file: UploadedInvoiceFile | undefined): Promise<InvoiceAuditResultDto> {
    return (await this.examine(file)).result;
  }

  /**
   * The final processing: the corrected document, and the payments it implies.
   *
   * ── THE ORDER IS THE SAFETY ───────────────────────────────────────────────
   * Everything that can fail happens BEFORE anything is written to this system.
   * The workbook is corrected, the missing transports are added, the problem
   * lines are marked and the whole file is SERIALISED — and only once those
   * bytes exist does a single statement mark the transports paid. A document
   * this system cannot produce therefore settles nothing, which is the failure
   * an operator can simply retry.
   *
   * The reverse — paying first and then failing to produce the file — would
   * leave a week marked paid with nothing to send the customer, and no way to
   * tell from the data that it had happened.
   */
  async apply(
    file: UploadedInvoiceFile | undefined,
  ): Promise<AppliedInvoiceAudit> {
    const examined = await this.examine(file);
    const written = this.writer.apply(
      examined.opened.workbook,
      examined.opened.worksheet,
      examined.opened.sheet,
      examined.pricing,
      examined.missing,
      toProblemRowNumbers(examined.result),
    );

    // The bytes first. A failure here throws before a single Trip is touched.
    const workbook = Buffer.from(
      await examined.opened.workbook.xlsx.writeBuffer(),
    );

    const payment = await this.pay(examined);

    this.logger.log("Invoice processed", {
      fileName: examined.result.fileName,
      cellsWritten: written.cellsWritten,
      rowsAdded: written.rowsAdded,
      rowsMarked: written.rowsMarked,
      ...payment,
    });

    return {
      fileName: examined.result.fileName,
      workbook,
      result: examined.result,
      cellsWritten: written.cellsWritten,
      rowsAdded: written.rowsAdded,
      rowsMarked: written.rowsMarked,
      ...payment,
    };
  }

  /**
   * Marks the transports this invoice settles as paid.
   *
   * ── WHICH ONES, EXACTLY ───────────────────────────────────────────────────
   * A line of the customer's own document that matched exactly one CLOSED Trip
   * AND whose pricing was reconciled — whether it already agreed or had to be
   * corrected. A price that was wrong is not a reason to leave a transport
   * unpaid; it is a reason to correct the invoice, which is what happened.
   *
   * Never: a line with no Trip, one whose Trip is unfinished, one that matched
   * several, one whose difference could not be placed on a cell, or a row that
   * states too little to be a line at all.
   *
   * And never the transports ADDED below the invoice. They were not on the
   * document the customer sent, so nothing has been paid for them — they are
   * there so the next invoice is complete, and they stay unpaid until one
   * settles them.
   */
  private async pay(examined: ExaminedInvoice): Promise<PaymentOutcome> {
    /**
     * ── THE WHOLE RULE, IN ONE PLACE ──────────────────────────────────────
     * Every condition is stated here rather than implied, so that a change
     * elsewhere cannot quietly widen what an invoice settles:
     *
     *   * the line is the CUSTOMER'S OWN — never one this system added to the
     *     document because their invoice had forgotten the transport;
     *   * it matched exactly one Trip;
     *   * that Trip is CLOSED;
     *   * and its pricing was reconciled, whether it already agreed or had to
     *     be corrected.
     */
    const settled = (match: InvoiceRowMatch): boolean => {
      const outcome = examined.pricing.get(match.row.rowNumber);

      return (
        match.status !== InvoiceRowStatus.ADDED_MISSING &&
        match.status === InvoiceRowStatus.MATCHED &&
        match.trip !== null &&
        match.trip.status === TripStatus.CLOSED &&
        (outcome?.status === InvoicePricingStatus.MATCHED_NO_CHANGES ||
          outcome?.status === InvoicePricingStatus.PRICING_CORRECTED)
      );
    };

    /*
     * ── THE VERDICT BELONGS TO THE TRANSPORT, NOT TO THE ROW ────────────────
     * One transport may be charged on several lines — its own, and one per Cost
     * Confirmation — and they are settled together or not at all. So a Trip is
     * paid only when EVERY line charging it came out settled: an EK total that
     * could not be placed on one of two rows leaves the whole transport
     * unsettled, even though the other row had nothing wrong with it.
     */
    const byTrip = new Map<string, InvoiceRowMatch[]>();

    for (const match of examined.matches) {
      if (match.trip === null) {
        continue;
      }

      byTrip.set(match.trip.id, [...(byTrip.get(match.trip.id) ?? []), match]);
    }

    const payable = [...byTrip.entries()].filter(([, matches]) =>
      matches.every(settled),
    );

    const paidTripIds = payable.map(([tripId]) => tripId);
    const alreadyPaid = payable
      .filter(([, matches]) => matches[0].trip!.isPaid)
      .map(([tripId]) => tripId);
    const toPay = paidTripIds.filter((tripId) => !alreadyPaid.includes(tripId));

    const paidTrips = await this.trips.setPaidMany(toPay);
    const notPayableLines = examined.matches.filter(
      (match) => !settled(match),
    ).length;

    /*
     * An identifier-level audit: how many were settled, how many already were,
     * and how many lines were deliberately left alone. No amount is logged —
     * what a transport costs is commercial data.
     */
    this.logger.log("Invoice payments applied", {
      paidTrips,
      alreadyPaid: alreadyPaid.length,
      notPayableLines,
    });

    return {
      paidTripIds: toPay,
      paidTrips,
      alreadyPaid: alreadyPaid.length,
      notPayableLines,
    };
  }

  /**
   * Read, match, compare — the whole judgement, without writing anything.
   *
   * One path for both endpoints, so the corrected document can never be based
   * on a different reading than the report that described it.
   */
  private async examine(
    file: UploadedInvoiceFile | undefined,
  ): Promise<ExaminedInvoice> {
    const { buffer, fileName } = this.requireWorkbook(file);
    const opened = await this.reader.open(buffer, fileName);
    /*
     * The document's own record of the lines this system wrote into it goes
     * into the match, so those lines come back as ADDED_MISSING rather than as
     * ordinary invoice lines — priced like any other, never settled.
     */
    const matches = await this.matching.match(
      opened.sheet.rows,
      opened.sheet.addedByAudit,
    );
    const pricing = await this.pricing.reconcile(matches, opened.sheet.columns);
    const period = toInvoicePeriod(opened.sheet.rows);
    /*
     * Compared against EVERY line the document states, not only the matched
     * ones: a line that found no Trip still names a transport, and adding a row
     * for it would put the same transport on the invoice twice.
     */
    const missing = await this.missingTrips.find(period, opened.sheet.rows);
    // Where each of them will be written. Pure arithmetic over the sheet, so the
    // report and the corrected workbook cannot disagree about it.
    const firstAddedRowNumber = toFirstAddedRowNumber(opened.sheet);

    this.logger.log("Invoice checked", {
      fileName,
      lineCount: opened.sheet.rows.length,
      periodFrom: period?.from ?? null,
      periodTo: period?.to ?? null,
    });

    return {
      opened,
      pricing,
      missing,
      matches,
      result: {
        fileName,
        sheetName: opened.sheet.sheetName,
        period,
        summary: toInvoiceAuditSummaryDto(matches, pricing, missing.length),
        rows: matches.map((match) =>
          toInvoiceAuditRowDto(match, pricing.get(match.row.rowNumber)),
        ),
        incompleteRowNumbers: [...opened.sheet.incompleteRowNumbers],
        missingTrips: missing.map((trip, index) =>
          toMissingTripDto(trip, firstAddedRowNumber + index),
        ),
      } satisfies InvoiceAuditResultDto,
    };
  }

  /**
   * The uploaded file, once it is worth opening.
   *
   * The name is used for the report and nothing else — never as a path, never
   * to decide the period. `basename` strips any directory a client put in it,
   * so a name like `../../etc/passwd` is simply a name.
   */
  private requireWorkbook(file: UploadedInvoiceFile | undefined): {
    buffer: Buffer;
    fileName: string;
  } {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new InvalidInvoiceFileException("no file was uploaded");
    }

    const fileName = toSafeFileName(file.originalname);

    if (!fileName.toLowerCase().endsWith(XLSX_EXTENSION)) {
      throw new InvalidInvoiceFileException(
        `only ${XLSX_EXTENSION} workbooks are accepted`,
      );
    }

    if (!file.buffer.subarray(0, ZIP_HEADER.length).equals(ZIP_HEADER)) {
      this.logger.warn("Invoice upload refused on its content", { fileName });

      throw new InvalidInvoiceFileException("the file is not an Excel workbook");
    }

    return { buffer: file.buffer, fileName };
  }
}

/**
 * The lines the corrected document marks yellow.
 *
 * The three the match could not resolve, and the one whose difference no cell
 * may carry. A line that was matched and priced is not marked, however much its
 * amounts had to change — a correction is an answer, not a problem.
 *
 * A line this system added is not marked either: it is not a problem, it is what
 * the invoice was missing. Stated as its own name rather than left to "anything
 * that is not MATCHED", which is what it used to be.
 */
const PROBLEM_STATUSES: readonly InvoiceRowStatus[] = [
  InvoiceRowStatus.NOT_FOUND,
  InvoiceRowStatus.NOT_FINISHED,
  InvoiceRowStatus.AMBIGUOUS,
];

function toProblemRowNumbers(result: InvoiceAuditResultDto): number[] {
  return result.rows
    .filter(
      (row) =>
        PROBLEM_STATUSES.includes(row.status) ||
        row.pricingStatus === InvoicePricingStatus.NOT_DISTRIBUTABLE,
    )
    .map((row) => row.rowNumber);
}

/** A file name with any path a client sent stripped off. */
function toSafeFileName(originalName: string | undefined): string {
  if (!originalName) {
    return "";
  }

  const withoutPath = originalName.split(/[\\/]/).pop() ?? "";

  return withoutPath.trim();
}
