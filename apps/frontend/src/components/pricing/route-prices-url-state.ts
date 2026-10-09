import { REVIEW_FILTERS, type ReviewFilter } from "@/components/pricing/route-review-progress";
import { choiceParam, flagParam, textParam } from "@/lib/navigation/url-state-codecs";

/**
 * Routeprijzen's view state, as it appears in the address: the search, the
 * review filter and which of the two sections is folded away. Kept there so
 * leaving the page and coming Back finds the same rows, open the same way, at
 * the same scroll position.
 */
export const ROUTE_SEARCH_PARAM = textParam("search");

export const ROUTE_REVIEW_FILTER_PARAM = choiceParam<ReviewFilter>(
  "review",
  REVIEW_FILTERS,
  "ALL",
);

/** Both sections start open, as before; only a folded one is written. */
export const NORMAL_ROUTES_OPEN_PARAM = flagParam("routes", true);

export const COMBINATIONS_OPEN_PARAM = flagParam("combinations", true);
