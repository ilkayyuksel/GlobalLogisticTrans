import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate } from "../../common/dates";
import type { MissingTrip } from "../missing/missing-trips.service";
import { writeAuditMarkers } from "./invoice-audit-marker";
import { MONEY_DECIMAL_PLACES, toAmountCell } from "./invoice-amounts";
import type { InvoiceColumnPositions } from "./invoice-columns";
import {
  toAddedRowTemplate,
  toFirstAddedRowNumber,
  writeAddedRow,
} from "./invoice-row-appender";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * A cell whose formula other cells borrow — Excel's own way of writing a column
 * of identical formulas once.
 *
 * ── AND THE TRAP IN IT ──────────────────────────────────────────────────────
 * A borrower stores no formula of its own, only the master's address. Writing
 * an amount into the MASTER therefore leaves every borrower pointing at a cell
 * that no longer holds a formula, and the workbook cannot be written at all:
 * ExcelJS refuses it with "Shared Formula master must exist above and or left
 * of clone". The customer's real invoices are full of these — 11 masters and 94
 * borrowers in one week — so this is not an edge case, it is the file.
 *
 * The remedy is to hand each borrower its own copy of the formula BEFORE the
 * master is written to. ExcelJS translates it per cell (`13%*L2` becomes
 * `13%*L3`), so the copy calculates exactly what the borrowed one did.
 */
interface SharedFormulaCell {
  readonly formula?: string;
  readonly sharedFormula?: string;
  readonly shareType?: string;
  readonly ref?: string;
  readonly result?: unknown;
}

/** `SUM(L2:L130)` — the shape the totals row is written in. */
const SUM_OF_RANGE = /^\s*SUM\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)\s*$/i;

/**
 * The fluorescent yellow a problem line is marked with.
 *
 * The colour the customer's own sheets already use to make a cell stand out —
 * their Bookingnr and Container columns carry exactly this fill — so a marked
 * line reads as something they have seen before rather than as a colour this
 * system invented.
 */
const PROBLEM_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

/** The same, once it covers the added block too: `SUM(L2:L99,L102:L103)`. */
const SUM_CALL = /^\s*SUM\(([^)]*)\)\s*$/i;
const RANGE = /^\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*$/i;

/** `L131` — the shape the summary block points at the totals row with. */
const CELL_REFERENCE = /^\s*\$?([A-Z]+)\$?(\d+)\s*$/;

/**
 * Writes the corrections into the customer's own workbook.
 *
 * ── THE DOCUMENT IS THEIRS, AND IT STAYS THEIRS ─────────────────────────────
 * This writes into the workbook that was READ, never into a new one. Its
 * columns, widths, euro formats, hidden Maut and Tol FR, per-row formulas,
 * totals row and summary block are therefore not preserved by effort — they are
 * simply never touched. The only cells this writes are the amount cells a
 * difference names, plus the cached results that those changes made stale.
 *
 * ── NO ROW IS ADDED, MOVED OR REMOVED ───────────────────────────────────────
 * `spliceRows` is never called: these workbooks carry shared formulas and
 * ExcelJS cannot move rows through them — it throws. Nothing in this phase
 * needs to, and the ban is kept in one place so it stays true.
 *
 * ── AND A FORMULA IS LEFT TO DO ITS WORK ────────────────────────────────────
 * The Fuel column is a percentage of the Tarief. When the corrected Tarief
 * already makes that formula produce the right amount, the formula stays and
 * only its cached result is refreshed — see `keepsFormula`.
 */
