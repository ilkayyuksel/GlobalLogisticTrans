import ExcelJS from "exceljs";

/**
 * A weekly invoice workbook, built to the structure of the real ones.
 *
 * ── WHY THE FIXTURE IS SYNTHETIC ────────────────────────────────────────────
 * The customer's actual weekly invoices carry their commercial figures, and
 * they are not in the repository. This builder reproduces everything the reader
 * has to cope with — the 21 columns in their order, a header row, transports
 * below it, a totals row of SUM formulas, a blank line, and a summary block
 * whose cells point back at the totals — so the tests hold the real shape
 * without holding the real numbers.
 *
 * The structural facts it reproduces were read off both reference files:
 *   * one worksheet;
 *   * header on row 1, transports from row 2;
 *   * the totals row states no transport but money in every amount column;
 *   * the summary block states a label in one column and a formula in the next;
 *   * containers are printed WITH a space, which the stored ones do not have;
 *   * the same booking and container may appear on several lines, once per
 *     Cost Confirmation, carrying only an EK amount.
 */

/** The customer's columns, in the order their sheet prints them. */
export const INVOICE_HEADERS: readonly string[] = [
  "Planning date",
  "Supplier",
  "Time (requested)",
  "Containertype",
  "Bookingnr",
  "Container nr.",
  "Startpoint",
  "Trip",
  "Distance",
  "Route",
  "Endpoint",
  "Tarief",
  "Fuel 10%",
  "Backload",
  "Maut",
  "Tol B",
  "Tol FR",
  "Tunnel",
  "Others",
  "EK",
  "Remarks",
];

/** One transport as the customer's sheet states it. */
export interface InvoiceFixtureLine {
  /** A real date cell by default; a string or a number to test the others. */
  readonly planningDate: Date | string | number;
  readonly bookingNumber: string;
  /** As the sheet spells it — the real files print a space. */
  readonly containerNumber: string;
  readonly tarief?: number | null;
  /**
   * The Fuel amount.
   *
   * `"formula"` writes it as the real files do — `10%*L<row>`, a percentage of
   * this row's Tarief — which is the case the correction has to leave alone.
   */
  readonly fuel?: number | null | "formula";
  readonly backload?: number | null;
  readonly maut?: number | null;
  readonly tolB?: number | null;
  readonly tolFr?: number | null;
  readonly tunnel?: number | null;
  readonly others?: number | null;
  readonly ek?: number | null;
  readonly remarks?: string;
}

export interface InvoiceFixtureOptions {
  readonly lines: readonly InvoiceFixtureLine[];
  /** Overrides the header row entirely, for the malformed-structure tests. */
  readonly headers?: readonly string[];
  /** The percentage the Fuel column charges. The header carries it. */
  readonly fuelPercentage?: number;
  /** Whether the totals row and the summary block are written at all. */
  readonly withTotals?: boolean;
  /** Rows to write above the header, as a sheet with a title would have. */
  readonly rowsAboveHeader?: readonly (readonly unknown[])[];
  readonly sheetName?: string;
  /** Written after the transports, before the totals: the incomplete cases. */
  readonly incompleteLines?: readonly (readonly unknown[])[];
  /**
   * Writes the Fuel column as Excel's own SHARED formula: the first line holds
   * it and the ones below borrow it.
   *
   * This is how the real invoices are written — one week holds 11 masters and 94
   * borrowers — and it is the shape that makes writing the workbook fail if a
   * master is overwritten without care. A fixture without it cannot prove the
   * corrected document opens at all.
   */
  readonly sharedFuelFormula?: boolean;
}

const COLUMN = {
  planningDate: 1,
  supplier: 2,
  containerType: 4,
  bookingNumber: 5,
  containerNumber: 6,
  startPoint: 7,
  trip: 8,
  endPoint: 11,
  tarief: 12,
  fuel: 13,
  backload: 14,
  maut: 15,
  tolB: 16,
  tolFr: 17,
  tunnel: 18,
  others: 19,
  ek: 20,
  remarks: 21,
} as const;

/** The amount columns, which is what makes the totals row look like data. */
const AMOUNT_COLUMNS = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;

/** The euro format the real files carry on every amount column. */
const MONEY_FORMAT =
  '_-"€"* #,##0.00_-;-"€"* #,##0.00_-;_-"€"* "-"??_-;_-@_-';

/**
 * Maut and Tol FR are hidden in every reference workbook, and empty on every
 * data row of all four of them. The fixture reproduces that, because the toll
 * rule depends on it and a test on a sheet where they were visible would prove
 * nothing about the documents this reads.
 */
const HIDDEN_COLUMNS = [15, 17] as const;

