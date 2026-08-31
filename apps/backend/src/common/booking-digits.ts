/**
 * The digits of a booking number, for Cost Confirmation matching only.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A transport order prints its booking number in full — `ANRDUB2793554`. A Cost
 * Confirmation does not always: the same booking can arrive as `DUB2793554` or
 * as `2793554`, because the confirmation is produced by a different system that
 * prints its own reference. Matched as strings, those name no Trip at all and
 * real money goes unrecorded.
 *
 * The digits are the part both systems agree on, so they are what the fallback
 * compares.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * It is not fuzzy matching, and the comparison it feeds is exact equality of
 * the returned strings. `2793554` and `2793555` are different bookings and stay
 * different; `12793554` is a different booking too, and no `includes`,
 * `startsWith` or `endsWith` is used anywhere near it.
 *
 * It is also not a general booking-number normalisation. Booking numbers are
 * stored and compared EXACTLY everywhere else in the system — `ANRDUB2794719
 * /67036944` keeps its slash, because that separates the booking from the trip
 * number and fusing them would create a different identifier. This function is
 * the Cost Confirmation fallback's own rule and has no other caller.
 *
 * Null when the value holds no digits at all: a reference with nothing numeric
 * in it identifies nothing, and comparing empty strings would make every such
 * confirmation match every such Trip.
 */
export function bookingNumberDigits(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // Whitespace and punctuation disappear with everything else that is not a
  // digit, so spacing and separators cannot change the answer.
  const digits = value.replace(/\D/g, "");

  return digits.length === 0 ? null : digits;
}
