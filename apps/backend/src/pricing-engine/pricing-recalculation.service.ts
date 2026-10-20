import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  EffectivePricingDto,
  toEffectivePricingDto,
} from "../trip-pricing/dto/effective-pricing.dto";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripReadService } from "../trips/trip-read.service";
import { CombinationMember, tripsRepricedByRegrouping } from "./combination-leg";
import { hasCurrentPrice } from "../trip-pricing/current-pricing";
import {
  PartnerLegNotPriceableException,
  PricingEngineErrorCode,
  PricingEngineException,
} from "./exceptions/pricing-engine.exceptions";
import { PairedPricingService } from "./paired-pricing.service";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { TarChargeReadRepository, type TarDay } from "./tar-charge-read.repository";

/**
 * What a recalculation reports when it could not produce a price for a reason
 * the pricing domain does not name.
 *
 * Every expected failure already carries a stable `PricingEngineErrorCode` —
 * PRICING_MISSING_ROUTE_PRICING, PRICING_TRIP_NOT_CLOSED and the rest — and
 * those codes are passed through unchanged rather than re-encoded, so the
 * system has ONE vocabulary for "why is there no price". This constant covers
 * only the unexpected: a database that was unreachable, a bug. It is
 * deliberately distinguishable, because the two need different responses — one
 * is configuration to fix, the other is an incident.
 */
export const UNEXPECTED_RECALCULATION_FAILURE = "PRICING_RECALCULATION_FAILED";

/**
 * The answer a mutation gives about money after changing one of a Trip's
 * pricing inputs.
 *
 * Exactly one of the two is set. There is no third state and no "unchanged":
 * a caller either receives the current figures or the reason there are none.
 */
export interface PricingRecalculationOutcome {
  /** The complete effective breakdown, or null when there is none to give. */
  readonly pricing: EffectivePricingDto | null;
  /** A stable machine-readable reason, or null when pricing is present. */
  readonly reasonCode: string | null;
}

