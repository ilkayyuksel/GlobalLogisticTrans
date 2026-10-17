import { sheetRow } from "../__fixtures__/invoice-rows";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { findExcelCombinations } from "./excel-combination-pairs";

/** The two legs as the customer writes them, week 41 style. */
const first = (rowNumber: number, container: string, overrides: Partial<InvoiceSheetRow> = {}) =>
  sheetRow({ rowNumber, containerNumber: container, startPoint: "VOYAGE BEQ869", endPoint: "COMBINATION ", ...overrides });
const second = (rowNumber: number, container: string, overrides: Partial<InvoiceSheetRow> = {}) =>
  sheetRow({ rowNumber, containerNumber: container, startPoint: "COMBINATION ", endPoint: "VOYAGE BEQ869", ...overrides });
const plain = (rowNumber: number, container: string) => sheetRow({ rowNumber, containerNumber: container });

const pairsOf = (rows: readonly InvoiceSheetRow[]) =>
  findExcelCombinations(rows).pairs.map((pair) => [pair.first.rowNumber, pair.second.rowNumber]);
const unpairedOf = (rows: readonly InvoiceSheetRow[]) =>
  findExcelCombinations(rows).unpaired.map((entry) => entry.row.rowNumber).sort((a, b) => a - b);

describe("findExcelCombinations", () => {
  it("pairs a first leg with the second leg directly below it", () => {
    const rows = [first(3, "EUCU 4580491"), second(4, "EUCU 4580491"), plain(5, "EUCU 4541197")];

    expect(pairsOf(rows)).toEqual([[3, 4]]);
    expect(unpairedOf(rows)).toEqual([]);
  });

  it("pairs every adjacent pair of a week", () => {
    const rows = [
      first(23, "PVDU 1133482"),
      second(24, "PVDU 1133482"),
      first(29, "EUCU 4580188"),
      second(30, "EUCU 4580188"),
    ];

    expect(pairsOf(rows)).toEqual([
      [23, 24],
      [29, 30],
    ]);
  });

  it("pairs with the one second leg of its container when it is not directly below", () => {
    const rows = [first(3, "EUCU 4580491"), plain(4, "PVDU 1135150"), second(9, "EUCU 4580491")];

    expect(pairsOf(rows)).toEqual([[3, 9]]);
  });

  it("matches the marker whatever its spacing and case", () => {
    const rows = [
      first(3, "EUCU 4580491", { endPoint: " combination" }),
      second(4, "EUCU 4580491", { startPoint: "COMBINATION" }),
    ];

    expect(pairsOf(rows)).toEqual([[3, 4]]);
  });

  it("never pairs rows of different containers", () => {
    const rows = [first(3, "EUCU 4580491"), second(4, "PVDU 1133482")];

    expect(pairsOf(rows)).toEqual([]);
    expect(unpairedOf(rows)).toEqual([3, 4]);
  });

  it("reports a leg without a partner — a Combination across the week's edge", () => {
    expect(unpairedOf([first(90, "EUCU 4581862")])).toEqual([90]);
    expect(unpairedOf([second(91, "EUCU 4581862")])).toEqual([91]);
  });

  it("reports a first leg with several possible partners", () => {
    const rows = [
      first(3, "EUCU 4580491"),
      plain(4, "X"),
      second(7, "EUCU 4580491"),
      second(9, "EUCU 4580491"),
    ];

    expect(pairsOf(rows)).toEqual([]);
    expect(unpairedOf(rows)).toEqual([3, 7, 9]);
  });

  it("reports two first legs claiming one second leg", () => {
    const rows = [first(3, "EUCU 4580491"), plain(4, "X"), first(6, "EUCU 4580491"), second(7, "EUCU 4580491")];

    expect(pairsOf(rows)).toEqual([]);
    expect(unpairedOf(rows)).toEqual([3, 6, 7]);
  });

  it("reports a row marked as both legs", () => {
    const rows = [first(3, "EUCU 4580491", { startPoint: "COMBINATION " })];

    expect(unpairedOf(rows)).toEqual([3]);
  });

  it("ignores ordinary lines and Cost Confirmation lines", () => {
    const rows = [
      plain(2, "CNEU 4692827"),
      plain(109, "CNEU 4692827"),
      sheetRow({ rowNumber: 53, costLine: { ccNumbers: ["4220981"] }, endPoint: "COMBINATION " }),
    ];

    expect(findExcelCombinations(rows)).toEqual({ pairs: [], unpaired: [] });
  });
});
