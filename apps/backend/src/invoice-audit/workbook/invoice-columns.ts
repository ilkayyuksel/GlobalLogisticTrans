/**
 * The columns of a customer weekly invoice, recognised by their HEADER TEXT.
 *
 * ── WHY NOT BY POSITION ─────────────────────────────────────────────────────
 * The sheet is the customer's document, not ours. Its columns sit where they
 * sit today, and a column inserted next week would silently shift every index —
 * which would not fail, it would simply read the wrong values and match the
 * wrong Trips. Reading the header row costs one pass and makes a changed layout
 * a refusal instead of a wrong answer.
 *
 * ── AND WHY THE FUEL COLUMN IS A PATTERN ────────────────────────────────────
 * It is printed as `Fuel 10%`, with the percentage the customer applies. That
 * percentage is theirs to change, and a literal match would refuse the whole
 * document the week it becomes `Fuel 12%`. The word and the percent sign are
 * what identify the column; the number between them is data.
 */

/** A header, as it is compared: trimmed, collapsed, case-folded. */
export function toHeaderKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Every column this system knows, with the header that identifies it.
 *
 * ── KNOWING A COLUMN IS NOT NEEDING IT ──────────────────────────────────────
 * Only `REQUIRED_COLUMNS` decides whether a document can be checked at all. The
 * others are here because a line ADDED to the invoice fills them — the Supplier,
 * the time, the distance — and a column the document does not have is simply
 * not written to.
 */
export const INVOICE_COLUMNS = {
  planningDate: "Planning date",
  supplier: "Supplier",
  time: "Time (requested)",
  containerType: "Containertype",
  bookingNumber: "Bookingnr",
  containerNumber: "Container nr.",
  startPoint: "Startpoint",
  trip: "Trip",
  distance: "Distance",
  route: "Route",
  endPoint: "Endpoint",
  tarief: "Tarief",
  backload: "Backload",
  maut: "Maut",
  tolB: "Tol B",
  tolFr: "Tol FR",
  tunnel: "Tunnel",
  others: "Others",
  ek: "EK",
  remarks: "Remarks",
} as const;

export type InvoiceColumn = keyof typeof INVOICE_COLUMNS | "fuel";

/**
 * The three that identify a line, and are therefore required.
 *
 * A document without them cannot be checked at all — there is nothing to match
 * on — so their absence is what makes a workbook unreadable rather than merely
 * incomplete. The money columns are required too, since a check that cannot see
 * an amount would report agreement it never verified.
 */
export const REQUIRED_COLUMNS: readonly InvoiceColumn[] = [
  "planningDate",
  "bookingNumber",
  "containerNumber",
  "tarief",
  "fuel",
  "backload",
  "tolB",
  "tunnel",
  "others",
  "ek",
];

/** The Fuel column, whatever percentage it happens to charge. */
const FUEL_HEADER = /^fuel\s+\d+([.,]\d+)?\s*%$/;

/** Where each column sits in this particular workbook. 1-based, as Excel is. */
export type InvoiceColumnPositions = Readonly<Partial<Record<InvoiceColumn, number>>>;

export interface ColumnResolution {
  readonly positions: InvoiceColumnPositions;
  /** Required columns this header row does not offer, in declaration order. */
  readonly missing: readonly InvoiceColumn[];
}

/**
 * Which column is which, read from the header row.
 *
 * Headers are matched exactly once each: a sheet that repeats a header keeps the
 * FIRST occurrence, because a later duplicate is a stray cell rather than a
 * second meaning, and silently preferring the last one would read a column
 * nobody intended.
 */
export function resolveColumns(
  headerCells: readonly (string | null)[],
): ColumnResolution {
  const positions: Partial<Record<InvoiceColumn, number>> = {};

  headerCells.forEach((value, index) => {
    if (value === null) {
      return;
    }

    const column = toColumn(value);

    if (column !== null && positions[column] === undefined) {
      // The array is 0-based and Excel is 1-based; the caller works in Excel's
      // coordinates, so the conversion happens once, here.
      positions[column] = index + 1;
    }
  });

  return {
    positions,
    missing: REQUIRED_COLUMNS.filter((column) => positions[column] === undefined),
  };
}

/** The column a header names, or null when it names none this system reads. */
function toColumn(header: string): InvoiceColumn | null {
  const key = toHeaderKey(header);

  if (FUEL_HEADER.test(key)) {
    return "fuel";
  }

  const named = Object.entries(INVOICE_COLUMNS).find(
    ([, text]) => toHeaderKey(text) === key,
  );

  return named ? (named[0] as InvoiceColumn) : null;
}

/**
 * A column number as Excel spells it: 1 is A, 27 is AA.
 *
 * Needed to read a formula, which refers to cells by letter — the Fuel column's
 * `10%*L7` has to be recognised as a percentage of THIS row's Tarief, and that
 * comparison happens in the sheet's own coordinates.
 */
export function toColumnLetter(columnNumber: number): string {
  let remaining = columnNumber;
  let letters = "";

  while (remaining > 0) {
    const index = (remaining - 1) % 26;

    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return letters;
}

/** What a refusal says: the headers, in the words the customer's sheet uses. */
export function toHeaderText(column: InvoiceColumn): string {
  return column === "fuel" ? "Fuel <percentage>%" : INVOICE_COLUMNS[column];
}
