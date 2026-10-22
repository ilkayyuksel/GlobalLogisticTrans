import { TripStatus, type Trip } from "@prisma/client";

import { toIsoDate } from "../../common/dates";

/** A Trip's status in the words the Ritten screen uses. */
const STATUS_WORDS: Record<TripStatus, string> = {
  [TripStatus.OPEN]: "open",
  [TripStatus.CLOSED]: "afgewerkt",
  [TripStatus.CANCELLED]: "geannuleerd",
  [TripStatus.DELETED]: "verwijderd",
};

/** `ANRDUB2813025 · EUCU4590355 · 07/10/2026 · afgewerkt` — enough to find it in Ritten. */
export function describeTrip(trip: Trip): string {
  return [
    trip.bookingNumber ?? "(geen boekingsnummer)",
    trip.containerNumber ?? "(geen container)",
    trip.planningDate ? toDutchDate(toIsoDate(trip.planningDate)) : "(geen datum)",
    STATUS_WORDS[trip.status],
  ].join(" · ");
}

/** `2026-10-07` as a Dutch reader writes it: `07/10/2026`. */
export function toDutchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");

  return `${day}/${month}/${year}`;
}
