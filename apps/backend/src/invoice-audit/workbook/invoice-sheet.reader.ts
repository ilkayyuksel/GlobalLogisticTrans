import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { normalizeContainerNumber } from "@tms/parser";

import { AppLoggerService } from "../../logger/app-logger.service";
import {
  InvoiceColumnsMissingException,
  UnreadableInvoiceWorkbookException,
} from "../exceptions/invoice-audit.exceptions";
import {
  resolveColumns,
  toHeaderText,
  type InvoiceColumn,
  type InvoiceColumnPositions,
} from "./invoice-columns";
import { toAmountCell, type InvoiceAmountCell } from "./invoice-amounts";
import { AUDIT_MARKER_SHEET, readAuditMarkers } from "./invoice-audit-marker";
import {
  statesSomething,
  toCellText,
  toPlanningDate,
  type InvoiceSheet,
  type InvoiceSheetRow,
} from "./invoice-sheet";

/**
 * The columns that carry money, which is what the pricing check compares and
 * the only place a correction is ever written.
 */
export const AMOUNT_COLUMNS: readonly InvoiceColumn[] = [
  "tarief",
  "fuel",
  "backload",
  "maut",
  "tolB",
  "tolFr",
  "tunnel",
  "others",
  "ek",
];

/**
 * A workbook, opened: the document itself and what this system read from it.
 *
 * The ExcelJS objects travel with the result because the corrected document is
 * produced by writing into THIS workbook — the one that was read — rather than
 * by building a new one. See `InvoiceSheetWriter`.
 */
export interface OpenedInvoiceWorkbook {
  readonly workbook: ExcelJS.Workbook;
  readonly worksheet: ExcelJS.Worksheet;
  readonly sheet: InvoiceSheet;
}

/**
 * How far down a header row may sit before the document is called unreadable.
 *
 * Both reference files put it on row 1. A title or a blank line above it is
 * ordinary in a spreadsheet a human maintains, so a few rows are searched —
 * but only a few: scanning the whole sheet for something that looks like a
 * header is how a totals row eventually gets mistaken for one.
 */
const HEADER_SEARCH_ROWS = 10;

/**
 * Reads a customer weekly invoice into the lines it states.
 *
 * ── IT READS, AND CHANGES NOTHING ───────────────────────────────────────────
 * The uploaded workbook is the customer's document and the one that will later
 * be corrected. Nothing here writes a cell, reorders a row or drops one: the
 * result is a description OF the sheet, with every line carrying the Excel row
 * number it came from.
 *
 * ── WHAT IS A LINE, AND WHAT IS NOT ─────────────────────────────────────────
 * A line states all three identity values — a day, a booking and a container.
 * The totals row states none of them and carries money in every amount column;
 * the summary block beneath it states a label and a formula. Both would look
 * like data to anything counting filled cells, so the rule is the identity and
 * not the presence of values.
 */
