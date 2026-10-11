import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingEngineErrorCode,
  PricingEngineException,
} from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";
import { TripNotClosedException } from "../trip-pricing/exceptions/trip-pricing.exceptions";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { TripNotFoundException } from "../trips/exceptions/trip.exceptions";
import {
  BulkReprocessResultDto,
  TripReprocessOutcome,
  TripReprocessResultDto,
} from "./dto/reprocess-trips.dto";

/** Why a selected Trip was skipped. */
export const SkipReason = {
  NOT_CLOSED: "NOT_CLOSED",
  NOT_FOUND: "NOT_FOUND",
} as const;

/** An error with no domain meaning: logged in full, reported without detail. */
const UNEXPECTED_ERROR = "UNEXPECTED_ERROR";

/**
 * "Prijs herberekenen" for a selection of Trips.
 *
 * ── THE SAME REPROCESS, ONCE PER SELECTED TRIP ──────────────────────────────
 * Each Trip goes through `PricingEngineService.reprocess` — the single-Trip
 * reprocess — and is read back with `TripPricingService.requireCurrentSnapshot`,
 * exactly as POST /trip-pricing/trip/{id}/reprocess does. So every Trip is
 * matched again by the central route matcher (its road, direction, pricing
 * partner and Combination as they are now), priced in full and stored with its
 * route as one snapshot. Nothing here matches, prices or writes on its own.
 *
 * ── ONLY THE PRICE ──────────────────────────────────────────────────────────
 * The Engine reads the Trip, its group, its waiting time, its Custom Values and
 * its Cost Confirmations; it writes only the snapshot. No Trip field, group,
 * assignment or confirmation is written by this operation.
 *
 * ── EACH TRIP ON ITS OWN ────────────────────────────────────────────────────
 * Unlike completion, this is not all-or-nothing: a reprocess is per Trip and
 * atomic per Trip, so one Trip that cannot be priced leaves its own previous
 * snapshot untouched and every other Trip's result stands. Every Trip gets an
 * explicit outcome — never a success it did not have.
 *
 * The status is the Engine's own check, read when the Trip is priced, not the
 * one the screen showed. A Trip reopened between the write and the read-back
 * has no current price, so it is reported as skipped rather than shown its
 * stored snapshot as a new one.
 */
@Injectable()
export class BulkPricingReprocessService {
  constructor(
    private readonly pricingEngine: PricingEngineService,
    private readonly tripPricing: TripPricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(BulkPricingReprocessService.name);
  }

  async reprocessMany(tripIds: readonly string[]): Promise<BulkReprocessResultDto> {
    const results: TripReprocessResultDto[] = [];

    // One at a time: the Engine prices one Trip per call, and running a
    // selection in parallel would only race each Trip's group reads.
    for (const tripId of tripIds) {
      results.push(await this.reprocessOne(tripId));
    }

    const count = (outcome: TripReprocessOutcome) =>
      results.filter((result) => result.outcome === outcome).length;
    const summary = {
      reprocessedCount: count(TripReprocessOutcome.REPROCESSED),
      skippedCount: count(TripReprocessOutcome.SKIPPED),
      failedCount: count(TripReprocessOutcome.FAILED),
    };

    this.logger.log("Selected Trips reprocessed", {
      requestedCount: tripIds.length,
      ...summary,
      notReprocessed: results
        .filter((result) => result.outcome !== TripReprocessOutcome.REPROCESSED)
        .map((result) => ({ tripId: result.tripId, reasonCode: result.reasonCode })),
    });

    return { ...summary, results };
  }

  private async reprocessOne(tripId: string): Promise<TripReprocessResultDto> {
    try {
      await this.pricingEngine.reprocess(tripId);
    } catch (error: unknown) {
      return this.notReprocessed(tripId, error);
    }

    try {
      const snapshot = await this.tripPricing.requireCurrentSnapshot(tripId);

      return { tripId, outcome: TripReprocessOutcome.REPROCESSED, reasonCode: null, message: null, snapshot };
    } catch (error: unknown) {
      return this.notReprocessed(tripId, error);
    }
  }

  /** Skipped for a reason of the Trip's own, or failed: never a silent success. */
  private notReprocessed(tripId: string, error: unknown): TripReprocessResultDto {
    const skipReason = skipReasonOf(error);

    if (skipReason) {
      return {
        tripId,
        outcome: TripReprocessOutcome.SKIPPED,
        reasonCode: skipReason,
        message: (error as Error).message,
        snapshot: null,
      };
    }

    if (error instanceof PricingEngineException) {
      // A configuration or input the Engine refused: the operator can act on it.
      this.logger.warn("Selected Trip could not be reprocessed", {
        tripId,
        reasonCode: error.code,
      });

      return {
        tripId,
        outcome: TripReprocessOutcome.FAILED,
        reasonCode: error.code,
        message: error.message,
        snapshot: null,
      };
    }

    this.logger.error("Selected Trip failed unexpectedly while reprocessing", {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });

    return {
      tripId,
      outcome: TripReprocessOutcome.FAILED,
      reasonCode: UNEXPECTED_ERROR,
      // The detail is in the log; a raw error message is not for the screen.
      message: null,
      snapshot: null,
    };
  }
}

function skipReasonOf(error: unknown): string | null {
  if (error instanceof PricingEngineException) {
    if (error.code === PricingEngineErrorCode.TRIP_NOT_CLOSED) {
      return SkipReason.NOT_CLOSED;
    }

    if (error.code === PricingEngineErrorCode.TRIP_NOT_FOUND) {
      return SkipReason.NOT_FOUND;
    }

    return null;
  }

  // Raised by the read-back: the Trip changed between the write and the read.
  if (error instanceof TripNotClosedException) {
    return SkipReason.NOT_CLOSED;
  }

  if (error instanceof TripNotFoundException) {
    return SkipReason.NOT_FOUND;
  }

  return null;
}
