import { UpdateTripDto } from "./dto/update-trip.dto";
import { changesWaitingTimeWindow } from "./waiting-window";

/**
 * Whether a Trip update touches something the Pricing Engine bills from.
 *
 * ── THE FIELDS, NAMED ONCE ──────────────────────────────────────────────────
 * Only the inputs on the update endpoint that an operator edits AFTER the work
 * is finished and that change what the Trip owes:
 *
 *   the waiting-time window  — billed by the Waiting Time calculator;
 *   the TAR-nummer           — the automatic TAR follows from a stated number,
 *                              subject to the Combination allocation and the
 *                              same-day rule.
 *
 * The TAR-nummer was missing from this list, and that was a real bug. Adding a
 * number to a CLOSED Trip changed what it owed, but nothing repriced it: only a
 * reopen and a second close did, because closing is the other path that prices
 * a Trip. Until then the stored Others and Totaal described the Trip as it was
 * before the edit.
 *
 * ── "SENT", NOT "DIFFERENT" ─────────────────────────────────────────────────
 * A field counts as changed when it was SENT — the same test the window has
 * always used, and the same one the write itself applies. Re-sending an
 * unchanged value costs one calculation and stores the same snapshot; treating
 * a real change as a repeat would leave the money describing the old value.
 * An explicit null is a change like any other: it is how a number is removed.
 *
 * Named for the FIELDS rather than for pricing: this is a Trip-domain question,
 * and the Trip module's only dependency on the pricing domain is the
 * recalculation entry point — `trip-closed-event.spec.ts` holds it to that.
 */
export function changesPricingInput(
  update: Pick<
    UpdateTripDto,
    "waitingTimeStart" | "waitingTimeEnd" | "tarNummer"
  >,
): boolean {
  return changesWaitingTimeWindow(update) || update.tarNummer !== undefined;
}
