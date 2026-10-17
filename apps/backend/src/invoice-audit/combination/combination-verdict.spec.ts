import type { Trip } from "@prisma/client";

import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { judgeCombinations } from "./combination-verdict";

/** One pair the Excel marks: rows 3 and 4. */
const FIRST = sheetRow({ rowNumber: 3 });
const SECOND = sheetRow({ rowNumber: 4 });
const EXCEL = { pairs: [{ first: FIRST, second: SECOND }], unpaired: [] };

function matched(
  row: InvoiceSheetRow,
  trip: Trip | null,
  status: InvoiceRowStatus = InvoiceRowStatus.MATCHED,
): InvoiceRowMatch {
  return {
    row,
    status,
    trip,
    candidates: trip ? [trip] : [],
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    costConfirmation: null,
    combination: null,
    problem: null,
  };
}

function judge(
  firstGroup: string | null,
  secondGroup: string | null,
  sizes: Record<string, number> = {},
) {
  const verdicts = judgeCombinations(
    [
      matched(FIRST, tripRecord({ id: "leg-1", tripGroupId: firstGroup })),
      matched(SECOND, tripRecord({ id: "leg-2", tripGroupId: secondGroup })),
    ],
    EXCEL,
    new Map(Object.entries(sizes)),
  );

  return [verdicts.get(3), verdicts.get(4)];
}

describe("judgeCombinations", () => {
  it("recognises the system's own group of exactly these two", () => {
    expect(judge("g", "g", { g: 2 })).toEqual([
      { verdict: "RECOGNISED", partnerRowNumber: 4, reason: null },
      { verdict: "RECOGNISED", partnerRowNumber: 3, reason: null },
    ]);
  });

  it("is GEEN COMBI when neither Trip belongs to a group", () => {
    expect(judge(null, null).map((verdict) => verdict?.verdict)).toEqual(["GEEN_COMBI", "GEEN_COMBI"]);
  });

  it.each([
    ["only one is grouped", "g", null, { g: 1 }, /Slechts één/],
    ["they are in different groups", "g", "h", { g: 2, h: 2 }, /verschillende groepen/],
    ["their group holds three", "g", "g", { g: 3 }, /telt 3 ritten/],
  ])("is under review when %s", (_label, firstGroup, secondGroup, sizes, reason) => {
    const [first, second] = judge(firstGroup, secondGroup, sizes);

    expect(first).toMatchObject({ verdict: "REVIEW", reason: expect.stringMatching(reason) });
    expect(second?.verdict).toBe("REVIEW");
  });

  it("is under review when a row of the pair is not matched", () => {
    const verdicts = judgeCombinations(
      [matched(FIRST, tripRecord({ id: "leg-1" })), matched(SECOND, null, InvoiceRowStatus.NOT_FOUND)],
      EXCEL,
      new Map(),
    );

    expect(verdicts.get(3)?.verdict).toBe("REVIEW");
    expect(verdicts.get(4)?.verdict).toBe("REVIEW");
  });

  it("is under review when both rows are one Trip", () => {
    const leg = tripRecord({ id: "leg-1" });

    expect(
      judgeCombinations([matched(FIRST, leg), matched(SECOND, leg)], EXCEL, new Map()).get(3)?.verdict,
    ).toBe("REVIEW");
  });

  it("puts every unpaired leg under review, with its reason", () => {
    const verdicts = judgeCombinations([], { pairs: [], unpaired: [{ row: FIRST, reason: "no partner" }] }, new Map());

    expect(verdicts.get(3)).toEqual({ verdict: "REVIEW", partnerRowNumber: null, reason: "no partner" });
  });
});