export async function buildInvoiceWorkbook(
  options: InvoiceFixtureOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName ?? "Sheet1");

  for (const row of options.rowsAboveHeader ?? []) {
    sheet.addRow([...row]);
  }

  sheet.addRow([...(options.headers ?? withFuelHeader(options.fuelPercentage))]);

  for (const column of AMOUNT_COLUMNS) {
    sheet.getColumn(column).numFmt = MONEY_FORMAT;
  }

  for (const column of HIDDEN_COLUMNS) {
    sheet.getColumn(column).hidden = true;
  }

  const firstLineRow = sheet.rowCount + 1;

  for (const line of options.lines) {
    const row = sheet.getRow(sheet.rowCount + 1);

    row.getCell(COLUMN.planningDate).value = line.planningDate;
    row.getCell(COLUMN.supplier).value = "GLT";
    row.getCell(COLUMN.containerType).value = "45PH";
    row.getCell(COLUMN.bookingNumber).value = line.bookingNumber;
    row.getCell(COLUMN.containerNumber).value = line.containerNumber;
    row.getCell(COLUMN.startPoint).value = "VOYAGE BEQ869";
    row.getCell(COLUMN.trip).value = "Quay 869 -> ZEMST";
    row.getCell(COLUMN.endPoint).value = "COMBINATION ";
    row.getCell(COLUMN.tarief).value = line.tarief ?? null;
    row.getCell(COLUMN.fuel).value = toFuelCell(line, row.number, options, firstLineRow);
    row.getCell(COLUMN.backload).value = line.backload ?? null;
    row.getCell(COLUMN.maut).value = line.maut ?? null;
    row.getCell(COLUMN.tolB).value = line.tolB ?? null;
    row.getCell(COLUMN.tolFr).value = line.tolFr ?? null;
    row.getCell(COLUMN.tunnel).value = line.tunnel ?? null;
    row.getCell(COLUMN.others).value = line.others ?? null;
    row.getCell(COLUMN.ek).value = line.ek ?? null;
    row.getCell(COLUMN.remarks).value = line.remarks ?? "";

    for (const column of AMOUNT_COLUMNS) {
      row.getCell(column).numFmt = MONEY_FORMAT;
    }

    row.commit();
  }

  for (const row of options.incompleteLines ?? []) {
    sheet.addRow([...row]);
  }

  if (options.withTotals !== false) {
    writeTotals(sheet, firstLineRow);
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer);
}

/**
 * The Fuel cell: a figure, a formula of its own, or one borrowed from the first
 * line's.
 */
function toFuelCell(
  line: InvoiceFixtureLine,
  rowNumber: number,
  options: InvoiceFixtureOptions,
  firstLineRow: number,
): ExcelJS.CellValue {
  if (line.fuel !== "formula") {
    return line.fuel ?? null;
  }

  // What Excel last calculated, as a saved workbook carries it.
  const result = Number(((line.tarief ?? 0) * 0.1).toFixed(2));

  if (!options.sharedFuelFormula) {
    return { formula: `10%*L${rowNumber}`, result };
  }

  return rowNumber === firstLineRow
    ? ({
        formula: `10%*L${rowNumber}`,
        result,
        shareType: "shared",
        ref: `M${firstLineRow}:M${firstLineRow + options.lines.length - 1}`,
      } as unknown as ExcelJS.CellValue)
    : ({ sharedFormula: `M${firstLineRow}`, result } as ExcelJS.CellValue);
}

/** The header, with whatever percentage this sheet's Fuel column charges. */
function withFuelHeader(percentage = 10): string[] {
  return INVOICE_HEADERS.map((header) =>
    header.startsWith("Fuel") ? `Fuel ${percentage}%` : header,
  );
}

/**
 * The totals row and the summary block beneath it.
 *
 * Exactly as the real files have them: the totals row names no transport and
 * sums each amount column; a blank line follows; then the block of labels whose
 * values point back at the totals row.
 */
function writeTotals(sheet: ExcelJS.Worksheet, firstLineRow: number): void {
  const lastLineRow = sheet.rowCount;
  const totalsRow = sheet.getRow(lastLineRow + 1);

  for (const column of AMOUNT_COLUMNS) {
    const letter = sheet.getColumn(column).letter;

    totalsRow.getCell(column).value = {
      formula: `SUM(${letter}${firstLineRow}:${letter}${lastLineRow})`,
      result: 0,
    };
  }

  totalsRow.getCell(21).value = { formula: "SUM(L2:T2)", result: 0 };
  totalsRow.commit();

  const labels = [
    "Total",
    "Fuel 10% ",
    "Backloads",
    "Maut D",
    "Tol B",
    "Tol FR",
    "Tunnel",
    "Others ",
    "EK",
    "Total",
  ];

  // The blank line the real files have between the totals and the block.
  sheet.addRow([]);

  labels.forEach((label, index) => {
    const row = sheet.getRow(sheet.rowCount + 1);

    row.getCell(11).value = label;
    row.getCell(12).value = {
      formula: `${sheet.getColumn(12 + index).letter}${totalsRow.number}`,
      result: 0,
    };
    row.commit();
  });
}
