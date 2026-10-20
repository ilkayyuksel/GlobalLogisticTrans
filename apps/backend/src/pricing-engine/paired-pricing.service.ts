import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { hasCurrentPrice } from "../trip-pricing/current-pricing";
import { TripRouteSelectionRepository } from "../trip-route-selection/trip-route-selection.repository";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { pricingPartnerOf } from "./combination-leg";
import {
  PartnerLegNotPriceableException,
  PricingEngineErrorCode,
  PricingEngineException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingCalculationResult } from "./pricing-calculation-result";
import { PricingEngineService } from "./pricing-engine.service";
import { NO_ROUTE_CHOICES, type RouteChoices } from "./manual-route-selection";
import { AutomaticTarAlreadyChargedException } from "./tar-charge-guard";
import { TarChargeSettlement } from "./tar-charge-settlement";

/** How often a Trip is priced again after losing an automatic TAR to a concurrent write. */
const TAR_CLAIM_ATTEMPTS = 3;

/** How a pair is priced together, beyond the defaults. */
export interface PricingTogetherOptions {
  /** Route choices to price with before they are stored. */
  readonly choices?: RouteChoices;
  /**
   * Runs once every Trip is calculated and before any is stored; throwing
   * stores nothing. Where a route choice is checked and kept.
   */
  readonly beforeStore?: (results: readonly PricingCalculationResult[]) => Promise<void>;
}

/** One pricing trigger's reach: the Trip it was fired on, and its partner leg. */
export interface PricingPair {
  /** Null when the Trip does not exist; the Engine then refuses it as before. */
  readonly trip: TripReadView | null;
  /** The CLOSED pricing partner, or null when there is none to price. */
  readonly closedPartnerId: string | null;
}

