import { ExtractionError } from "../errors";
import { extractTripFromPage } from "./page-trip";
import { Fragment } from "../text/extract";
import { ParsedTrip } from "../types";

/**
 * Layout 3 — a combination, two pages, one trip each.
 *
 * Page 1 is the DELIVERY, page 2 the COLLECTION. Both trips are read exactly
 * like any other page, then tied together by a shared group key.
 *
 * THE TWO TRIPS DO NOT SHARE A BOOKING NUMBER. `pdfParserRules.md` and
 * `parserLayouts.md` both say they do; the real document proves otherwise —
 * `DUBANR2598395` on the delivery and `ANRBEL2603249` on the collection, an
 * inbound and an outbound booking. Nothing here compares the two, and the group
 * key is what relates them.
 *
 * That reading is also the only one the Backend accepts: it refuses a second
 * Trip carrying a booking number that an active Trip already holds, so trips
 * sharing a booking number could never both be imported.
 */
export function parseCombination(
  fragments: readonly Fragment[],
  groupKey: string,
): ParsedTrip[] {
  const trips = [
    extractTripFromPage(fragments, 1, groupKey),
    extractTripFromPage(fragments, 2, groupKey),
  ];

  assertExpectedDirections(trips);

  return trips;
}

/**
 * A combination is a delivery followed by a collection.
 *
 * Checked rather than assumed: a document whose pages carry any other pairing
 * is a structure we have never seen, and guessing at it would produce two trips
 * that misrepresent the order. Refusing names exactly what was found.
 */
function assertExpectedDirections(trips: readonly ParsedTrip[]): void {
  const actual = trips.map((trip) => trip.direction).join(" then ");

  if (actual !== "DELIVERY then COLLECTION") {
    throw new ExtractionError(
      "UNSUPPORTED_COMBINATION",
      `A combination order should be a DELIVERY on page 1 then a COLLECTION on page 2; this one is ${actual}.`,
    );
  }
}
