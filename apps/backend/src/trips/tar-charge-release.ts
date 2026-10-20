import { Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingRecalculationOutcome,
  PricingRecalculationService,
} from "../pricing-engine/pricing-recalculation.service";
import { canHoldTarCharge, type TarDay } from "../pricing-engine/tar-charge-read.repository";
import { meaningfulTarNummer } from "./tar-nummer";

type TarFacts = Pick<Trip, "tarNummer" | "planningDate" | "status">;

/**
 * The day and number whose automatic TAR charge this change may have
 * released, or null when it released none.
 *
 * The charge of one TAR-nummer belongs, for one day, to the first Trip priced
 * with it (`TarChargeReadRepository`). A change lets it go when the Trip had a
 * number and a day it could hold a charge on, and afterwards states another
 * number, sits on another day, or is cancelled or deleted. A change that keeps
 * all three releases nothing — whether the Trip actually HELD the charge does
 * not matter here: repricing Trips that keep their answer stores the same
 * answer again.
 */
export function releasedTarDay(before: TarFacts, after: TarFacts): TarDay | null {
  const tarNummer = meaningfulTarNummer(before.tarNummer);

  if (tarNummer === null || before.planningDate === null || !canHoldTarCharge(before.status)) {
    return null;
  }

  const sameNumber =
    meaningfulTarNummer(after.tarNummer)?.toLowerCase() === tarNummer.toLowerCase();
  const sameDay = after.planningDate?.getTime() === before.planningDate.getTime();

  return sameNumber && sameDay && canHoldTarCharge(after.status)
    ? null
    : { tarNummer, planningDate: before.planningDate };
}

/**
 * Reprices the CLOSED Trips a released TAR charge now belongs to.
 *
 * ── WHY (owner, 20 October 2026) ────────────────────────────────────────────
 * The other Trips stating the number that day were priced WITHOUT the TAR,
 * because this Trip held it. When this Trip lets it go, nothing used to price
 * them again, and their TAR stayed missing until somebody reprocessed them by
 * hand. Now the first of them takes it, at once — through the same
 * `recalculateAll` every repricing uses, each with its partner leg.
 *
 * After the change has committed AND after this Trip itself was repriced, so
 * the Engine no longer finds this Trip's old charge. Never throws.
 */
export async function repriceAfterTarChargeReleased(
  tripId: string,
  before: TarFacts,
  after: TarFacts,
  recalculation: PricingRecalculationService,
  logger: AppLoggerService,
): Promise<Map<string, PricingRecalculationOutcome>> {
  const day = releasedTarDay(before, after);

  if (day === null) {
    return new Map<string, PricingRecalculationOutcome>();
  }

  const sharing = await recalculation.tripsSharingTarDay(day, tripId);
  const outcomes = await recalculation.recalculateAll(sharing);

  if (sharing.length > 0) {
    // The number itself is business data and is never logged.
    logger.log("A released TAR charge repriced the Trips sharing its number that day", {
      tripId,
      repricedTripIds: [...outcomes.keys()],
    });
  }

  return outcomes;
}
