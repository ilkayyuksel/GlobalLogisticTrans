import { TripDirection } from "@prisma/client";

import {
  isSameTerminal,
  toCanonicalTerminal,
  toTripRoute,
} from "./trip-route";

/**
 * The canonical route, and the one normalization it is allowed to perform.
 *
 * ── WHAT THESE TESTS PROTECT ────────────────────────────────────────────────
 * Two faults, both silent:
 *
 *   1. a route built in the wrong order. A delivery and a collection between
 *      the same two places are DIFFERENT routes, and future pricing will charge
 *      them differently — so an order taken from the page layout rather than
 *      from the recorded direction would be invisible until somebody was
 *      invoiced wrongly.
 *   2. an over-eager prefix strip. `replace("PSA", "")` on arbitrary text
 *      corrupts any terminal whose real name contains those letters, and a
 *      corrupted terminal name does not look wrong — it just stops matching.
 * ────────────────────────────────────────────────────────────────────────────
 */

describe("the canonical terminal", () => {
  /** The two spellings the documents actually produce. */
  it("removes the PSA prefix a collection document prints", () => {
    expect(toCanonicalTerminal("PSA Quay 869")).toBe("Quay 869");
  });

  it("leaves the spelling a delivery document prints alone", () => {
    expect(toCanonicalTerminal("Quay 869")).toBe("Quay 869");
  });

  it("resolves both spellings to one value", () => {
    expect(toCanonicalTerminal("PSA Quay 869")).toBe(
      toCanonicalTerminal("Quay 869"),
    );
  });

  describe("whitespace and case", () => {
    it.each([
      ["PSA Quay 869", "Quay 869"],
      ["  PSA Quay 869  ", "Quay 869"],
      ["PSA   Quay 869", "Quay 869"],
      ["PSA\tQuay 869", "Quay 869"],
      ["PSA\nQuay 869", "Quay 869"],
      ["psa quay 869", "quay 869"],
      ["PSA QUAY 869", "QUAY 869"],
      ["  Quay   869  ", "Quay 869"],
    ])("normalizes %j to %j", (raw, expected) => {
      expect(toCanonicalTerminal(raw)).toBe(expected);
    });

    /**
     * The NAME is preserved, case included. Only the prefix was declared
     * removable, so upper-casing or title-casing the rest would be renaming a
     * terminal rather than normalizing one.
     */
    it("does not change the case of the terminal it keeps", () => {
      expect(toCanonicalTerminal("PSA QUAY 869")).toBe("QUAY 869");
      expect(toCanonicalTerminal("PSA quay 869")).toBe("quay 869");
    });
  });

  /**
   * ── THE PREFIX IS NOT A SUBSTRING ─────────────────────────────────────────
   * Every one of these contains the letters PSA and must come through
   * untouched. This is the test that stops a blunt replace from shipping.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("terminals that merely contain PSA", () => {
    it.each([
      "PSA Noordzee Terminal",
      "PSA Antwerp",
      "PSA Europa Terminal",
      "Antwerp PSA Quay 913",
      "PSATerminal Quay 869",
      "Kaai PSA 869",
      "PSA",
      "Quay PSA 869",
    ])("leaves %j exactly as it is", (terminal) => {
      expect(toCanonicalTerminal(terminal)).toBe(terminal);
    });

    /** Only the token immediately before a quay is a terminal prefix. */
    it("strips nothing when PSA does not precede a quay", () => {
      expect(toCanonicalTerminal("PSA Europaterminal")).toBe(
        "PSA Europaterminal",
      );
    });
  });

  describe("absent values", () => {
    it("reports null for a Trip with no terminal", () => {
      expect(toCanonicalTerminal(null)).toBeNull();
    });

    it("treats a blank terminal as none", () => {
      expect(toCanonicalTerminal("   ")).toBeNull();
    });
  });
});

describe("matching two terminals", () => {
  it.each([
    ["PSA Quay 869", "Quay 869"],
    ["PSA Quay 869", "PSA Quay 869"],
    ["psa quay 869", "QUAY 869"],
    ["  PSA   Quay 869 ", "Quay 869"],
  ])("resolves %j and %j to the same terminal", (left, right) => {
    expect(isSameTerminal(left, right)).toBe(true);
  });

  it.each([
    ["PSA Quay 869", "Quay 913"],
    ["PSA Quay 869", "PSA Antwerp"],
    ["Quay 869", null],
    [null, "Quay 869"],
  ])("keeps %j and %j apart", (left, right) => {
    expect(isSameTerminal(left, right)).toBe(false);
  });

  it("treats two absent terminals as the same absence", () => {
    expect(isSameTerminal(null, null)).toBe(true);
  });
});

