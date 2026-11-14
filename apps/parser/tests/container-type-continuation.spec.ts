import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "../src/index";
import { ExtractionError } from "../src/errors";
import { extractContainerType } from "../src/fields/container";
import { extractTripFromPage } from "../src/layout/page-trip";
import { parseSingle } from "../src/layout/single";
import { Fragment } from "../src/text/extract";

/**
 * Transport order 1404135 was refused with "No 'Cntr type:' label was found."
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Extraction read both pages correctly. The single-collection layout read the
 * trip from page 1 only, and on this order four `BIxxxxx: n x 45PH` cargo
 * remarks fill page 1, so the CONTAINER/CARGO block's `Weight: … Cntr type:
 * 45PH` row is printed at the top of page 2. The label was simply never looked
 * at. Direct uploads and IMAP both go through the same `parse()`, so the
 * import route made no difference.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURE = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "06-pdf",
  "BUG-CNTR",
  "transportorder1404135.pdf",
);

function load(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

function fragment(page: number, x: number, y: number, text: string): Fragment {
  return { page, x, y, text };
}

/** A minimal single collection: booking, terminal and LOADING 1 on page 1. */
function pageOneWithoutCargoRow(): Fragment[] {
  return [
    fragment(1, 304, 587, "COLLECTION Bookings nr/Trip nr: ANRDUB2831071 /77285760"),
    fragment(1, 331, 566, "Return to Terminal:"),
    fragment(1, 331, 551, "PSA Quay 869"),
    fragment(1, 331, 539, "Europaterminal"),
    fragment(1, 331, 527, "Scheldelaan 495"),
    fragment(1, 331, 515, "BE-2040 Antwerp"),
    fragment(1, 31, 310, "BI42515:"),
    fragment(1, 94, 310, "4 x 45PH"),
    fragment(1, 31, 262, "BI42517:"),
    fragment(1, 96, 262, "10 x 45PH"),
    fragment(1, 26, 200, "LOADING 1:"),
    fragment(1, 30, 180, "Address:"),
    fragment(1, 98, 180, "Venecolaan 17"),
    fragment(1, 98, 168, "9880 Aalter"),
    fragment(1, 31, 156, "Date/time:"),
    fragment(1, 98, 156, "13/11/2026 09:00 till 09:00"),
    fragment(1, 24, 74, "CONTAINER/CARGO:"),
  ];
}

function cargoRow(page: number, ...parts: [number, string][]): Fragment[] {
  return [
    fragment(page, 31, 593, "Weight:"),
    fragment(page, 85, 593, "22,000"),
    ...parts.map(([x, text]) => fragment(page, x, 593, text)),
  ];
}

describe("transport order 1404135 (Cntr type on page 2)", () => {
  it("parses into exactly one collection with container type 45PH", async () => {
    const result = await parse(load());

    if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
    expect(result.layout).toBe("SINGLE_TWO_PAGE");
    // Four BI cargo lines are remarks, never separate trips.
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0]).toMatchObject({
      bookingNumber: "ANRDUB2831071",
      direction: "COLLECTION",
      containerType: "45PH",
      containerNumber: null,
      terminal: "PSA Quay 869",
      destinationCity: "Aalter",
      date: "2026-11-13",
    });
  });
});

describe("where the CONTAINER/CARGO block is read", () => {
  it("reads Cntr type from page 1 when page 1 prints it", () => {
    const fragments = [
      ...pageOneWithoutCargoRow(),
      ...cargoRow(1, [163, "Cntr type:"], [219, "45PH"]),
    ];

    expect(parseSingle(fragments)[0].containerType).toBe("45PH");
  });

  it("reads Cntr type from page 2 when the block flowed there", () => {
    const fragments = [
      ...pageOneWithoutCargoRow(),
      ...cargoRow(2, [163, "Cntr type:"], [219, "45PH"]),
    ];

    const [trip] = parseSingle(fragments);

    expect(trip.containerType).toBe("45PH");
    expect(trip.destinationCity).toBe("Aalter");
  });

  it("never lets page 2 override a type page 1 states", () => {
    const fragments = [
      ...pageOneWithoutCargoRow(),
      ...cargoRow(1, [163, "Cntr type:"], [219, "45RH"]),
      ...cargoRow(2, [163, "Cntr type:"], [219, "45PH"]),
    ];

    expect(parseSingle(fragments)[0].containerType).toBe("45RH");
  });

  it("reads a container number from the same page as the type", () => {
    const fragments = [
      ...pageOneWithoutCargoRow(),
      ...cargoRow(2, [163, "Cntr type:"], [219, "45PH"]),
      fragment(2, 31, 570, "Container:"),
      fragment(2, 134, 570, "EUCU 145129/5"),
    ];

    expect(parseSingle(fragments)[0].containerNumber).toBe("EUCU1451295");
  });

  /** A combination's other page is a different trip; its container is not ours. */
  it("does not borrow a type from another trip's page", () => {
    const fragments = [
      ...pageOneWithoutCargoRow(),
      ...cargoRow(2, [163, "Cntr type:"], [219, "45PH"]),
    ];

    expect(() => extractTripFromPage(fragments, 1, "combination:x")).toThrow(
      /No 'Cntr type:' label was found/,
    );
  });

  it("keeps the existing refusal when no page prints Cntr type", () => {
    const fragments = [...pageOneWithoutCargoRow(), ...cargoRow(2)];

    expect(() => parseSingle(fragments)).toThrow(ExtractionError);
    expect(() => parseSingle(fragments)).toThrow(
      "No 'Cntr type:' label was found.",
    );
  });

  /** `1 x 45PH food` is a cargo remark, not the field, and is never promoted to one. */
  it("never derives the type from BI cargo remarks alone", () => {
    expect(() => parseSingle(pageOneWithoutCargoRow())).toThrow(
      /containerType|Cntr type/,
    );
  });
});

describe("Cntr type label variations", () => {
  it.each([
    ["Cntr type:"],
    ["Cntr  type:"],
    ["Cntr type :"],
    ["Cntrtype:"],
  ])("reads the value beside %j", (label) => {
    const fragments = [
      fragment(1, 163, 500, label),
      fragment(1, 219, 500.4, "45PH"),
    ];

    expect(extractContainerType(fragments)).toBe("45PH");
  });

  it("reads a value glued onto the label in one text run", () => {
    expect(extractContainerType([fragment(1, 163, 500, "Cntr type: 45PH")])).toBe(
      "45PH",
    );
  });

  it("still refuses a glued value that is not shaped like a type", () => {
    expect(() =>
      extractContainerType([fragment(1, 163, 500, "Cntr type: food")]),
    ).toThrow(/carried no value shaped like a container type/);
  });

  it("does not mistake the CNTR NR invoice notice for the label", () => {
    expect(() =>
      extractContainerType([
        fragment(1, 71, 675, "PLS ADV EUCON BOOKINGS REF/TRIP NR & CNTR NR ON INVOICE"),
      ]),
    ).toThrow(/No 'Cntr type:' label was found/);
  });
});