/**
 * Every pricing trigger on one leg of a pair reaches the other leg too.
 *
 * ── WHY (OWNER, OCTOBER 2026) ───────────────────────────────────────────────
 * A leg's price is read from its PAIR — the configured Combination both roads
 * select, Over ST from both dates — so a trigger that priced one leg alone
 * could leave the other on an answer that no longer fits. Every trigger path
 * now goes through here: the close listener, the recalculation after an input
 * changed, the reprocess endpoint and the selection's reprocess. None of them
 * finds the partner or decides the scope on its own.
 *
 * ── WHICH PARTNER ───────────────────────────────────────────────────────────
 * `pricingPartnerOf`, the rule pricing itself uses: the other leg of the same
 * document, or the other member of a group of exactly two. Never a booking
 * number or a road. Only a CLOSED partner is priced — an OPEN Trip has no
 * price and is priced in full when it closes, as always.
 *
 * ONE level: the partner's partner is this Trip, so nothing here calls itself
 * and no trigger can bounce between the two legs.
 *
 * ── BOTH OR NEITHER ─────────────────────────────────────────────────────────
 * Every Trip is CALCULATED first, and only when all of them could be priced
 * are their snapshots stored. A configuration that cannot price one leg
 * therefore replaces neither, so the two never disagree about which
 * configuration they were priced against. Each snapshot is still written by
 * the Engine's own atomic, stale-guarded store; a write that fails for an
 * unexpected reason after the first leg was stored is logged as an error.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PairedPricingService {
  constructor(
    private readonly engine: PricingEngineService,
    private readonly trips: TripReadService,
    private readonly logger: AppLoggerService,
    private readonly routeChoices: TripRouteSelectionRepository,
    private readonly tarSettlement: TarChargeSettlement,
  ) {
    this.logger.setContext(PairedPricingService.name);
  }

  /** The Trip and the CLOSED partner a trigger on it also prices. */
  async pairOf(tripId: string): Promise<PricingPair> {
    const trip = await this.trips.findById(tripId);

    if (!trip?.tripGroupId) {
      return { trip, closedPartnerId: null };
    }

    const pairing = pricingPartnerOf(trip, await this.trips.findByGroupId(trip.tripGroupId));
    const closedPartnerId =
      pairing.kind === "PAIRED" && hasCurrentPrice(pairing.partner.status)
        ? pairing.partner.id
        : null;

    return { trip, closedPartnerId };
  }

  /**
   * The explicit reprocess of one Trip: itself and its CLOSED partner,
   * together. The Trip's own refusal — not CLOSED, unknown, unpriceable — is
   * thrown exactly as before.
   *
   * It hands the route back to the automatic matcher: the pair's route choice
   * is removed first, and stays removed whatever the matcher then finds
   * (owner, October 2026).
   */
  async reprocessWithPartner(
    tripId: string,
  ): Promise<{ readonly closedPartnerId: string | null; readonly results: PricingCalculationResult[] }> {
    const { closedPartnerId } = await this.pairOf(tripId);
    const removedChoices = await this.routeChoices.clearForTrips([tripId]);

    this.logger.log("Pricing reprocess requested", {
      tripId,
      partnerTripId: closedPartnerId,
      removedRouteChoices: removedChoices,
    });

    const results = await this.calculateAndStoreTogether(
      closedPartnerId ? [tripId, closedPartnerId] : [tripId],
    );

    return { closedPartnerId, results };
  }

  /**
   * Prices these Trips together: all calculated, then all stored — or, when
   * any one cannot be priced, none stored.
   *
   * The first Trip is the one the trigger was fired on. Its own failure is
   * thrown exactly as the Engine raised it, so every caller keeps the answer
   * it always gave. A partner's domain failure is raised as
   * `PartnerLegNotPriceableException`, naming that leg.
   */
  async calculateAndStoreTogether(
    tripIds: readonly string[],
    options: PricingTogetherOptions = {},
  ): Promise<PricingCalculationResult[]> {
    return this.priceTogether(tripIds, options, true);
  }

  /**
   * `settlesTar`: after storing, the Trips sharing a TAR-nummer whose charge
   * moved are priced too (`TarChargeSettlement`). Off for those Trips
   * themselves, so one settlement never sets off another.
   */
  private async priceTogether(
    tripIds: readonly string[],
    options: PricingTogetherOptions,
    settlesTar: boolean,
  ): Promise<PricingCalculationResult[]> {
    const [triggeredId] = tripIds;
    const results: PricingCalculationResult[] = [];
    const startedAt = new Date();

    try {
      for (const tripId of tripIds) {
        results.push(await this.calculate(tripId, triggeredId, options.choices ?? NO_ROUTE_CHOICES));
      }
    } catch (error: unknown) {
      await this.markNotCurrent(tripIds, startedAt, error, options);
      throw error;
    }

    await options.beforeStore?.(results);

    const heldTarBefore = settlesTar ? await this.tarSettlement.holdingBefore(tripIds) : null;

    try {
      for (const [index, result] of results.entries()) {
        results[index] = await this.storeClaimingTarOnce(result, options.choices ?? NO_ROUTE_CHOICES);
      }
    } catch (error: unknown) {
      // A leg already stored here was calculated after `startedAt` and keeps
      // its new snapshot; only older ones are marked.
      await this.markNotCurrent(tripIds, startedAt, error, options);
      throw error;
    }

    if (results.length > 1) {
      this.logger.log("Priced a pair of legs together", { tripIds });
    }

    if (heldTarBefore !== null) {
      await this.settleTarCharges(tripIds, heldTarBefore);
    }

    return results;
  }

  /**
   * Stores a result. When its automatic TAR was charged to another Trip after
   * this calculation found the number free — two sessions pricing at once —
   * the write is refused inside its transaction (`TarChargeGuard`), and the
   * Trip is calculated again from its current data, which now finds the
   * charge taken. Bounded: a Trip that keeps losing the race is reported.
   */
  private async storeClaimingTarOnce(
    result: PricingCalculationResult,
    choices: RouteChoices,
  ): Promise<PricingCalculationResult> {
    let current = result;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.engine.store(current);
      } catch (error: unknown) {
        if (!(error instanceof AutomaticTarAlreadyChargedException) || attempt >= TAR_CLAIM_ATTEMPTS) {
          throw error;
        }

        this.logger.log("The automatic TAR was charged to another Trip meanwhile; pricing again", {
          tripId: current.tripId,
          attempt,
        });
        current = await this.engine.calculate(current.tripId, choices);
      }
    }
  }

  /**
   * Prices again, each with its partner leg, the Trips a moved TAR charge now
   * belongs to — or no longer belongs to — see `TarChargeSettlement`.
   *
   * Never throws: the Trips priced above are stored and stand. A Trip that
   * cannot be priced here has its old snapshot marked as not current, like any
   * failed calculation, and is logged.
   */
  private async settleTarCharges(
    tripIds: readonly string[],
    heldBefore: ReadonlySet<string>,
  ): Promise<void> {
    let reprice: string[];

    try {
      reprice = await this.tarSettlement.tripsToReprice(tripIds, heldBefore);
    } catch (error: unknown) {
      this.logger.error("Could not settle the TAR charges of a pricing", {
        tripIds,
        reason: error instanceof Error ? error.message : String(error),
      });

      return;
    }

    for (const tripId of reprice) {
      try {
        const { closedPartnerId } = await this.pairOf(tripId);

        await this.priceTogether(closedPartnerId ? [tripId, closedPartnerId] : [tripId], {}, false);
      } catch (error: unknown) {
        this.logger.warn("A Trip whose TAR charge moved could not be priced again", {
          tripId,
          pricingErrorCode: error instanceof PricingEngineException ? error.code : null,
        });
      }
    }
  }

  /**
   * ── A FAILED CALCULATION LEAVES NO OLD PRICE ON SCREEN ─────────────────────
   * Both legs were to be priced from their data as it is now, and neither
   * could be stored. Their old snapshots describe the Trips as they were, so
   * they are marked FAILED and no screen, export or invoice check shows them
   * as current (`current-pricing.ts`) — until a calculation succeeds.
   *
   * Two failures change nothing about a Trip and mark nothing: an operator's
   * route choice that cannot price the pair (its data is unchanged; the choice
   * is refused and the stored prices stand), and a Trip that is not CLOSED or
   * does not exist (there is no current price to withdraw).
   *
   * Never hides the original failure: a marking that fails is logged and the
   * caller still receives the calculation's own error.
   */
  private async markNotCurrent(
    tripIds: readonly string[],
    startedAt: Date,
    error: unknown,
    options: PricingTogetherOptions,
  ): Promise<void> {
    const isRouteChoice = (options.choices?.size ?? 0) > 0;
    const leavesPriceAlone =
      error instanceof PricingEngineException &&
      (error.code === PricingEngineErrorCode.TRIP_NOT_CLOSED ||
        error.code === PricingEngineErrorCode.TRIP_NOT_FOUND);

    if (isRouteChoice || leavesPriceAlone) {
      return;
    }

    try {
      await this.engine.markCalculationFailed(tripIds, startedAt);
    } catch (markingError: unknown) {
      this.logger.error("Could not mark the old pricing snapshots as not current", {
        tripIds,
        reason: markingError instanceof Error ? markingError.message : String(markingError),
      });
    }
  }

  private async calculate(
    tripId: string,
    triggeredId: string,
    choices: RouteChoices,
  ): Promise<PricingCalculationResult> {
    try {
      return await this.engine.calculate(tripId, choices);
    } catch (error: unknown) {
      if (tripId === triggeredId) {
        throw error;
      }

      this.logger.warn("The partner leg could not be priced; neither leg was stored", {
        tripId: triggeredId,
        partnerTripId: tripId,
        pricingErrorCode: error instanceof PricingEngineException ? error.code : null,
      });

      if (error instanceof PricingEngineException) {
        throw new PartnerLegNotPriceableException(triggeredId, tripId, error);
      }

      throw error;
    }
  }
}