describe("the canonical route", () => {
  /**
   * ── DELIVERY: OUT OF THE QUAY ─────────────────────────────────────────────
   * The container leaves the terminal and goes to the customer, so the terminal
   * is where the Trip STARTS.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a DELIVERY Trip", () => {
    it("runs from the terminal to the city", () => {
      expect(
        toTripRoute({
          direction: TripDirection.DELIVERY,
          terminal: "PSA Quay 869",
          destinationCity: "Antwerp",
        }),
      ).toEqual({ from: "Quay 869", to: "Antwerp" });
    });

    it("uses the canonical terminal at the start", () => {
      expect(
        toTripRoute({
          direction: TripDirection.DELIVERY,
          terminal: "Quay 869",
          destinationCity: "Lessines",
        }),
      ).toEqual({ from: "Quay 869", to: "Lessines" });
    });
  });

  /**
   * ── COLLECTION: THE LOADING SECTION ───────────────────────────────────────
   * The document calls it `LOADING n:`. The container is picked up at the
   * customer and taken to the quay, so the city is where the Trip STARTS.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a COLLECTION Trip", () => {
    it("runs from the city to the terminal", () => {
      expect(
        toTripRoute({
          direction: TripDirection.COLLECTION,
          terminal: "PSA Quay 869",
          destinationCity: "Antwerp",
        }),
      ).toEqual({ from: "Antwerp", to: "Quay 869" });
    });

    it("uses the canonical terminal at the end", () => {
      expect(
        toTripRoute({
          direction: TripDirection.COLLECTION,
          terminal: "PSA Quay 869",
          destinationCity: "Dourges",
        }),
      ).toEqual({ from: "Dourges", to: "Quay 869" });
    });
  });

  /**
   * The two directions between the same two places are DIFFERENT routes, and
   * must stay different. Collapsing them into one directionless pair is exactly
   * what future pricing cannot work with.
   */
  it("keeps the two directions apart between the same two places", () => {
    const delivery = toTripRoute({
      direction: TripDirection.DELIVERY,
      terminal: "PSA Quay 869",
      destinationCity: "Antwerp",
    });
    const collection = toTripRoute({
      direction: TripDirection.COLLECTION,
      terminal: "PSA Quay 869",
      destinationCity: "Antwerp",
    });

    expect(delivery).not.toEqual(collection);
    expect(delivery).toEqual({ from: "Quay 869", to: "Antwerp" });
    expect(collection).toEqual({ from: "Antwerp", to: "Quay 869" });
  });

  /**
   * ── A GENUINE COMBINATION ─────────────────────────────────────────────────
   * One document, two Trips, two routes. Each leg gets its OWN route, and the
   * two are mirror images rather than one shared string.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("gives each leg of a Combination its own route", () => {
    const deliveryLeg = toTripRoute({
      direction: TripDirection.DELIVERY,
      terminal: "Quay 869",
      destinationCity: "Kallo",
    });
    const collectionLeg = toTripRoute({
      direction: TripDirection.COLLECTION,
      terminal: "PSA Quay 869",
      destinationCity: "Melsele",
    });

    expect(deliveryLeg).toEqual({ from: "Quay 869", to: "Kallo" });
    expect(collectionLeg).toEqual({ from: "Melsele", to: "Quay 869" });
  });

  describe("a Trip missing an end", () => {
    it("reports the terminal it has", () => {
      expect(
        toTripRoute({
          direction: TripDirection.DELIVERY,
          terminal: "PSA Quay 869",
          destinationCity: null,
        }),
      ).toEqual({ from: "Quay 869", to: "" });
    });

    it("reports the city it has", () => {
      expect(
        toTripRoute({
          direction: TripDirection.COLLECTION,
          terminal: null,
          destinationCity: "Dourges",
        }),
      ).toEqual({ from: "Dourges", to: "" });
    });

    it("has no route at all when it has neither end", () => {
      expect(
        toTripRoute({
          direction: TripDirection.DELIVERY,
          terminal: null,
          destinationCity: null,
        }),
      ).toBeNull();
    });
  });

  /**
   * A Trip created by hand has no document that could have stated a direction.
   * It keeps the terminal-first reading it has always been shown with — a
   * fallback, not a claim that it is a delivery.
   */
  it("keeps the terminal-first reading when no direction was stated", () => {
    expect(
      toTripRoute({
        direction: null,
        terminal: "PSA Quay 869",
        destinationCity: "Antwerp",
      }),
    ).toEqual({ from: "Quay 869", to: "Antwerp" });
  });

  it("tidies the spacing of a city without renaming it", () => {
    expect(
      toTripRoute({
        direction: TripDirection.COLLECTION,
        terminal: "PSA Quay 869",
        destinationCity: "  Saint-Martin-Au-Laert  ",
      }),
    ).toEqual({ from: "Saint-Martin-Au-Laert", to: "Quay 869" });
  });
});
