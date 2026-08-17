import { toLocationLabel } from "./export-location-codes";

/**
 * The export's destination codes.
 *
 * These tests guard two things in equal measure: that the two codes the
 * operator's sheet shows come out exactly, and that nothing here ever behaves
 * like a general name-resolution layer — an unlisted destination must come back
 * as "no code", never as a guess.
 */
describe("a configured destination", () => {
  it.each([
    ["ZEEBRUGGE", "LOCATION BEQ869"],
    ["LESSINES", "LOCATION BEBAXLES"],
  ])("gives %s the label %s", (city, label) => {
    expect(toLocationLabel(city)).toBe(label);
  });

  /**
   * A document may print a city in any casing; the code it refers to is the
   * same one. Only the lookup is case-insensitive — the stored city itself is
   * never rewritten.
   */
  it.each(["Zeebrugge", "zeebrugge", "  ZEEBRUGGE  "])(
    "is found when written as %s",
    (written) => {
      expect(toLocationLabel(written)).toBe("LOCATION BEQ869");
    },
  );
});

describe("an unconfigured destination", () => {
  it.each(["Grobbendonk", "Ghlin", "Dourges", "Gent", ""])(
    "has no code for %s",
    (city) => {
      expect(toLocationLabel(city)).toBeNull();
    },
  );

  /**
   * The one behaviour that must never appear: a code assembled from the city.
   * The real codes cannot be computed — `Lessines` becomes `BEBAXLES` — so any
   * output for an unlisted city would be an invention.
   */
  it("builds no code from a city that merely looks Belgian", () => {
    expect(toLocationLabel("Brugge")).toBeNull();
    expect(toLocationLabel("Lessines-Sud")).toBeNull();
  });
});

describe("what this map is not", () => {
  /**
   * Terminals keep their own strings, everywhere. This map may never become a
   * second name for one.
   */
  it.each(["PSA Quay 869", "Quay 869", "PSA Antwerp", "Europaterminal"])(
    "does not resolve the terminal %s",
    (terminal) => {
      expect(toLocationLabel(terminal)).toBeNull();
    },
  );
});
