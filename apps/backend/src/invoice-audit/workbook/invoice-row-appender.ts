import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { toIsoDate, toUtcDate } from "../../common/dates";
import type { AddedRow } from "../missing/added-rows";
import type { AddedRowTemplate } from "./added-row-template";
import { markTextRed } from "./cell-marking";
import { MONEY_DECIMAL_PLACES, round } from "./invoice-amounts";
import { toColumnLetter, type InvoiceColumn } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * Writes a finished transport the invoice never mentioned as a new line.
 *
 * ── WHERE THE NEW LINES GO ──────────────────────────────────────────────────
 * Directly below the document's last line and directly above its totals row —
 * where the customer would have typed them. The totals row and the summary block
 * move down to make room (see `openRowsAt`), and every formula is rewritten for
 * the move, so the totals cover the added lines and the summary still reads the
 * totals. No line the customer wrote moves: the opened rows are BELOW all of
 * them, so the row number each line is reported and corrected by stays true.
 *
 * ── AND THEY LOOK LIKE THE DOCUMENT'S OWN LINES ─────────────────────────────
 * Each column takes the style the customer's lines USUALLY have in it — see
 * `typicalStyles`. Not the first line's: a customer highlights individual lines
 * by hand, and copying one highlighted line would paint every added line with
 * it. The Supplier comes from their lines, and the Fuel follows their own
 * formula convention. Nothing is styled from scratch, and no column is invented.
 */

/**
 * Writes one missing transport as a line of this document.
 *
 * ── WHAT IS FILLED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 * Everything this system holds: the day, the times, the container, the route as
 * the Trip domain derives it, the distance, and every amount from the effective
 * pricing — the same figures the existing lines are corrected towards.
 *
 * Remarks says what this system knows about the Trip in the customer's own
 * words (`tar,EC 4220981`) — see `added-rows.ts`. Nothing is composed here.
 *
 * Startpoint, Endpoint and Route are otherwise left empty: their vocabulary
 * (`VOYAGE BEQ869`, `BE-Q869,BE-90000000`) is the customer's own planning
 * system's and no source in this one states it. The one exception is the
 * Combination marker of an established Combination's leg.
 *
 * ── RED FOR WHAT IS NEW TO THE CUSTOMER ─────────────────────────────────────
 * Every amount written, the booking and the container are red: they are what
 * the customer never stated. Everything else takes the customer's own look.
 *
 * ── A PRICE NOBODY CAN STAND BEHIND IS NOT WRITTEN ──────────────────────────
 * A Trip whose stored price is not reliable gets its line with NO amounts; the
 * writer marks it for review.
 *
 * ── AN AMOUNT OF NOTHING IS AN EMPTY CELL ───────────────────────────────────
 * Never a written 0. The customer's money format prints zero as `- €`, and
 * their own lines leave a component they do not charge EMPTY — not one literal
 * zero in the whole real `week 13` invoice.
 */
