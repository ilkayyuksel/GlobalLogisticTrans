import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { hasCurrentPrice } from "../trip-pricing/current-pricing";
import { TripRouteSelectionRepository } from "../trip-route-selection/trip-route-selection.repository";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { pricingPartnerOf } from "./combination-leg";
import {
  PartnerLegNotPriceableException,
  PricingEngineException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingCalculationResult } from "./pricing-calculation-result";
import { PricingEngineService } from "./pricing-engine.service";
import { NO_ROUTE_CHOICES, type RouteChoices } from "./manual-route-selection";

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
    const [triggeredId] = tripIds;
    const results: PricingCalculationResult[] = [];

    for (const tripId of tripIds) {
      results.push(await this.calculate(tripId, triggeredId, options.choices ?? NO_ROUTE_CHOICES));
    }

    await options.beforeStore?.(results);

    for (const result of results) {
      await this.engine.store(result);
    }

    if (results.length > 1) {
      this.logger.log("Priced a pair of legs together", { tripIds });
    }

    return results;
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
