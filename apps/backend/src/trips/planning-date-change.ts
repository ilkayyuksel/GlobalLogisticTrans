import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingRecalculationOutcome,
  PricingRecalculationService,
} from "../pricing-engine/pricing-recalculation.service";

/**
 * Whether a write moved a Trip to another day.
 *
 * Compared as stored values, not as "sent": re-saving a form with the same
 * Datum moves nothing, and repricing a Combination for it would be noise.
 */
export function movesPlanningDate(
  before: Pick<Trip, "planningDate">,
  after: Pick<Trip, "planningDate">,
): boolean {
  return before.planningDate?.getTime() !== after.planningDate?.getTime();
}

/**
 * Whether a write changed the road a Trip is priced on: its terminal, its
 * destination city or its direction — the three facts `toTripRoute` reads.
 */
export function movesRoad(
  before: Pick<Trip, "terminal" | "destinationCity" | "direction">,
  after: Pick<Trip, "terminal" | "destinationCity" | "direction">,
): boolean {
  return (
    before.terminal !== after.terminal ||
    before.destinationCity !== after.destinationCity ||
    before.direction !== after.direction
  );
}

/** Which of a Combination's pricing inputs a write changed. */
export interface CombinationInputChange {
  readonly planningDate: boolean;
  readonly road: boolean;
}

/**
 * Reprices the CLOSED Trips whose price a planningDate change moved.
 *
 * ── WHY A DATE IS A PRICING INPUT AT ALL ────────────────────────────────────
 * For one Trip only: Leg 2 of a genuine Combination owes Over ST exactly when
 * its planningDate differs from Leg 1's. Changing EITHER date can switch that
 * on or off, and it is always Leg 2's price that moves — possibly a Trip other
 * than the one edited. Which Trips those are is the pricing domain's answer
 * (`tripsAffectedByPlanningDate`), never decided here; for an ordinary Trip it
 * is none, so its behaviour is unchanged.
 *
 * ── WHEN AND WHICH ──────────────────────────────────────────────────────────
 * After the write has committed, so the Engine reads the new date. Only CLOSED
 * Trips — an OPEN Trip has no snapshot and is priced when it closes. Through
 * the same `recalculate` every other repricing uses, so the failure contract
 * holds: it never throws, and a Trip that cannot be priced answers with a
 * reason code.
 *
 * `findTrip` reads the CURRENT status, because the affected Trip is often the
 * partner leg, which the caller never loaded.
 */
export function repriceAfterPlanningDateChange(
  tripId: string,
  recalculation: PricingRecalculationService,
  findTrip: (id: string) => Promise<Pick<Trip, "status"> | null>,
  logger: AppLoggerService,
): Promise<Map<string, PricingRecalculationOutcome>> {
  return repriceAfterCombinationInputChange(
    tripId,
    { planningDate: true, road: false },
    recalculation,
    findTrip,
    logger,
  );
}

/**
 * Reprices the CLOSED Trips whose price a change of date OR road moved.
 *
 * ── AND THE ROAD ────────────────────────────────────────────────────────────
 * A Trip's road decides its route, and for a leg of a Combination it decides
 * which configured PAIR both legs are priced on: changing one leg's terminal,
 * destination or direction can move its partner's Tarief, Toll, Tunnel and
 * Over ST. So a road change reprices the Trip and its same-document group
 * members (`tripsAffectedByRoadChange`). A Trip named by both questions is
 * repriced once.
 */
export async function repriceAfterCombinationInputChange(
  tripId: string,
  changed: CombinationInputChange,
  recalculation: PricingRecalculationService,
  findTrip: (id: string) => Promise<Pick<Trip, "status"> | null>,
  logger: AppLoggerService,
): Promise<Map<string, PricingRecalculationOutcome>> {
  const affected = [
    ...new Set([
      ...(changed.planningDate
        ? await recalculation.tripsAffectedByPlanningDate(tripId)
        : []),
      ...(changed.road ? await recalculation.tripsAffectedByRoadChange(tripId) : []),
    ]),
  ];
  const outcomes = new Map<string, PricingRecalculationOutcome>();

  for (const affectedId of affected) {
    const trip = await findTrip(affectedId);

    if (trip?.status === TripStatus.CLOSED) {
      outcomes.set(affectedId, await recalculation.recalculate(affectedId));
    }
  }

  if (affected.length > 0) {
    logger.log("planningDate or road change moved the pricing of Trips", {
      tripId,
      changed,
      affectedTripIds: affected,
      repricedTripIds: [...outcomes.keys()],
    });
  }

  return outcomes;
}
