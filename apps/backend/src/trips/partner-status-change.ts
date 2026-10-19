import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { isPricingPartnerStatus } from "../pricing-engine/combination-leg";
import {
  PricingRecalculationOutcome,
  PricingRecalculationService,
} from "../pricing-engine/pricing-recalculation.service";

/**
 * Reprices the CLOSED Trips whose pricing partner a status change moved.
 *
 * ── WHY A STATUS IS A PRICING INPUT OF ANOTHER TRIP ─────────────────────────
 * Only OPEN and CLOSED Trips are pricing partners (`isPricingPartnerStatus`).
 * A Trip that is cancelled or deleted leaves every pair it was in — its
 * CLOSED partner must lose the Combination price, its Over ST and the €70 — and
 * one that comes back (reopened from CANCELLED, restored from DELETED) may
 * form a pair again, or turn a group of two back into one of three.
 *
 * ── WHICH TRIPS ─────────────────────────────────────────────────────────────
 * The pricing domain's own answer, the same as for a regrouping: the group as
 * it was (this Trip at its old status) against the group as it is, through
 * `tripsAffectedByRegrouping` — every member whose pricing partner changed.
 * Only CLOSED ones are repriced; an OPEN Trip is priced when it closes. A
 * change that keeps the Trip on the same side (OPEN ↔ CLOSED, CANCELLED →
 * DELETED) moves no pair and reprices nothing here.
 *
 * After the status write has committed, so the Engine reads the new status.
 * Never throws: like every recalculation, a Trip that cannot be priced
 * answers with a reason code, and the status change stands.
 */
export async function repriceAfterPartnerStatusChange(
  changed: Pick<Trip, "id" | "tripGroupId" | "status">,
  previousStatus: TripStatus,
  recalculation: PricingRecalculationService,
  findGroupMembers: (tripGroupId: string) => Promise<Trip[]>,
  logger: AppLoggerService,
): Promise<Map<string, PricingRecalculationOutcome>> {
  if (
    changed.tripGroupId === null ||
    isPricingPartnerStatus(previousStatus) === isPricingPartnerStatus(changed.status)
  ) {
    return new Map<string, PricingRecalculationOutcome>();
  }

  const after = await findGroupMembers(changed.tripGroupId);
  const before = after.map((member) =>
    member.id === changed.id ? { ...member, status: previousStatus } : member,
  );
  const affected = new Set(recalculation.tripsAffectedByRegrouping(before, after));

  // Each with its partner leg, and a pair named twice priced once.
  const outcomes = await recalculation.recalculateAll(
    after
      .filter((member) => affected.has(member.id) && member.status === TripStatus.CLOSED)
      .map((member) => member.id),
  );

  logger.log("Status change moved a pricing pair", {
    tripId: changed.id,
    fromStatus: previousStatus,
    toStatus: changed.status,
    affectedTripIds: [...affected],
    repricedTripIds: [...outcomes.keys()],
  });

  return outcomes;
}