@Injectable()
export class InvoiceSheetReader {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(InvoiceSheetReader.name);
  }

  async read(file: Buffer, fileName: string): Promise<InvoiceSheet> {
    return (await this.open(file, fileName)).sheet;
  }

  /**
   * The same read, keeping the workbook it was read from.
   *
   * For the caller that will write corrections back into it. Reading and
   * writing the SAME object is what keeps the document's own columns, formats,
   * formulas and hidden columns exactly as the customer sent them.
   */
  async open(file: Buffer, fileName: string): Promise<OpenedInvoiceWorkbook> {
    const { workbook, worksheet } = await this.openFirstWorksheet(file, fileName);
    const { headerRowNumber, columns } = this.resolveHeader(worksheet, fileName);
    /*
     * Which lines a previous run of this check added to THIS document. Empty for
     * a customer's own invoice, and the reason one of ours cannot settle a
     * transport nobody invoiced — see `invoice-audit-marker.ts`.
     */
    const addedByAudit = readAuditMarkers(workbook);

    if (addedByAudit.size > 0) {
      this.logger.log("Invoice workbook carries lines this system added", {
        fileName,
        addedRows: addedByAudit.size,
      });
    }

    return {
      workbook,
      worksheet,
      sheet: {
        ...this.readRows(worksheet, headerRowNumber, columns),
        addedByAudit,
      },
    };
  }

  private async openFirstWorksheet(
    file: Buffer,
    fileName: string,
  ): Promise<{ workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet }> {
    const workbook = new ExcelJS.Workbook();

    try {
      // ExcelJS types the buffer as its own alias of ArrayBuffer; the runtime
      // takes the Node Buffer multer hands over, which is what this receives.
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch (error: unknown) {
      this.logger.warn("Invoice workbook could not be opened", {
        fileName,
        reason: error instanceof Error ? error.message : "unknown",
      });

      throw new UnreadableInvoiceWorkbookException(
        "the file could not be opened as an Excel workbook",
      );
    }

    /*
     * The FIRST worksheet, and the document is expected to have exactly one.
     * Choosing among several would mean guessing which sheet is the invoice —
     * so a workbook with none is refused, and one with more is read as its
     * first sheet, which is the sheet both reference files are.
     *
     * This system's own bookkeeping sheet is skipped rather than counted: it is
     * hidden, it holds no transport, and it is only ever added at the end.
     */
    const worksheet = workbook.worksheets.find(
      (candidate) => candidate.name !== AUDIT_MARKER_SHEET,
    );

    if (!worksheet) {
      throw new UnreadableInvoiceWorkbookException(
        "the workbook contains no worksheet",
      );
    }

    return { workbook, worksheet };
  }

  /**
   * Which row is the header, and where each column sits in it.
   *
   * The first row that offers every required column wins. When no row does, the
   * refusal names the columns missing from the BEST candidate — the row that
   * came closest — because "Tol B and EK are missing" is something an operator
   * can act on, while "no header row found" is not.
   */
  private resolveHeader(
    worksheet: ExcelJS.Worksheet,
    fileName: string,
  ): { headerRowNumber: number; columns: InvoiceColumnPositions } {
    let closest: { rowNumber: number; missing: readonly InvoiceColumn[] } | null =
      null;

    const lastRow = Math.min(worksheet.rowCount, HEADER_SEARCH_ROWS);

    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const { positions, missing } = resolveColumns(
        this.toTextCells(worksheet.getRow(rowNumber)),
      );

      if (missing.length === 0) {
        return { headerRowNumber: rowNumber, columns: positions };
      }

      if (closest === null || missing.length < closest.missing.length) {
        closest = { rowNumber, missing };
      }
    }

    const missing = closest?.missing ?? [];

    this.logger.warn("Invoice workbook has an unexpected structure", {
      fileName,
      missingColumns: missing.length,
    });

    throw new InvoiceColumnsMissingException(missing.map(toHeaderText));
  }

  /** Every cell of a row as text, indexed from 0, gaps included. */
  private toTextCells(row: ExcelJS.Row): (string | null)[] {
    const cells: (string | null)[] = [];

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const text = toCellText(cell.value);
      cells[columnNumber - 1] = text === "" ? null : text;
    });

    return cells;
  }

  /**
   * What the WORKSHEET states. The record of what this system once added to the
   * document lives beside it, in the workbook — see `open`.
   */
  private readRows(
    worksheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    columns: InvoiceColumnPositions,
  ): Omit<InvoiceSheet, "addedByAudit"> {
    const rows: InvoiceSheetRow[] = [];
    const incompleteRowNumbers: number[] = [];
    const summaryRowNumbers: number[] = [];
    let totalsRowNumber: number | null = null;

    for (
      let rowNumber = headerRowNumber + 1;
      rowNumber <= worksheet.rowCount;
      rowNumber += 1
    ) {
      const row = worksheet.getRow(rowNumber);
      const planningDate = toPlanningDate(this.cell(row, columns, "planningDate"));
      const bookingNumber = toCellText(this.cell(row, columns, "bookingNumber"));
      const containerNumber = toCellText(this.cell(row, columns, "containerNumber"));
      const container = normalizeContainerNumber(containerNumber);

      const statedValues = [planningDate, bookingNumber || null, container].filter(
        (value) => value !== null && value !== "",
      ).length;

      if (statedValues === 3 && planningDate !== null && container !== null) {
        rows.push({
          rowNumber,
          planningDate,
          bookingNumber,
          // The sheet's own spelling is kept: it is what the corrected document
          // must still say, and normalisation exists only to compare with.
          containerNumber,
          normalizedContainerNumber: container,
          amounts: this.readAmounts(row, columns),
        });

        continue;
      }

      if (statedValues > 0) {
        incompleteRowNumbers.push(rowNumber);

        continue;
      }

      // Below the lines: the totals row is the first one carrying an amount
      // while naming no transport; everything after it that says anything is
      // the summary block.
      if (rows.length === 0) {
        continue;
      }

      if (this.statesAnyAmount(row, columns)) {
        if (totalsRowNumber === null) {
          totalsRowNumber = rowNumber;
        } else {
          summaryRowNumbers.push(rowNumber);
        }

        continue;
      }

      if (this.statesAnything(row)) {
        summaryRowNumbers.push(rowNumber);
      }
    }

    this.logger.log("Invoice workbook read", {
      sheetName: worksheet.name,
      headerRowNumber,
      lineCount: rows.length,
      incompleteRowCount: incompleteRowNumbers.length,
      hasTotalsRow: totalsRowNumber !== null,
      summaryRowCount: summaryRowNumbers.length,
    });

    return {
      sheetName: worksheet.name,
      headerRowNumber,
      columns,
      rows,
      totalsRowNumber,
      summaryRowNumbers,
      incompleteRowNumbers,
    };
  }

  /** Every amount column this sheet offers, as the row states it. */
  private readAmounts(
    row: ExcelJS.Row,
    columns: InvoiceColumnPositions,
  ): Partial<Record<InvoiceColumn, InvoiceAmountCell>> {
    const amounts: Partial<Record<InvoiceColumn, InvoiceAmountCell>> = {};

    for (const column of AMOUNT_COLUMNS) {
      if (columns[column] === undefined) {
        continue;
      }

      amounts[column] = toAmountCell(this.cell(row, columns, column));
    }

    return amounts;
  }

  private cell(
    row: ExcelJS.Row,
    columns: InvoiceColumnPositions,
    column: InvoiceColumn,
  ): unknown {
    const position = columns[column];

    return position === undefined ? null : row.getCell(position).value;
  }

  /** Whether a row carries money in any amount column — the totals row does. */
  private statesAnyAmount(
    row: ExcelJS.Row,
    columns: InvoiceColumnPositions,
  ): boolean {
    return AMOUNT_COLUMNS.some((column) =>
      statesSomething(this.cell(row, columns, column)),
    );
  }

  private statesAnything(row: ExcelJS.Row): boolean {
    let stated = false;

    row.eachCell({ includeEmpty: false }, (cell) => {
      stated = stated || statesSomething(cell.value);
    });

    return stated;
  }
}
