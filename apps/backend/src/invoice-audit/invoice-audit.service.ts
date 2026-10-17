import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { InvoiceAuditResultDto, toInvoiceAuditResultDto } from "./dto/invoice-audit.dto";
import { toChangePlan, toMarkedRowNumbers, toWorkbookCorrections } from "./invoice-corrections";
import {
  InvoiceExaminationService,
  type ExaminedInvoice,
  type UploadedInvoiceFile,
} from "./invoice-examination.service";
import { assessPayments } from "./payment/payment-eligibility";
import type { ChangePlan } from "./workbook/change-plan";
import {
  InvoiceSheetWriter,
  type WorkbookCorrectionOutcome,
} from "./workbook/invoice-sheet.writer";
import { InvoiceWorkbookVerifier } from "./workbook/invoice-workbook-verifier";
import { sumAmountColumns } from "./workbook/line-totals";

export type { UploadedInvoiceFile } from "./invoice-examination.service";

/** The corrected document, and what was written into it. */
export interface AppliedInvoiceAudit {
  readonly fileName: string;
  /** The corrected document, ready to be handed to the browser. */
  readonly workbook: Buffer;
  /** The same preview `check` answers, for the document that was produced. */
  readonly result: InvoiceAuditResultDto;
  readonly cellsWritten: number;
  readonly rowsAdded: number;
  readonly rowsMarked: number;
}

interface CorrectedInvoice {
  readonly examined: ExaminedInvoice;
  /** Every change the document may contain, decided before it was written. */
  readonly plan: ChangePlan;
  readonly written: WorkbookCorrectionOutcome;
  readonly result: InvoiceAuditResultDto;
}

/** A corrected invoice that exists as bytes, and was verified against its plan. */
export interface ProducedInvoice extends CorrectedInvoice {
  readonly workbook: Buffer;
}

/**
 * Checks a customer's weekly invoice, and produces it corrected.
 *
 * ── THREE STEPS, AND ONLY THE LAST ONE CHANGES ANYTHING HERE ────────────────
 *   check     the preview: what the corrected document will say, what is
 *             yellow, what the totals become, and which transports a
 *             confirmation may settle. Nothing is written anywhere.
 *   apply     the corrected document itself, once its bytes were verified
 *             against the change plan (`InvoiceWorkbookVerifier`). Nothing in
 *             this system changes — in particular, nothing is paid.
 *   payment   `InvoicePaymentService`: the operator's separate confirmation.
 *
 * ── THE PREVIEW IS THE DOCUMENT ─────────────────────────────────────────────
 * `check` writes the corrections into its own in-memory copy of the upload,
 * exactly as `apply` does, and reads its totals back from it. That copy is
 * never serialised or returned; it exists so the preview and the downloaded
 * file cannot come from two different calculations.
 *
 * ── AND NOTHING IS STORED ───────────────────────────────────────────────────
 * No audit table, no upload history. The invoice is the customer's record and
 * the result is a view of it.
 */
@Injectable()
export class InvoiceAuditService {
  constructor(
    private readonly examination: InvoiceExaminationService,
    private readonly writer: InvoiceSheetWriter,
    private readonly verifier: InvoiceWorkbookVerifier,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceAuditService.name);
  }

  async check(file: UploadedInvoiceFile | undefined): Promise<InvoiceAuditResultDto> {
    return (await this.correct(file)).result;
  }

  /** The corrected document, verified. Nothing in the system changes. */
  async apply(file: UploadedInvoiceFile | undefined): Promise<AppliedInvoiceAudit> {
    const { examined, written, result, workbook } = await this.produce(file);

    this.logger.log("Corrected invoice produced", {
      fileName: examined.fileName,
      cellsWritten: written.cellsWritten,
      rowsAdded: written.rowsAdded,
      rowsMarked: written.rowsMarked,
      fuelHeaderChanged: written.fuelHeaderChanged,
    });

    return {
      fileName: examined.fileName,
      workbook,
      result,
      cellsWritten: written.cellsWritten,
      rowsAdded: written.rowsAdded,
      rowsMarked: written.rowsMarked,
    };
  }

  /**
   * The corrected document as bytes — or nothing at all.
   *
   * The change plan is made from the examination BEFORE the writer runs; the
   * serialised file is then read back and held against it. A file that differs
   * from the received one by anything the plan does not name throws
   * `InvoiceWorkbookIntegrityException`, and neither a download nor a payment
   * can follow from it.
   */
  async produce(file: UploadedInvoiceFile | undefined): Promise<ProducedInvoice> {
    const corrected = await this.correct(file);
    const { examined } = corrected;
    const workbook = Buffer.from(await examined.opened.workbook.xlsx.writeBuffer());

    await this.verifier.verify(
      examined.fileName,
      examined.received,
      workbook,
      examined.opened.worksheet.name,
      corrected.plan,
    );

    return { ...corrected, workbook };
  }

  /** Examines the upload and writes the corrections into its in-memory copy. */
  private async correct(file: UploadedInvoiceFile | undefined): Promise<CorrectedInvoice> {
    const examined = await this.examination.examine(file);
    const corrections = toWorkbookCorrections(examined);
    // Decided before the writer touches anything, so it cannot echo the writer.
    const plan = toChangePlan(examined, corrections);
    const { worksheet, sheet, workbook } = examined.opened;
    const lineRows = sheet.rows.map((row) => row.rowNumber);
    const markedRowNumbers = toMarkedRowNumbers(examined.matches, examined.pricing);
    // Read BEFORE the writer touches the copy: the document as received.
    const totalsBefore = sumAmountColumns(worksheet, sheet, lineRows);
    const written = this.writer.apply(
      workbook,
      worksheet,
      sheet,
      examined.pricing,
      corrections,
    );
    const addedRows = Array.from(
      { length: written.rowsAdded },
      (_, index) => (written.firstAddedRowNumber ?? 0) + index,
    );
    const totalsAfter = sumAmountColumns(worksheet, sheet, [...lineRows, ...addedRows]);
    const payments = assessPayments(examined.matches, examined.pricing, new Set(markedRowNumbers));

    return {
      examined,
      written,
      plan,
      result: toInvoiceAuditResultDto(examined, {
        markedRowNumbers,
        totalsBefore,
        totalsAfter,
        payments,
      }),
    };
  }
}
