import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { normalizeContainerNumber } from "@tms/parser";

import type { ContainerCorrection } from "../matching/invoice-row-matching.service";

import { toIsoDate } from "../../common/dates";
import type { MissingTrip } from "../missing/missing-trips.service";
import { writeAuditMarkers } from "./invoice-audit-marker";
import { MONEY_DECIMAL_PLACES, toAmountCell } from "./invoice-amounts";
import type { InvoiceColumnPositions } from "./invoice-columns";
import {
  toAddedRowTemplate,
  toFirstAddedRowNumber,
  writeAddedRow,
  type AddedRowTemplate,
} from "./invoice-row-appender";
import { openRowsAt, releaseSharedFormulasFrom } from "./invoice-row-inserter";
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

/**
 * The colour of a container this check corrected: red text, on the one cell.
 *
 * Text rather than fill, and nothing else on the row: the line is not a
 * problem — its transport was found and it is settled like any other — so it
 * must not look like the yellow lines that are. The red says only "this value
 * is not what you sent".
 */
const CORRECTED_TEXT_ARGB = "FFFF0000";

/** A SUM over one or more ranges: `SUM(L2:L101)`, `SUM(L102:T102)`. */
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
    containerCorrections: ReadonlyMap<number, ContainerCorrection> = new Map(),
  ): {
    cellsWritten: number;
    rowsCorrected: number;
    rowsAdded: number;
    firstAddedRowNumber: number | null;
    rowsMarked: number;
    containersCorrected: number;
  } {
    let cellsWritten = 0;
    let rowsCorrected = 0;

    /*
     * Read before ANYTHING is written: the added lines take the look the
     * customer's lines have as they were sent, not as this check marked them.
     */
    const template = toAddedRowTemplate(worksheet, sheet);

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

    const containersCorrected = this.correctContainers(
      worksheet,
      sheet,
      containerCorrections,
    );
    /*
     * Everything addressed by the row numbers the check reported happens
     * BEFORE the added lines open space above the totals row; after that, a
     * row below the opening is on another number.
     */
    const rowsMarked = this.markProblems(worksheet, sheet, problemRowNumbers);
    const added = this.appendMissing(workbook, worksheet, sheet, template, missing);

    if (cellsWritten > 0 || added.rowsAdded > 0) {
      this.refreshTotals(worksheet, sheet, added.rowsAdded);

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
      containersCorrected,
    });

    return {
      cellsWritten,
      rowsCorrected,
      ...added,
      rowsMarked,
      containersCorrected,
    };
  }

  /**
   * Writes the Trip's own container over a misprinted one, in red.
   *
   * ── ONE CELL, ONE PROPERTY OF ITS STYLE ───────────────────────────────────
   * Only the `Container nr.` cell of a corrected line, and only its font
   * colour: the fill, the border, the alignment, the font's own face, size and
   * weight all stay exactly as the customer had them.
   *
   * The style is REBUILT rather than edited in place. ExcelJS gives every cell
   * that shares a style in the file ONE shared style object — `getStyleModel`
   * caches it per style id — so editing it would recolour every cell with that
   * style. On the real `week 13` invoice one row edited in place recoloured
   * 1,543 of its 1,690 cells. A fresh style object carrying a fresh font object
   * is this cell's alone.
   *
   * The value written is the Trip's container exactly as this system stores
   * it. No spelling is invented for it: it is the transport's own container.
   */
  private correctContainers(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    corrections: ReadonlyMap<number, ContainerCorrection>,
  ): number {
    const position = sheet.columns.containerNumber;

    if (position === undefined || corrections.size === 0) {
      return 0;
    }

    for (const [rowNumber, correction] of corrections) {
      const cell = worksheet.getRow(rowNumber).getCell(position);

      cell.value = correction.tripContainerNumber;
      cell.style = {
        ...cell.style,
        font: {
          ...cell.style.font,
          color: { argb: CORRECTED_TEXT_ARGB },
        },
      };
    }

    return corrections.size;
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
   *
   * ── WHY THIS NO LONGER TURNS THE WHOLE WORKBOOK YELLOW ───────────────────
   * It used to write `cell.fill = …`, and ExcelJS implements that as
   * `this.style.fill = …` on a style object EVERY cell with the same style
   * shares. Marking one line painted every ordinary cell in the document — on
   * the real `week 13` invoice, 1,543 of 1,690 cells. Each marked cell now gets
   * a style object of its own, so the fill lands on the line and nowhere else.
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
          cell.style = { ...cell.style, fill: { ...PROBLEM_FILL } };
        });
      count += 1;
    }

    return count;
  }

  /**
   * Writes the finished transports the invoice never mentioned, directly below
   * its last line and directly above its totals.
   *
   * ── ROOM IS MADE, NOT FOUND ───────────────────────────────────────────────
   * The totals row and everything below it move down by the number of added
   * lines — see `openRowsAt`, which does it without `spliceRows` and rewrites
   * every formula for the move. The totals' ranges grow over the added lines,
   * the summary block follows the totals it reads, and no line the customer
   * wrote changes its row, because all of them are above the opening.
   */
  private appendMissing(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    template: AddedRowTemplate | null,
    missing: readonly MissingTrip[],
  ): { rowsAdded: number; firstAddedRowNumber: number | null } {
    if (missing.length === 0) {
      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    if (template === null) {
      // A document with no line of its own offers no convention to follow, and
      // this will not invent one. Reported, never guessed at.
      this.logger.warn("Missing transports were not added: the invoice has no line to follow", {
        missing: missing.length,
      });

      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    const firstAddedRowNumber = toFirstAddedRowNumber(sheet);

    openRowsAt(worksheet, firstAddedRowNumber, missing.length);

    missing.forEach((trip, index) => {
      writeAddedRow(worksheet, sheet, template, trip, firstAddedRowNumber + index);
    });

    /*
     * ── THE DOCUMENT REMEMBERS WHAT WE WROTE INTO IT ──────────────────────
     * Together with whatever an earlier run recorded, so a document processed
     * twice still knows all of its added lines. Without this the next upload
     * would read them as the customer's own and settle transports nobody
     * invoiced — see `invoice-audit-marker.ts`.
     *
     * A line an earlier run added BELOW the opening — a document produced
     * before added lines went above the totals — has just moved down with
     * everything else, and its record moves with it. A record left on the old
     * number would stop recognising its line, and the next upload would pay it.
     */
    writeAuditMarkers(workbook, [
      ...[...sheet.addedByAudit.values()].map((marker) =>
        marker.rowNumber >= firstAddedRowNumber
          ? { ...marker, rowNumber: marker.rowNumber + missing.length }
          : marker,
      ),
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
   *
   * ── EVERY TOTALS CELL, NOT ONLY THE MASTER ────────────────────────────────
   * The customer's totals row writes its SUMs as one shared formula, and a cell
   * that BORROWS a formula holds none of its own — so it was never refreshed
   * here, and its cached figure stayed what the customer's file said. The
   * totals' group is given back as ordinary formulas first, so each cell is
   * refreshed with the formula it actually calculates.
   *
   * `rowsAdded` is how far the totals and the summary moved when added lines
   * opened space above them; their reported row numbers are from before.
   */
  private refreshTotals(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    rowsAdded: number,
  ): void {
    const rowNumbers = [
      ...(sheet.totalsRowNumber === null ? [] : [sheet.totalsRowNumber]),
      ...sheet.summaryRowNumbers,
    ].map((rowNumber) => rowNumber + rowsAdded);

    if (rowNumbers.length > 0) {
      releaseSharedFormulasFrom(worksheet, Math.min(...rowNumbers));
    }

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

        cell.value = {
          formula,
          result: toNumber(result),
        } as ExcelJS.CellFormulaValue;

        /*
         * A total of nothing prints as nothing. The customer's money format
         * spells zero as `- €`; only that section of the format is emptied, on
         * the totals and summary cells this writer recalculates, and every
         * other figure keeps its exact format.
         */
        const numFmt = withBlankZero(cell.style.numFmt);

        if (numFmt !== cell.style.numFmt) {
          cell.style = { ...cell.style, numFmt };
        }
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

    // `SUM(L2:L101)` down a column, or `SUM(L102:T102)` — the grand total —
    // across one; any rectangle of cells, each counted once.
    for (const part of inside[1].split(",")) {
      const range = RANGE.exec(part);

      if (range === null) {
        return null;
      }

      const firstColumn = worksheet.getColumn(range[1]).number;
      const lastColumn = worksheet.getColumn(range[3]).number;

      for (let rowNumber = Number(range[2]); rowNumber <= Number(range[4]); rowNumber += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          total = total.plus(
            toAmountCell(worksheet.getRow(rowNumber).getCell(column).value).value ?? 0,
          );
        }
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

/**
 * A number format whose ZERO section prints nothing.
 *
 * Excel formats have up to four `;`-separated sections — positive, negative,
 * zero, text. The customer's money format puts `"-"` in the third, which is the
 * `- €` an empty total shows. That section is emptied and the other three are
 * kept exactly. A format with fewer sections gets an empty zero section added
 * behind what it has; `General` and an absent format are left alone.
 */
export function withBlankZero(numFmt: string | undefined): string | undefined {
  if (!numFmt || numFmt === "General") {
    return numFmt;
  }

  const sections = splitFormatSections(numFmt);

  if (sections.length === 1) {
    return `${sections[0]};-${sections[0]};`;
  }

  if (sections.length === 2) {
    return `${sections[0]};${sections[1]};`;
  }

  return [sections[0], sections[1], "", ...sections.slice(3)].join(";");
}

/** The `;`-separated sections, ignoring any `;` inside quotes or brackets. */
function splitFormatSections(numFmt: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;

  for (const character of numFmt) {
    if (character === '"' && !bracketed) {
      quoted = !quoted;
    } else if (character === "[" && !quoted) {
      bracketed = true;
    } else if (character === "]" && !quoted) {
      bracketed = false;
    }

    if (character === ";" && !quoted && !bracketed) {
      sections.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  sections.push(current);

  return sections;
}

/** Money as a cell holds it: a number at the money precision, never a string. */
function toNumber(amount: Prisma.Decimal): number {
  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}
