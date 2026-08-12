import { ExtractionError } from "../errors";
import { ExtractedDocument } from "../text/extract";
import { LayoutType } from "../types";

/**
 * Which of the three known layouts this document is.
 *
 * Detection happens before any field is read, as `parserLayouts.md` requires,
 * and it uses only markers the fixtures actually print:
 *
 *   `** COMBINATION **`  in the page header of BOTH pages of a combination,
 *                        so page 1 alone decides it
 *   `Page 1 of 1`        single collection, one page
 *   `Page 1 of 2`        single collection, two pages, page 2 depot only
 *
 * Anything else is refused outright. `parserLayouts.md`: "If no supported
 * layout is detected, return Unsupported Layout. Do not attempt best-effort
 * parsing." A best-effort guess would create a wrong Trip, which is worse than
 * creating none.
 */

export const COMBINATION_MARKER = "** COMBINATION **";

export function detectLayout(document: ExtractedDocument): LayoutType {
  const isCombination = document.fragments.some(
    (fragment) => fragment.text === COMBINATION_MARKER,
  );

  if (isCombination) {
    if (document.pageCount !== 2) {
      throw new ExtractionError(
        "UNSUPPORTED_COMBINATION",
        `A combination order must have exactly 2 pages; this one has ${document.pageCount}.`,
      );
    }

    return "COMBINATION_TWO_PAGE";
  }

  if (document.pageCount === 1) {
    return "SINGLE_ONE_PAGE";
  }

  if (document.pageCount === 2) {
    return "SINGLE_TWO_PAGE";
  }

  throw new ExtractionError(
    "UNSUPPORTED_LAYOUT",
    `No supported layout matches a ${document.pageCount}-page document without a combination marker.`,
  );
}
