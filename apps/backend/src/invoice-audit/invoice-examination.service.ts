import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { InvalidInvoiceFileException } from "./exceptions/invoice-audit.exceptions";
import { InvoiceRowMatchingService, type InvoiceRowMatch } from "./matching/invoice-row-matching.service";
import type { AddedRow } from "./missing/added-rows";
import { AddedRowsService } from "./missing/added-rows.service";
import { toBlockingIdentities } from "./missing/missing-trip-blocking";
import { MissingTripsService, type BlockedMissingTrip } from "./missing/missing-trips.service";
import type { InvoiceRowPricing } from "./pricing/invoice-reconciliation";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceRemarksService } from "./remarks/invoice-remarks.service";
import type { RemarkChange } from "./remarks/remark-plan";
import { planFuelHeader, type FuelHeaderChange } from "./workbook/fuel-header";
import { toFirstAddedRowNumber } from "./workbook/added-row-template";
import { toInvoicePeriod, type InvoicePeriod } from "./workbook/invoice-sheet";
import { InvoiceSheetReader, type OpenedInvoiceWorkbook } from "./workbook/invoice-sheet.reader";
import { checkTotalsStructure, type TotalsStructure } from "./workbook/totals-structure";

/** An uploaded file, as multer hands it over. */
export interface UploadedInvoiceFile {
  readonly originalname?: string;
  readonly buffer?: Buffer;
  readonly size?: number;
}

/** Everything one reading of a document decided, before anything is written. */
export interface ExaminedInvoice {
  readonly fileName: string;
  /** The document as received, byte for byte — what the written file is held against. */
  readonly received: Buffer;
  readonly opened: OpenedInvoiceWorkbook;
  readonly period: InvoicePeriod | null;
  readonly matches: readonly InvoiceRowMatch[];
  readonly pricing: ReadonlyMap<number, InvoiceRowPricing>;
  readonly remarks: ReadonlyMap<number, RemarkChange>;
  /** Every missing transport, as the line it would be. */
  readonly missing: readonly AddedRow[];
  readonly blocked: readonly BlockedMissingTrip[];
  readonly structure: TotalsStructure;
  /** The lines that ARE added — none when the totals cannot take them. */
  readonly added: readonly AddedRow[];
  /** Where the first added line goes; null when none can be added. */
  readonly firstAddedRowNumber: number | null;
  readonly fuelHeader: FuelHeaderChange | null;
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
 * Read, match, compare, plan — the whole judgement of one document, without
 * writing anything anywhere.
 *
 * ── ONE PATH FOR EVERY ENDPOINT ─────────────────────────────────────────────
 * The preview, the corrected file and the payment confirmation all start here,
 * so none of them can be based on a different reading than the others. The
 * confirmation in particular examines the document AGAIN rather than trusting
 * anything a browser kept from the preview.
 */
@Injectable()
export class InvoiceExaminationService {
  constructor(
    private readonly reader: InvoiceSheetReader,
    private readonly matching: InvoiceRowMatchingService,
    private readonly pricing: InvoicePricingService,
    private readonly remarks: InvoiceRemarksService,
    private readonly missingTrips: MissingTripsService,
    private readonly addedRows: AddedRowsService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceExaminationService.name);
  }

  async examine(file: UploadedInvoiceFile | undefined): Promise<ExaminedInvoice> {
    const { buffer, fileName } = this.requireWorkbook(file);
    const opened = await this.reader.open(buffer, fileName);
    /*
     * The document's own record of the lines this system wrote into it goes
     * into the match, so those lines come back as ADDED_MISSING rather than as
     * ordinary invoice lines — priced like any other, never settled.
     */
    const matches = await this.matching.match(opened.sheet.rows, opened.sheet.addedByAudit);
    const pricing = await this.pricing.reconcile(matches, opened.sheet.columns);
    const remarks = await this.remarks.plan(matches, pricing);
    const period = toInvoicePeriod(opened.sheet.rows);
    /*
     * Compared against EVERY line the document states, not only the matched
     * ones: a line that found no Trip still names a transport, and adding a row
     * for it would put the same transport on the invoice twice.
     */
    const found = await this.missingTrips.find(
      period,
      opened.sheet.rows,
      toNamedTripIds(matches),
      toBlockingIdentities(matches, opened.sheet.incompleteRows),
    );
    const missing = await this.addedRows.plan(found.missing);
    /*
     * Checked BEFORE anything is planned into the document: a total that would
     * leave an added line out is a wrong total, so a deviating document gets
     * no added line and no new Fuel header — only the report of why.
     */
    const structure = checkTotalsStructure(opened.worksheet, opened.sheet);
    const added = structure.sound ? missing : [];
    const fuelHeader = structure.sound
      ? planFuelHeader(opened.worksheet, opened.sheet, pricing, added)
      : null;

    this.logExamination(fileName, opened, period, structure, missing.length, fuelHeader);

    return {
      fileName,
      received: buffer,
      opened,
      period,
      matches,
      pricing,
      remarks,
      missing,
      blocked: found.blocked,
      structure,
      added,
      firstAddedRowNumber: structure.sound ? toFirstAddedRowNumber(opened.sheet) : null,
      fuelHeader,
    };
  }

  private logExamination(
    fileName: string,
    opened: OpenedInvoiceWorkbook,
    period: InvoicePeriod | null,
    structure: TotalsStructure,
    missing: number,
    fuelHeader: FuelHeaderChange | null,
  ): void {
    if (!structure.sound) {
      this.logger.warn("Invoice totals deviate; no line is added", {
        fileName,
        missing,
        problems: structure.problems,
      });
    }

    this.logger.log("Invoice checked", {
      fileName,
      lineCount: opened.sheet.rows.length,
      periodFrom: period?.from ?? null,
      periodTo: period?.to ?? null,
      totalsSound: structure.sound,
      fuelHeaderChanged: fuelHeader !== null,
    });
  }

  /**
   * The uploaded file, once it is worth opening.
   *
   * The name is used for the report and nothing else — never as a path, never
   * to decide the period. Any directory a client put in it is stripped, so a
   * name like `../../etc/passwd` is simply a name.
   */
  private requireWorkbook(file: UploadedInvoiceFile | undefined): {
    buffer: Buffer;
    fileName: string;
  } {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new InvalidInvoiceFileException("er is geen bestand geüpload");
    }

    const fileName = toSafeFileName(file.originalname);

    if (!fileName.toLowerCase().endsWith(XLSX_EXTENSION)) {
      throw new InvalidInvoiceFileException(`alleen ${XLSX_EXTENSION}-bestanden worden aanvaard`);
    }

    if (!file.buffer.subarray(0, ZIP_HEADER.length).equals(ZIP_HEADER)) {
      this.logger.warn("Invoice upload refused on its content", { fileName });

      throw new InvalidInvoiceFileException("het bestand is geen Excel-werkmap");
    }

    return { buffer: file.buffer, fileName };
  }
}

/**
 * Every Trip some line of the document is about: the one it was matched to, and
 * every candidate a line could not choose between. None of them is missing from
 * the invoice, whatever values the line happens to print.
 */
function toNamedTripIds(matches: readonly InvoiceRowMatch[]): Set<string> {
  return new Set(
    matches.flatMap((match) => [
      ...(match.trip ? [match.trip.id] : []),
      ...match.candidates.map((candidate) => candidate.id),
    ]),
  );
}

/** A file name with any path a client sent stripped off. */
function toSafeFileName(originalName: string | undefined): string {
  if (!originalName) {
    return "";
  }

  return (originalName.split(/[\\/]/).pop() ?? "").trim();
}