@Injectable()
export class InvoiceSheetWriter {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(InvoiceSheetWriter.name);
  }

  /**
   * Applies every correction, and answers how many cells it wrote.
   *
   * Only rows the pricing check corrected are touched. A line that was not
   * compared — no CLOSED Trip, an unfinished one, several — carries no
   * correction and therefore cannot be written to: the check is the only source
   * of what may change, and it produces nothing for those lines.
   */
  apply(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    pricing: ReadonlyMap<number, InvoiceRowPricing>,
    missing: readonly MissingTrip[] = [],
    problemRowNumbers: readonly number[] = [],
  ): {
    cellsWritten: number;
    rowsCorrected: number;
    rowsAdded: number;
    firstAddedRowNumber: number | null;
    rowsMarked: number;
  } {
    let cellsWritten = 0;
    let rowsCorrected = 0;

    this.releaseBorrowedFormulas(worksheet, sheet, pricing);

    for (const row of sheet.rows) {
      const outcome = pricing.get(row.rowNumber);

      if (!outcome || outcome.status !== InvoicePricingStatus.PRICING_CORRECTED) {
        continue;
      }

      const written = this.applyToRow(worksheet, sheet.columns, outcome);

      cellsWritten += written;
      rowsCorrected += written > 0 ? 1 : 0;
    }

    const added = this.appendMissing(workbook, worksheet, sheet, missing);
    const rowsMarked = this.markProblems(worksheet, sheet, problemRowNumbers);

    if (cellsWritten > 0 || added.rowsAdded > 0) {
      this.refreshTotals(worksheet, sheet);

      /*
       * Excel recalculates everything on open. The cached results this writer
       * could compute are already correct; this is what covers the ones it
       * deliberately did not touch, such as a formula in a column nothing here
       * reads.
       */
      workbook.calcProperties.fullCalcOnLoad = true;
    }

    this.logger.log("Invoice workbook corrected", {
      cellsWritten,
      rowsCorrected,
      rowsAdded: added.rowsAdded,
      rowsMarked,
    });

    return { cellsWritten, rowsCorrected, ...added, rowsMarked };
  }

  /**
   * Paints the lines somebody has to look at.
   *
   * ── A COLOUR, AND NOTHING ELSE ────────────────────────────────────────────
   * A line with no Trip, one whose Trip is unfinished, one that matched several
   * and one whose difference could not be placed on a cell are all left exactly
   * as the customer wrote them — every value, every formula. Only the fill of
   * the cells they already use changes, so the operator can find them and the
   * document still says what it said.
   *
   * The transports added below are never marked: they are not a problem, they
   * are what the invoice was missing.
   */
  private markProblems(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    rowNumbers: readonly number[],
  ): number {
    const marked = new Set(rowNumbers);
    let count = 0;

    for (const row of sheet.rows) {
      if (!marked.has(row.rowNumber)) {
        continue;
      }

      worksheet
        .getRow(row.rowNumber)
        .eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = PROBLEM_FILL;
        });
      count += 1;
    }

    return count;
  }

  /**
   * Writes the finished transports the invoice never mentioned, below it.
   *
   * ── NOTHING EXISTING MOVES ────────────────────────────────────────────────
   * Not one row is inserted, shifted or renumbered: the lines the customer wrote
   * keep the row numbers the check reported them by, and these go underneath,
   * past the summary block, after one blank line. That is the only placement
   * ExcelJS can perform on a workbook with shared formulas at all — inserting
   * throws — and it is what `§8` of the specification calls for.
   *
   * The totals then grow to cover them, so the document still adds up.
   */
  private appendMissing(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    missing: readonly MissingTrip[],
  ): { rowsAdded: number; firstAddedRowNumber: number | null } {
    if (missing.length === 0) {
      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    const template = toAddedRowTemplate(worksheet, sheet);

    if (template === null) {
      // A document with no line of its own offers no convention to follow, and
      // this will not invent one. Reported, never guessed at.
      this.logger.warn("Missing transports were not added: the invoice has no line to follow", {
        missing: missing.length,
      });

      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    const firstAddedRowNumber = toFirstAddedRowNumber(sheet);

    missing.forEach((trip, index) => {
      writeAddedRow(worksheet, sheet, template, trip, firstAddedRowNumber + index);
    });

    this.extendTotals(worksheet, sheet, firstAddedRowNumber, missing.length);

    /*
     * ── THE DOCUMENT REMEMBERS WHAT WE WROTE INTO IT ──────────────────────
     * Together with whatever an earlier run recorded, so a document processed
     * twice still knows all of its added lines. Without this the next upload
     * would read them as the customer's own and settle transports nobody
     * invoiced — see `invoice-audit-marker.ts`.
     */
    writeAuditMarkers(workbook, [
      ...sheet.addedByAudit.values(),
      ...missing.map((trip, index) => ({
        rowNumber: firstAddedRowNumber + index,
        tripId: trip.trip.id,
        planningDate: trip.trip.planningDate ? toIsoDate(trip.trip.planningDate) : "",
        bookingNumber: trip.trip.bookingNumber ?? "",
        normalizedContainerNumber:
          normalizeContainerNumber(trip.trip.containerNumber) ?? "",
      })),
    ]);

    this.logger.log("Missing transports added to the invoice", {
      rowsAdded: missing.length,
      firstAddedRowNumber,
      recordedRows: sheet.addedByAudit.size + missing.length,
    });

    return { rowsAdded: missing.length, firstAddedRowNumber };
  }

  /**
   * Grows each total so the added lines count towards it.
   *
   * ── THE FORMULA STAYS A FORMULA ───────────────────────────────────────────
   * `SUM(L2:L99)` becomes `SUM(L2:L99,L102:L103)` — the customer's own range,
   * untouched, with the added block beside it. No total is ever replaced by a
   * figure, and a totals cell that is itself a shared master keeps its shape.
   */
  private extendTotals(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    firstAddedRowNumber: number,
    count: number,
  ): void {
    if (sheet.totalsRowNumber === null) {
      return;
    }

    const lastAddedRowNumber = firstAddedRowNumber + count - 1;

    worksheet
      .getRow(sheet.totalsRowNumber)
      .eachCell({ includeEmpty: false }, (cell) => {
        const formula = toFormula(cell.value);
        const match = formula === null ? null : SUM_OF_RANGE.exec(formula);

        if (formula === null || match === null) {
          return;
        }

        const letter = match[1];
        const shared = cell.value as SharedFormulaCell;

        cell.value = {
          formula: `SUM(${match[1]}${match[2]}:${match[3]}${match[4]},${letter}${firstAddedRowNumber}:${letter}${lastAddedRowNumber})`,
          result: 0,
          ...(shared.shareType ? { shareType: shared.shareType, ref: shared.ref } : {}),
        } as ExcelJS.CellFormulaValue;
      });
  }

  /**
   * Gives every borrower of a formula this writer is about to overwrite its own
   * copy of it.
   *
   * Only the masters actually being written to — a column of shared formulas
   * this check does not touch keeps its own shape, because expanding it would
   * be a change to the customer's document that nothing asked for.
   */
  private releaseBorrowedFormulas(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    pricing: ReadonlyMap<number, InvoiceRowPricing>,
  ): void {
    const masters = new Set<string>();

    for (const row of sheet.rows) {
      const outcome = pricing.get(row.rowNumber);

      if (!outcome || outcome.status !== InvoicePricingStatus.PRICING_CORRECTED) {
        continue;
      }

      for (const difference of outcome.differences) {
        const position = difference.column ? sheet.columns[difference.column] : undefined;

        if (difference.correctionRowNumber === null || position === undefined) {
          continue;
        }

        const cell = worksheet.getRow(difference.correctionRowNumber).getCell(position);

        if (isFormulaMaster(cell.value)) {
          masters.add(cell.address);
        }
      }
    }

    if (masters.size === 0) {
      return;
    }

    let released = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value as SharedFormulaCell | null;

        if (!value?.sharedFormula || !masters.has(value.sharedFormula)) {
          return;
        }

        // `cell.formula` is the master's formula translated to THIS cell, so the
        // copy calculates what the borrowed one did.
        cell.value = {
          formula: cell.formula,
          result: value.result,
        } as ExcelJS.CellFormulaValue;
        released += 1;
      });
    });

    this.logger.log("Shared formulas released before correcting", {
      masters: masters.size,
      released,
    });
  }

  private applyToRow(
    worksheet: ExcelJS.Worksheet,
    columns: InvoiceColumnPositions,
    outcome: InvoiceRowPricing,
  ): number {
    let written = 0;

    for (const difference of outcome.differences) {
      const position = difference.column ? columns[difference.column] : undefined;

      // A difference nothing may carry — several rows state the component — is
      // reported, never written. See NOT_DISTRIBUTABLE.
      if (
        difference.correctedValue === null ||
        difference.correctionRowNumber === null ||
        position === undefined
      ) {
        continue;
      }

      const cell = worksheet
        .getRow(difference.correctionRowNumber)
        .getCell(position);

      if (difference.keepsFormula) {
        const formula = toAmountCell(cell.value).formula;

        if (formula) {
          // The formula produces the right amount from the corrected Tarief, so
          // it stays exactly as it is; only what it last calculated is refreshed.
          cell.value = {
            formula,
            result: toNumber(difference.correctedValue),
          };
          written += 1;

          continue;
        }
      }

      cell.value = toNumber(difference.correctedValue);
      written += 1;
    }

    return written;
  }

  /**
   * Brings the cached results of the totals row and the summary block up to
   * date.
   *
   * ── WHY THE CACHE MATTERS AT ALL ────────────────────────────────────────
   * A workbook stores both the formula and what it last calculated. Correcting
   * a Tarief leaves `=SUM(L2:L130)` correct and its cached figure wrong, and a
   * reader that trusts the cache — anything that is not Excel — would show the
   * old total. The formulas are never replaced by figures: they stay formulas,
   * and only what they last produced is rewritten.
   *
   * Only the two shapes these documents actually use are recomputed: a SUM over
   * a range, and a reference to a single cell. Anything else keeps whatever it
   * had, and `fullCalcOnLoad` is what covers it when the file is opened.
   */
  private refreshTotals(worksheet: ExcelJS.Worksheet, sheet: InvoiceSheet): void {
    const rowNumbers = [
      ...(sheet.totalsRowNumber === null ? [] : [sheet.totalsRowNumber]),
      ...sheet.summaryRowNumbers,
    ];

    for (const rowNumber of rowNumbers) {
      worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
        const formula = toFormula(cell.value);

        if (formula === null) {
          return;
        }

        const result =
          this.sumOfRange(worksheet, formula) ??
          this.valueOfReference(worksheet, formula);

        if (result === null) {
          return;
        }

        const shared = cell.value as SharedFormulaCell;

        // A totals cell may itself be a master. Its shape is kept, so the cells
        // borrowing from it keep working.
        cell.value = {
          formula,
          result: toNumber(result),
          ...(shared.shareType ? { shareType: shared.shareType, ref: shared.ref } : {}),
        } as ExcelJS.CellFormulaValue;
      });
    }
  }

  private sumOfRange(
    worksheet: ExcelJS.Worksheet,
    formula: string,
  ): Prisma.Decimal | null {
    const inside = SUM_CALL.exec(formula);

    if (inside === null) {
      return null;
    }

    let total = new Prisma.Decimal(0);

    // `SUM(L2:L99,L102:L103)`: the customer's own range and the added block.
    for (const part of inside[1].split(",")) {
      const range = RANGE.exec(part);

      if (range === null || range[1].toUpperCase() !== range[3].toUpperCase()) {
        return null;
      }

      const column = worksheet.getColumn(range[1]).number;

      for (
        let rowNumber = Number(range[2]);
        rowNumber <= Number(range[4]);
        rowNumber += 1
      ) {
        total = total.plus(
          toAmountCell(worksheet.getRow(rowNumber).getCell(column).value).value ?? 0,
        );
      }
    }

    return total;
  }

  private valueOfReference(
    worksheet: ExcelJS.Worksheet,
    formula: string,
  ): Prisma.Decimal | null {
    const match = CELL_REFERENCE.exec(formula);

    if (!match) {
      return null;
    }

    return toAmountCell(
      worksheet.getRow(Number(match[2])).getCell(worksheet.getColumn(match[1]).number)
        .value,
    ).value;
  }
}

function toFormula(value: unknown): string | null {
  return value !== null && typeof value === "object" && "formula" in value
    ? (value as { formula: string }).formula
    : null;
}

/** Whether other cells borrow this one's formula. */
function isFormulaMaster(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as SharedFormulaCell).shareType === "shared"
  );
}

/** Money as a cell holds it: a number at the money precision, never a string. */
function toNumber(amount: Prisma.Decimal): number {
  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}