/**
 * Recalculating a Trip after one of its own pricing inputs changed.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * Three writes change what a Trip is worth without touching its status: a
 * Custom Property is assigned or removed, a waiting-time window is entered or
 * cleared, and a Cost Confirmation is recorded. Each lives in a different
 * module, and each must leave the Trip's stored pricing current and answer with
 * it. Doing that in three places would be three chances to disagree about the
 * failure contract, so it is done here, once, and the three call it.
 *
 * ── THE FAILURE CONTRACT, WHICH IS THE POINT ───────────────────────────────
 * This method NEVER throws. The write it follows has already committed, and a
 * pricing problem cannot undo it:
 *
 *   the write is kept              — it succeeded, and it is a fact
 *   the endpoint answers 2xx       — the operator's change did happen
 *   pricing is null on failure     — never the previous figures, which would
 *                                    present a stale amount as current
 *   a reason code says why         — never a silent absence
 *   the Trip's status is untouched — CLOSED is terminal, here as everywhere
 *
 * Recalculation failing is ordinary rather than exceptional on this data: a
 * route with no RoutePricing row is a configuration gap an administrator fills
 * later, and refusing the operator's edit until then would block the work
 * instead of the price. That is the same reasoning
 * `trip-closed-pricing.listener.ts` already applies to closing a Trip.
 *
 * Nothing is swallowed quietly. A pricing-domain failure is logged as a warning
 * because the configuration is incomplete; anything else is logged as an error
 * because it is unexpected.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It calculates nothing itself and knows no formula. It asks the Engine to
 * price and store, then reads back the EFFECTIVE breakdown — which is what
 * makes an operator's Tarief, Toll or Tunnel override survive: overrides live
 * in their own table and are applied on top at read time, so replacing the
 * snapshot never touches them.
 * ───────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PricingRecalculationService {
  constructor(
    private readonly pairs: PairedPricingService,
    private readonly effectivePricing: EffectivePricingService,
    private readonly trips: TripReadService,
    private readonly components: PricingComponentResolver,
    private readonly tarCharges: TarChargeReadRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingRecalculationService.name);
  }

  /**
   * Prices the Trip again — together with its partner leg — and reports what
   * it is now worth.
   *
   * ONE calculation per Trip, whatever changed and however many properties
   * the Trip carries: the Engine resolves every input of a Trip in a single
   * preparation, so a caller must never loop over components.
   */
  async recalculate(tripId: string): Promise<PricingRecalculationOutcome> {
    return (await this.recalculateAll([tripId])).get(tripId) as PricingRecalculationOutcome;
  }

  /**
   * Prices these Trips again, each together with its partner leg, and reports
   * every Trip that was priced — the partners included.
   *
   * A Trip already priced as the partner of an earlier one is not priced
   * twice: a trigger naming both legs prices the pair once.
   */
  async recalculateAll(
    tripIds: readonly string[],
  ): Promise<Map<string, PricingRecalculationOutcome>> {
    const outcomes = new Map<string, PricingRecalculationOutcome>();

    for (const tripId of tripIds) {
      if (outcomes.has(tripId)) {
        continue;
      }

      for (const [pricedId, outcome] of await this.recalculateWithPartner(tripId)) {
        outcomes.set(pricedId, outcome);
      }
    }

    return outcomes;
  }

  /**
   * This Trip and its CLOSED partner, priced together — see
   * `PairedPricingService`: both stored, or, when either cannot be priced,
   * neither, and both answer with a reason.
   */
  private async recalculateWithPartner(
    tripId: string,
  ): Promise<Map<string, PricingRecalculationOutcome>> {
    let partnerId: string | null = null;

    try {
      const pair = await this.pairs.pairOf(tripId);
      /*
       * ── ONLY A CLOSED TRIP IS PRICED ────────────────────────────────────────
       * An OPEN Trip whose waiting time, Custom Values, confirmations or group
       * change is not calculated at all: it has no current price, and it is
       * priced in full from whatever it holds when it closes. Checked here,
       * once, for every caller, so no edit path can price a Trip that is not
       * finished. Its CLOSED partner is still priced: the trigger reaches it.
       * A Trip that does not exist is handed to the Engine, which refuses it
       * with its own reason, as before.
       */
      const isOwnPriced = !pair.trip || hasCurrentPrice(pair.trip.status);
      const scope = [...(isOwnPriced ? [tripId] : []), ...(pair.closedPartnerId ? [pair.closedPartnerId] : [])];

      partnerId = pair.closedPartnerId;

      if (!isOwnPriced) {
        this.logger.log("Not recalculated: the Trip is not CLOSED", {
          tripId,
          tripStatus: pair.trip?.status,
        });
      }

      if (scope.length === 0) {
        return new Map([[tripId, this.notClosed()]]);
      }

      this.logger.log("Recalculating after a pricing input changed", { tripId, scope });

      await this.pairs.calculateAndStoreTogether(scope);

      const outcomes = new Map<string, PricingRecalculationOutcome>([
        [tripId, isOwnPriced ? await this.priced(tripId) : this.notClosed()],
      ]);

      if (partnerId) {
        outcomes.set(partnerId, await this.priced(partnerId));
      }

      return outcomes;
    } catch (error: unknown) {
      return this.failedPair(tripId, partnerId, error);
    }
  }

  private async priced(tripId: string): Promise<PricingRecalculationOutcome> {
    return { pricing: await this.readEffective(tripId), reasonCode: null };
  }

  private notClosed(): PricingRecalculationOutcome {
    return { pricing: null, reasonCode: PricingEngineErrorCode.TRIP_NOT_CLOSED };
  }

  /**
   * Neither leg was stored, so neither answers with figures: each gets the
   * reason of its own, and the leg that could have been priced is told its
   * partner was the obstacle.
   */
  private failedPair(
    tripId: string,
    partnerId: string | null,
    error: unknown,
  ): Map<string, PricingRecalculationOutcome> {
    const reasonCode = this.reportFailure(tripId, error);
    const outcomes = new Map([[tripId, { pricing: null, reasonCode }]]);

    if (partnerId) {
      outcomes.set(partnerId, {
        pricing: null,
        reasonCode:
          error instanceof PartnerLegNotPriceableException
            ? error.partnerFailure.code
            : PricingEngineErrorCode.PARTNER_LEG_NOT_PRICEABLE,
      });
    }

    return outcomes;
  }

  /**
   * Which Trips a change of group membership left priced on a stale answer.
   *
   * Group membership is a pricing input: it decides the Backload of every Trip
   * whose group changed, and — through the other members — which leg of a
   * genuine Combination owes TAR. The caller hands over the Trips of the
   * affected groups as they were and as they are, and the pricing domain
   * answers from its own rules (`tripsRepricedByRegrouping`), so no caller
   * decides with a Combination rule of its own.
   *
   * It only answers. Recalculating stays one `recalculate` call per Trip, so
   * the failure contract above applies to every one of them unchanged.
   */
  tripsAffectedByRegrouping(
    before: readonly CombinationMember[],
    after: readonly CombinationMember[],
  ): string[] {
    return tripsRepricedByRegrouping(before, after);
  }

  /**
   * The Trips whose price a change to this Trip's planningDate can move.
   *
   * Asked AFTER the new date is stored, so the answer reads the dates pricing
   * will read. For a Combination that is both its legs, whichever leg's date
   * changed — Over ST is owed by the leg on the later day, and can move.
   * For every other Trip it is nothing: planningDate is not one of its pricing
   * inputs, and an ordinary Trip keeps the repricing it always had.
   *
   * Like `recalculate`, it never throws: the date change has committed, and a
   * failure to answer is logged as an error rather than undoing it.
   */
  async tripsAffectedByPlanningDate(tripId: string): Promise<string[]> {
    try {
      const trip = await this.trips.findById(tripId);

      return trip ? await this.components.legsPricedByPlanningDate(trip) : [];
    } catch (error) {
      this.logger.error(
        "Could not determine which Trips a planningDate change reprices",
        {
          tripId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );

      return [];
    }
  }

  /**
   * The Trips whose price a change to this Trip's ROAD can move — its
   * terminal, destination city or direction.
   *
   * The road decides the route this Trip is priced on, and — for a leg of a
   * Combination — which configured pair BOTH legs are priced on. So it is this
   * Trip and its same-document group members (`tripsPricedByRoadOf`). Asked
   * after the write; never throws, as `tripsAffectedByPlanningDate`.
   */
  async tripsAffectedByRoadChange(tripId: string): Promise<string[]> {
    try {
      const trip = await this.trips.findById(tripId);

      return trip ? await this.components.tripsPricedByRoadOf(trip) : [];
    } catch (error) {
      this.logger.error("Could not determine which Trips a road change reprices", {
        tripId,
        reason: error instanceof Error ? error.message : String(error),
      });

      return [];
    }
  }

  /**
   * The CLOSED Trips a TAR charge released on `day` may now belong to.
   *
   * The automatic TAR of one number is charged once a day, on the first Trip
   * priced with it (`TarChargeReadRepository`). When the Trip holding it lets
   * it go — its number or day changes, it is cancelled or deleted — the other
   * Trips stating that number that day were priced WITHOUT it and owe it now,
   * so they are named here to be priced again. Asked after the write; never
   * throws, as `tripsAffectedByPlanningDate`.
   */
  async tripsSharingTarDay(day: TarDay, excludeTripId: string): Promise<string[]> {
    try {
      return await this.tarCharges.findClosedTripsStating(day, excludeTripId);
    } catch (error) {
      this.logger.error("Could not determine which Trips a released TAR charge reprices", {
        tripId: excludeTripId,
        reason: error instanceof Error ? error.message : String(error),
      });

      return [];
    }
  }

  /**
   * The stored breakdown with the operator's corrections applied.
   *
   * Null would mean the Engine stored nothing, which cannot happen on the
   * success path — but the read is shared with every other pricing screen and
   * answers null for an unpriced Trip, so the type is honest about it.
   */
  private async readEffective(
    tripId: string,
  ): Promise<EffectivePricingDto | null> {
    const pricing = await this.effectivePricing.findForTrip(tripId);

    return pricing === null ? null : toEffectivePricingDto(pricing);
  }

  /** Logs the failure at the level it deserves and names it for the caller. */
  private reportFailure(tripId: string, error: unknown): string {
    if (error instanceof PricingEngineException) {
      // Expected: the Trip's own inputs changed, but the configuration cannot
      // price it. The code names what an administrator has to fix.
      this.logger.warn("Recalculation could not price the Trip", {
        tripId,
        pricingErrorCode: error.code,
      });

      return error.code;
    }

    this.logger.error("Recalculation failed unexpectedly", {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });

    return UNEXPECTED_RECALCULATION_FAILURE;
  }
}
