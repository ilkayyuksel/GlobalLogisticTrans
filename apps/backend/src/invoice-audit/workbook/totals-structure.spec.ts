import { openThreeLineWeek as openWeek } from "../__fixtures__/invoice-opened";
import { checkTotalsStructure } from "./totals-structure";

describe("checkTotalsStructure", () => {
  it("accepts the structure every real week has", async () => {
    const { worksheet, sheet } = await openWeek();

    expect(sheet.totalsRowNumber).toBe(5);
    expect(checkTotalsStructure(worksheet, sheet)).toEqual({ sound: true, problems: [] });
  });

  it("accepts a document without totals: nothing can leave an added line out", async () => {
    const { worksheet, sheet } = await openWeek({ withTotals: false });

    expect(checkTotalsStructure(worksheet, sheet).sound).toBe(true);
  });

  /** Week 36 as corrected by hand: `SUM(N2:N138)` beside `SUM(L2:L141)`. */
  it("refuses a component total that stops short of the totals row", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("N5").value = { formula: "SUM(N2:N3)", result: 0 };

    const structure = checkTotalsStructure(worksheet, sheet);

    expect(structure.sound).toBe(false);
    expect(structure.problems).toEqual([expect.stringContaining("Backload")]);
    expect(structure.problems[0]).toContain("SUM(N2:N3)");
  });

  it("refuses a total that adds up another column", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("M5").value = { formula: "SUM(L2:L4)", result: 0 };

    expect(checkTotalsStructure(worksheet, sheet).problems).toEqual([
      expect.stringContaining("another column"),
    ]);
  });

  it("refuses a total typed in as a figure", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("L5").value = 405;

    expect(checkTotalsStructure(worksheet, sheet).problems).toEqual([
      expect.stringContaining("no SUM"),
    ]);
  });

  it("refuses a grand total that leaves a component out", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("U5").value = { formula: "SUM(L5:S5)", result: 0 };

    expect(checkTotalsStructure(worksheet, sheet).problems).toEqual([
      expect.stringContaining("grand total SUM(L5:T5)"),
    ]);
  });

  it("refuses a summary that reads another row than the totals", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("L7").value = { formula: "L4", result: 0 };

    expect(checkTotalsStructure(worksheet, sheet).problems).toEqual([
      expect.stringContaining("summary L7 reads row 4"),
    ]);
  });

  it("refuses a Fuel label that states another percentage than the header", async () => {
    const { worksheet, sheet } = await openWeek();

    worksheet.getCell("K8").value = "Fuel 13% ";

    expect(checkTotalsStructure(worksheet, sheet).problems).toEqual([
      expect.stringContaining("does not state the header's 10%"),
    ]);
  });
});
