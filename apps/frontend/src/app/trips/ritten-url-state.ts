import {
  PAYMENT_CHOICES,
  STATUS_CHOICES,
  type RittenFilterValues,
} from "@/components/ritten/ritten-filters";
import { DEFAULT_RITTEN_SORT, type RittenSort } from "@/components/ritten/ritten-sort";
import type { TripSortDirection, TripSortField } from "@/lib/api/trips";
import { RITTEN_VIEWS, type RittenView, todayAnchor } from "@/lib/ritten/period";
import {
  choiceParam,
  dateParam,
  flagParam,
  objectParams,
  pageParam,
  textParam,
} from "@/lib/navigation/url-state-codecs";

/**
 * The Ritten list's view state, as it appears in the address.
 *
 *   /trips?date=2026-10-04&view=week&status=OPEN&vehicle=…&sort=startTime&prices=1
 *
 * Everything a planner sets before opening a Trip, so Back returns to the same
 * list. Selection, open dialogs and feedback are not here: they are about the
 * moment, and a returning user expects none of them.
 */

const SORT_FIELDS: readonly TripSortField[] = ["licensePlate", "startTime", "endTime"];
const SORT_DIRECTIONS: readonly TripSortDirection[] = ["asc", "desc"];

export const RITTEN_VIEW_PARAM = choiceParam<RittenView>("view", RITTEN_VIEWS, "day");

export const RITTEN_DATE_PARAM = dateParam("date", todayAnchor);

export const RITTEN_FILTER_PARAMS = objectParams<RittenFilterValues>({
  search: textParam("search"),
  status: choiceParam("status", STATUS_CHOICES, ""),
  vehicleId: textParam("vehicle"),
  terminal: textParam("terminal"),
  customPropertyId: textParam("property"),
  isPaid: choiceParam("paid", PAYMENT_CHOICES, ""),
});

export const RITTEN_PAGE_PARAM = pageParam();

export const RITTEN_SORT_PARAMS = objectParams<RittenSort>({
  field: choiceParam("sort", SORT_FIELDS, DEFAULT_RITTEN_SORT.field),
  direction: choiceParam("direction", SORT_DIRECTIONS, DEFAULT_RITTEN_SORT.direction),
});

/** Whether the money columns are shown; off by default, as before. */
export const RITTEN_PRICES_PARAM = flagParam("prices", false);
