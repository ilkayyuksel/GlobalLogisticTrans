import { extractTripFromPage } from "./page-trip";
import { Fragment } from "../text/extract";
import { ParsedTrip } from "../types";

/**
 * Layouts 1 and 2 — a single collection, on one or two pages.
 *
 * Both produce exactly one trip, read from page 1. On the two-page form, page 2
 * carries only the Redelivery Depot; `parserLayouts.md` states that page 1
 * always has priority, and in the fixture page 1 already names the terminal
 * through `Return to Terminal:`, so page 2 is not needed to build the trip.
 *
 * It is not read at all rather than merged speculatively: taking a depot from
 * page 2 when page 1 has already answered would risk overriding the correct
 * value with a different one.
 *
 * A single trip has no group, so `groupKey` is null.
 */
export function parseSingle(fragments: readonly Fragment[]): ParsedTrip[] {
  return [extractTripFromPage(fragments, 1, null)];
}
