import ExcelJS from "exceljs";
import { isDeepStrictEqual } from "node:util";

import { CORRECTED_TEXT_ARGB } from "./cell-marking";
import { isYellowFill, sameStyle, sameValue, stateOf } from "./cell-comparison";
import type { ChangePlan } from "./change-plan";
import { AUDIT_MARKER_SHEET, readAuditMarkers } from "./invoice-audit-marker";

/**
 * The parts of the written workbook a cell-by-cell comparison of the invoice
 * sheet does not reach: the added lines, the other worksheets, and the hidden
 * record of what this check added — see `workbook-integrity-check.ts`.
 */

/** Each added line where planned, with its numbers in red, yellow only when planned. */
export function checkAddedRows(after: ExcelJS.Worksheet, plan: ChangePlan): string[] {
  const { bookingNumber, containerNumber } = plan.identityColumns;

  return plan.addedRows.flatMap((added) => {
    const row = after.getRow(added.rowNumber);
    const problems: string[] = [];
    const expectRed = (column: number | undefined, text: string | null, name: string) => {
      if (column === undefined) {
        return;
      }

      const cell = row.getCell(column);

      if (cell.value !== text || (text !== null && cell.font?.color?.argb !== CORRECTED_TEXT_ARGB)) {
        problems.push(`Toegevoegde rij ${added.rowNumber}: ${name} is niet het geplande, in rood.`);
      }
    };

    expectRed(bookingNumber, added.bookingNumber, "boekingsnummer");
    expectRed(containerNumber, added.containerNumber, "containernummer");

    const yellow = [1, plan.lastColumnNumber].every((column) => isYellowFill(row.getCell(column).fill));

    if (yellow !== added.yellow) {
      problems.push(`Toegevoegde rij ${added.rowNumber}: ${added.yellow ? "niet" : "onverwacht"} geel gemarkeerd.`);
    }

    return problems;
  });
}

/**
 * The same worksheets in the same order and state, unchanged — except the
 * record of added lines, which must name every line added now and every line
 * an earlier run added, on the row it is on now.
 */
export function checkSheetsAndMarkers(
  original: ExcelJS.Workbook,
  written: ExcelJS.Workbook,
  sheetName: string,
  plan: ChangePlan,
): string[] {
  const shape = (workbook: ExcelJS.Workbook) =>
    workbook.worksheets
      .filter((sheet) => sheet.name !== AUDIT_MARKER_SHEET)
      .map((sheet) => `${sheet.name}:${sheet.state}`);
  const problems: string[] = isDeepStrictEqual(shape(written), shape(original))
    ? []
    : ["De werkbladen zijn gewijzigd."];

  for (const before of original.worksheets) {
    const after = written.getWorksheet(before.name);

    if (before.name !== sheetName && before.name !== AUDIT_MARKER_SHEET && after) {
      problems.push(...compareUntouchedSheet(before, after));
    }
  }

  return [...problems, ...checkMarkers(original, written, plan)];
}

function checkMarkers(original: ExcelJS.Workbook, written: ExcelJS.Workbook, plan: ChangePlan): string[] {
  const { opening } = plan;
  const expected = [...readAuditMarkers(original).values()].map((marker) => ({
    rowNumber: opening !== null && marker.rowNumber >= opening.fromRow ? marker.rowNumber + opening.count : marker.rowNumber,
    tripId: marker.tripId,
  }));

  expected.push(...plan.addedRows.map((row) => ({ rowNumber: row.rowNumber, tripId: row.tripId })));

  const recorded = [...readAuditMarkers(written).values()].map((marker) => ({
    rowNumber: marker.rowNumber,
    tripId: marker.tripId,
  }));
  const order = (markers: { rowNumber: number }[]) => [...markers].sort((a, b) => a.rowNumber - b.rowNumber);

  return isDeepStrictEqual(order(recorded), order(expected))
    ? []
    : ["Het register van toegevoegde regels vermeldt niet precies de toegevoegde regels."];
}

/** A worksheet this check never writes to: every cell exactly as it was. */
function compareUntouchedSheet(before: ExcelJS.Worksheet, after: ExcelJS.Worksheet): string[] {
  const problems: string[] = [];
  const rows = Math.max(before.rowCount, after.rowCount);
  const columns = Math.max(before.columnCount, after.columnCount);

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const was = stateOf(before.getRow(row).getCell(column));
      const is = stateOf(after.getRow(row).getCell(column));

      if (was.formula !== is.formula || !sameValue(was.value, is.value) || !sameStyle(was.style, is.style)) {
        problems.push(`${before.name}!${after.getRow(row).getCell(column).address}: gewijzigd.`);
      }
    }
  }

  return problems;
}
