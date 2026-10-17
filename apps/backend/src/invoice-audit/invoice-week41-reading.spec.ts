import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AppLoggerService } from "../logger/app-logger.service";
import { findExcelCombinations } from "./combination/excel-combination-pairs";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";

/**
 * The customer's week 41 invoice, READ — the file the owner wants corrected.
 *
 * ── READ ONLY ───────────────────────────────────────────────────────────────
 * The file is the customer's and stays exactly as it is: it is loaded into a
 * buffer, never written, and its hash is checked after the read. Like the
 * week 13 suite, this runs wherever a copy is present and is skipped where it
 * is not — the figures are the customer's and are not in the repository.
 *
 * ── WHAT IT PROVES ──────────────────────────────────────────────────────────
 * The Fuel column of this file is one shared formula per block: `M2` holds
 * `24%*L2` and `M3` to `M68` borrow it. Read as plain figures, those borrowers
 * would look fixed while Excel recalculates them from the row's Tarief.
 */
const WEEK_41 = resolve(__dirname, "../../../../docs/07-excels/week 41 - 2026 GLT.xlsx");

const describeWithWeek41 = existsSync(WEEK_41) ? describe : describe.skip;

describeWithWeek41("the real week 41 invoice, read", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  it("reads every Fuel cell of a shared formula as the formula Excel calculates", async () => {
    const bytes = readFileSync(WEEK_41);
    const sheet = await new InvoiceSheetReader(logger).read(bytes, "week 41 - 2026 GLT.xlsx");
    const fuelOf = (rowNumber: number) =>
      sheet.rows.find((row) => row.rowNumber === rowNumber)?.amounts.fuel;

    // The master, and a borrower of it.
    expect(fuelOf(2)).toMatchObject({ formula: "24%*L2", unreadable: false });
    expect(fuelOf(3)).toMatchObject({ formula: "24%*L3", unreadable: false });
    expect(fuelOf(3)?.value?.toString()).toBe("43.044");
    // A borrower of the second block.
    expect(fuelOf(70)).toMatchObject({ formula: "24%*L70" });
  });

  it("finds the lines, the three Cost Confirmation lines, the totals and the summary", async () => {
    const sheet = await new InvoiceSheetReader(logger).read(
      readFileSync(WEEK_41),
      "week 41 - 2026 GLT.xlsx",
    );
    const costLines = sheet.rows.filter((row) => row.costLine !== null);

    expect(sheet.rows).toHaveLength(126);
    // R53 and R54 state no container; R107 does. All three charge one EC.
    expect(costLines.map((row) => [row.rowNumber, row.costLine!.ccNumbers])).toEqual([
      [53, ["4220981"]],
      [54, ["4220982"]],
      [107, ["4224479"]],
    ]);
    expect(sheet.incompleteRowNumbers).toEqual([]);
    expect(sheet.totalsRowNumber).toBe(128);
    expect(sheet.summaryRowNumbers).toEqual([130, 131, 132, 133, 134, 135, 136, 137, 138, 139]);
    // No amount cell of the customer's lines is unreadable.
    expect(
      sheet.rows.flatMap((row) => Object.values(row.amounts)).some((cell) => cell?.unreadable),
    ).toBe(false);
  });

  /** All 13 pairs of week 41 follow the convention; none is left over. */
  it("finds the 13 Combinations the customer marks, each with its own second leg", async () => {
    const sheet = await new InvoiceSheetReader(logger).read(
      readFileSync(WEEK_41),
      "week 41 - 2026 GLT.xlsx",
    );
    const { pairs, unpaired } = findExcelCombinations(sheet.rows);

    expect(pairs.map((pair) => [pair.first.rowNumber, pair.second.rowNumber])).toEqual([
      [3, 4],
      [23, 24],
      [29, 30],
      [31, 32],
      [33, 34],
      [75, 76],
      [79, 80],
      [82, 83],
      [88, 89],
      [90, 91],
      [93, 94],
      [114, 115],
      [117, 118],
    ]);
    expect(unpaired).toEqual([]);
  });

  it("leaves the file exactly as it was", async () => {
    const before = sha256(readFileSync(WEEK_41));

    await new InvoiceSheetReader(logger).read(readFileSync(WEEK_41), "week 41 - 2026 GLT.xlsx");

    expect(sha256(readFileSync(WEEK_41))).toBe(before);
  });
});
