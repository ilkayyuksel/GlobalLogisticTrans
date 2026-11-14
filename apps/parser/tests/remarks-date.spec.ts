import { remarksDateOf } from "../src/fields/remarks-date";

/**
 * `dd 26/10` in a Cost Confirmation's Remarks: the day the cost was incurred,
 * read beside the confirmation's own transport date — never a guessed year.
 */
describe("the day a confirmation's Remarks name", () => {
  it("reads dd 26/10 beside a loading date of 27/10/2026 as 26 October 2026", () => {
    expect(remarksDateOf("dd 26/10", "2026-10-27")).toBe("2026-10-26");
  });

  it.each([
    ["DD 26/10", "2026-10-26"],
    ["dd. 26-10", "2026-10-26"],
    ["dd26.10", "2026-10-26"],
    ["calculation after 0.5 hrs dd 26/10", "2026-10-26"],
    ["dd 26/10/2026", "2026-10-26"],
    ["dd 26/10/26", "2026-10-26"],
    ["stop dd 26/10, wait dd 26/10", "2026-10-26"],
  ])("reads %p", (remarks, day) => {
    expect(remarksDateOf(remarks, "2026-10-27")).toBe(day);
  });

  it("places a day across New Year in the year that makes it near", () => {
    expect(remarksDateOf("dd 31/12", "2027-01-02")).toBe("2026-12-31");
    expect(remarksDateOf("dd 02/01", "2026-12-30")).toBe("2027-01-02");
  });

  it.each([
    ["no dd at all", "calculation after 0.5 hrs", "2026-10-27"],
    ["a day more than a week away", "dd 10/10", "2026-10-27"],
    ["an impossible day", "dd 31/02", "2026-02-27"],
    ["two different days", "dd 26/10 and dd 25/10", "2026-10-27"],
    ["a printed year far away", "dd 26/10/2025", "2026-10-27"],
    ["no transport date to read it beside", "dd 26/10", null],
    ["no Remarks", null, "2026-10-27"],
    ["digits glued to a longer number", "dd 26/105", "2026-10-27"],
  ])("reads nothing for %s", (_case, remarks, transportDate) => {
    expect(remarksDateOf(remarks, transportDate)).toBeNull();
  });
});
