import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  EffectivePricingDto,
  toEffectivePricingDto,
} from "../trip-pricing/dto/effective-pricing.dto";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { CombinationMember, tripsWhoseLegChanged } from "./combination-leg";
import { PricingEngineException } from "./exceptions/pricing-engine.exceptions";
import { PricingEngineService } from "./pricing-engine.service";

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
    private readonly engine: PricingEngineService,
    private readonly effectivePricing: EffectivePricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingRecalculationService.name);
  }

  /**
   * Prices the Trip again and reports what it is now worth.
   *
   * ONE calculation per call, whatever changed and however many properties the
   * Trip carries: the Engine resolves every input of a Trip in a single
   * preparation, so a caller must never loop over components.
   *
   * `calculateAndStore` rather than `reprocess`: both replace the snapshot
   * atomically, and the first also covers the Trip that has never been priced.
   */
  async recalculate(tripId: string): Promise<PricingRecalculationOutcome> {
    this.logger.log("Recalculating a Trip after a pricing input changed", {
      tripId,
    });

    try {
      const result = await this.engine.calculateAndStore(tripId);

      this.logger.log("Recalculation stored a new snapshot", {
        tripId,
        isReprocess: result.isReprocess,
        lineCount: result.lines.length,
        calculationStatus: result.calculationStatus,
      });

      return { pricing: await this.readEffective(tripId), reasonCode: null };
    } catch (error: unknown) {
      return { pricing: null, reasonCode: this.reportFailure(tripId, error) };
    }
  }

  /**
   * Which Trips a change of group membership left priced on a stale leg.
   *
   * Grouping and ungrouping are the one pricing input a Trip does not carry in
   * its own row: its leg is decided by the OTHER members of its group. So the
   * caller cannot tell which Trips to recalculate from the Trip it changed, and
   * must not decide it with a Combination rule of its own. It hands over the
   * Trips of the affected groups as they were and as they are, and the pricing
   * domain answers from `combinationLegOf` — the rule the Engine prices with.
   *
   * It only answers. Recalculating stays one `recalculate` call per Trip, so
   * the failure contract above applies to every one of them unchanged.
   */
  tripsAffectedByRegrouping(
    before: readonly CombinationMember[],
    after: readonly CombinationMember[],
  ): string[] {
    return tripsWhoseLegChanged(before, after);
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
