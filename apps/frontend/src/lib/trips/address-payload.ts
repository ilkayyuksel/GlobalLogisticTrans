import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";

/** The address as the edit form holds it: three strings. */
export interface AddressFormValues {
  readonly terminal: string;
  readonly destinationCity: string;
  readonly destinationCountry: string;
}

export function toAddressFormValues(trip: Trip): AddressFormValues {
  return {
    terminal: trip.terminal ?? "",
    destinationCity: trip.destinationCity ?? "",
    destinationCountry: trip.destinationCountry ?? "",
  };
}

/**
 * Only the address fields the operator actually CHANGED.
 *
 * ── WHY NOT SEND ALL THREE ──────────────────────────────────────────────────
 * The terminal and the destination city are pricing inputs: SENDING one makes
 * the backend reprice the Trip. A form saved for a new note must not reprice a
 * CLOSED Trip because its unchanged address happened to travel along — so an
 * untouched field is left out, which the backend reads as "leave it alone".
 *
 * Blank means "clear it" (null), matching the backend, which stores a
 * whitespace-only value as null anyway.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function toChangedAddressPayload(
  values: AddressFormValues,
  trip: Trip,
): Pick<UpdateTripPayload, "terminal" | "destinationCity" | "destinationCountry"> {
  const payload: Pick<
    UpdateTripPayload,
    "terminal" | "destinationCity" | "destinationCountry"
  > = {};

  for (const field of ["terminal", "destinationCity", "destinationCountry"] as const) {
    const entered = values[field].trim() === "" ? null : values[field].trim();

    if (entered !== trip[field]) {
      payload[field] = entered;
    }
  }

  return payload;
}