export function writeAddedRow(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  template: AddedRowTemplate,
  added: AddedRow,
  rowNumber: number,
): void {
  const row = worksheet.getRow(rowNumber);

  /*
   * The look of the customer's own lines, edge to edge — every column their
   * lines format, not only the ones written below, so the row reads as one of
   * theirs. Each cell gets a style object of its own.
   */
  for (const [columnNumber, style] of template.styles) {
    row.getCell(columnNumber).style = structuredClone(style);
  }

  const write = (column: InvoiceColumn, value: ExcelJS.CellValue, red = false) => {
    const position = sheet.columns[column];

    if (position === undefined) {
      return;
    }

    const cell = row.getCell(position);

    cell.value = value;

    if (red && value !== null) {
      markTextRed(cell);
    }
  };

  const { trip, pricing } = added;

  write("planningDate", trip.planningDate ? toUtcDate(toIsoDate(trip.planningDate)) : null);
  write("supplier", template.supplier);
  write("time", toClockTime(trip.startTime));
  write("containerType", trip.containerType);
  write("bookingNumber", trip.bookingNumber, true);
  write("containerNumber", trip.containerNumber, true);
  write("trip", added.route);
  write("distance", trip.distanceKm === null ? null : Number(trip.distanceKm));

  if (added.combinationEnd !== null) {
    write(added.combinationEnd, template.combinationMarker);
  }

  // Nothing to say is an empty cell, never an empty string.
  write("remarks", added.remarks === "" ? null : added.remarks);

  if (pricing && added.reliability.reliable) {
    write("tarief", toNumber(pricing.tarief), true);
    write("fuel", toFuelCell([added.fuelRate, template.fuelPercentage], pricing, sheet, rowNumber), true);
    write("backload", toNumber(pricing.backload), true);
    // The same toll convention as a correction: the figure goes to Tol B, and
    // the columns the customer leaves empty stay empty.
    write("tolB", toNumber(pricing.tol), true);
    write("tunnel", toNumber(pricing.tunnel), true);
    write("others", toNumber(pricing.others), true);
    write("ek", toNumber(pricing.ek), true);
  }

  row.commit();
}

/**
 * The Fuel cell of an added line: a FORMULA on this row's own Tarief, so Excel
 * calculates the Fuel from the Tarief like on the customer's own lines.
 *
 * ── WHICH PERCENTAGE ────────────────────────────────────────────────────────
 * The Trip's OWN — the rate its stored price was calculated at, which is the
 * rule the Fuel follows everywhere in this system (`resolveFuel`). Never a
 * constant of ours and never the current setting: a Trip keeps the rate it
 * was priced at. Failing that (a snapshot from before the rate was recorded),
 * the percentage the document itself writes. In the customer's own shape,
 * `24%*L5`.
 *
 * A percentage is used only when its formula comes to exactly the Fuel this
 * system holds, to the cent, so Excel shows what the check stands behind.
 * When none does, the amount is written as a figure: the amount is what must
 * be right, not the arithmetic that produced it.
 */
function toFuelCell(
  percentages: readonly (Prisma.Decimal | null)[],
  pricing: { tarief: Prisma.Decimal; brandstof: Prisma.Decimal },
  sheet: InvoiceSheet,
  rowNumber: number,
): ExcelJS.CellValue {
  const brandstof = round(pricing.brandstof);

  // No fuel is an empty cell, not a formula that comes to `- €`.
  if (brandstof.isZero()) {
    return null;
  }

  const percentage = percentages.find(
    (candidate): candidate is Prisma.Decimal =>
      candidate !== null && candidate.greaterThan(0) && fuelFormulaProduces(candidate, pricing),
  );

  if (percentage === undefined || sheet.columns.tarief === undefined) {
    return toNumber(brandstof);
  }

  return {
    formula: `${percentage.toString()}%*${toColumnLetter(sheet.columns.tarief)}${rowNumber}`,
    // Never zero here: a zero fuel returned an empty cell above.
    result: Number(brandstof.toFixed(MONEY_DECIMAL_PLACES)),
  };
}

/**
 * Whether `P%*L<row>` comes to exactly the Fuel this system holds — the cent the
 * customer's Excel will show, rounded as it rounds.
 */
export function fuelFormulaProduces(
  percentage: Prisma.Decimal,
  pricing: { tarief: Prisma.Decimal; brandstof: Prisma.Decimal },
): boolean {
  const produced = round(round(pricing.tarief).mul(percentage).div(100));

  return produced.equals(round(pricing.brandstof));
}

/** `08:30`, as the document's own Time column states it. */
function toClockTime(time: Date | null): string | null {
  if (time === null) {
    return null;
  }

  return time.toISOString().slice(11, 16);
}

/** The amount as a cell holds it, or nothing at all for an amount of zero. */
function toNumber(amount: Prisma.Decimal): number | null {
  const rounded = Number(amount.toFixed(MONEY_DECIMAL_PLACES));

  return rounded === 0 ? null : rounded;
}
