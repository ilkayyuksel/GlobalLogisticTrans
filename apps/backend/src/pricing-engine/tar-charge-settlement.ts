import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { toUtcDate } from "../common/dates";
import { TripReadService } from "../trips/trip-read.service";
import { meaningfulTarNummer } from "../trips/tar-nummer";
import { surplusTarHolders } from "./tar-charge-holders";
import { TarChargeReadRepository, type TarDay } from "./tar-charge-read.repository";

/**
 * After Trips were priced and stored: which Trips must be priced again so a
 * TAR-nummer's automatic charge for the day sits on exactly ONE Trip that owes
 * it (`tar-charge-holders.ts`).
 *
 * ── WHY AFTER EVERY STORE ───────────────────────────────────────────────────
 * Every pricing trigger — closing, every repricing edit, regrouping, a status
 * change, a Custom Value, an explicit reprocess — stores through
 * `PairedPricingService`. So one check there reaches them all:
 *
 *   it GAVE UP the charge   a stored Trip held the automatic TAR before and
 *                           holds none now — it became a Combination's
 *                           COLLECTION leg, or anything else that withdrew
 *                           it. The other CLOSED Trips stating the number that
 *                           day were priced without it and are priced again;
 *                           the first of them takes it.
 *   it took it TWICE        two Trips priced at the same moment each found the
 *                           number free. All but the first priced give it up.
 *
 * Changes that leave a Trip unpriced — a cancellation, or a new number or day
 * on the Trip itself — are reached from the Trip side
 * (`trips/tar-charge-release.ts`).
 *
 * It decides WHICH Trips; it prices nothing itself.
 */
@Injectable()
export class TarChargeSettlement {
  constructor(
    private readonly tarCharges: TarChargeReadRepository,
    private readonly trips: TripReadService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TarChargeSettlement.name);
  }

  /** Which of these Trips hold an automatic TAR now — read BEFORE they are stored. */
  holdingBefore(tripIds: readonly string[]): Promise<Set<string>> {
    return this.tarCharges.findTripsHoldingAutomaticTar(tripIds);
  }

  /**
   * The Trips to price again after `storedTripIds` were stored; empty in the
   * ordinary case. `heldBefore` is `holdingBefore` of the same Trips.
   */
  async tripsToReprice(
    storedTripIds: readonly string[],
    heldBefore: ReadonlySet<string>,
  ): Promise<string[]> {
    const reprice = new Set<string>();

    for (const tripId of storedTripIds) {
      const day = await this.tarDayOf(tripId);

      if (day === null) {
        continue;
      }

      const holders = await this.tarCharges.findHolders(day);

      for (const surplus of surplusTarHolders(holders)) {
        reprice.add(surplus);
      }

      if (heldBefore.has(tripId) && !holders.some((holder) => holder.tripId === tripId)) {
        for (const sharing of await this.tarCharges.findClosedTripsStating(day, tripId)) {
          reprice.add(sharing);
        }
      }
    }

    if (reprice.size > 0) {
      // The number itself is business data and is never logged.
      this.logger.log("A TAR charge moved: Trips sharing its number that day are priced again", {
        storedTripIds,
        repricedTripIds: [...reprice],
      });
    }

    return [...reprice];
  }

  private async tarDayOf(tripId: string): Promise<TarDay | null> {
    const trip = await this.trips.findById(tripId);
    const tarNummer = meaningfulTarNummer(trip?.tarNummer);

    return trip && tarNummer !== null && trip.planningDate !== null
      ? { tarNummer, planningDate: toUtcDate(trip.planningDate) }
      : null;
  }
}
