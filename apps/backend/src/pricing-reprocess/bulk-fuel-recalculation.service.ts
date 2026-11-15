import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingEngineException } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import {
  FuelRecalculationResult,
  FuelRecalculationService,
} from "../pricing-engine/fuel-recalculation.service";
import { TripPricingNotFoundException } from "../trip-pricing/exceptions/trip-pricing.exceptions";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { skipReasonOf } from "./bulk-pricing-reprocess.service";
import {
  BulkReprocessResultDto,
  TripReprocessOutcome,
  TripReprocessResultDto,
} from "./dto/reprocess-trips.dto";

/** Why a selected Trip's fuel was not recalculated, beside NOT_CLOSED / NOT_FOUND. */
export const FuelSkipReason = {
  /** CLOSED, but never priced: "Prijs herberekenen" prices it first. */
  NOT_PRICED: "NOT_PRICED",
  NO_FUEL_LINE: "NO_FUEL_LINE",
} as const;

/** A full recalculation replaced the snapshot while this ran; that one stands. */
const SNAPSHOT_CHANGED = "SNAPSHOT_CHANGED";
const UNEXPECTED_ERROR = "UNEXPECTED_ERROR";

/**
 * "Brandstof herberekenen" for a selection of Trips — beside "Prijs
 * herberekenen" (`BulkPricingReprocessService`), with its request, its answer
 * and its per-Trip outcomes, but only the fuel line changes
 * (`FuelRecalculationService`).
 *
 * ONE percentage for the whole selection: FUEL_PERCENTAGE is read once, so
 * every Trip of one click carries the same rate. An unusable setting fails
 * every Trip with the Engine's own reason and writes nothing.
 *
 * Each Trip on its own: one that cannot be recalculated keeps its snapshot
 * exactly as it was, and every other Trip's result stands.
 */
@Injectable()
export class BulkFuelRecalculationService {
  constructor(
    private readonly fuel: FuelRecalculationService,
    private readonly tripPricing: TripPricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(BulkFuelRecalculationService.name);
  }

  async recalculateMany(tripIds: readonly string[]): Promise<BulkReprocessResultDto> {
    const results = await this.resultsFor(tripIds);
    const count = (outcome: TripReprocessOutcome) =>
      results.filter((result) => result.outcome === outcome).length;
    const summary = {
      reprocessedCount: count(TripReprocessOutcome.REPROCESSED),
      skippedCount: count(TripReprocessOutcome.SKIPPED),
      failedCount: count(TripReprocessOutcome.FAILED),
    };

    this.logger.log("Fuel of selected Trips recalculated", {
      requestedCount: tripIds.length,
      ...summary,
      notRecalculated: results
        .filter((result) => result.outcome !== TripReprocessOutcome.REPROCESSED)
        .map((result) => ({ tripId: result.tripId, reasonCode: result.reasonCode })),
    });

    return { ...summary, results };
  }

  private async resultsFor(tripIds: readonly string[]): Promise<TripReprocessResultDto[]> {
    let fuelPercentage: string;

    try {
      fuelPercentage = await this.fuel.currentFuelPercentage();
    } catch (error: unknown) {
      return tripIds.map((tripId) => this.failed(tripId, error));
    }

    const results: TripReprocessResultDto[] = [];

    // One at a time, like "Prijs herberekenen": each write is its own transaction.
    for (const tripId of tripIds) {
      results.push(await this.recalculateOne(tripId, fuelPercentage));
    }

    return results;
  }

  private async recalculateOne(tripId: string, fuelPercentage: string): Promise<TripReprocessResultDto> {
    try {
      const result = await this.fuel.recalculate(tripId, fuelPercentage);

      if (result === FuelRecalculationResult.NO_FUEL_LINE) {
        return this.skipped(tripId, FuelSkipReason.NO_FUEL_LINE, "The Trip's pricing has no fuel line to recalculate.");
      }

      if (result === FuelRecalculationResult.SNAPSHOT_CHANGED) {
        return {
          tripId,
          outcome: TripReprocessOutcome.FAILED,
          reasonCode: SNAPSHOT_CHANGED,
          message: "The Trip was priced again meanwhile; its fuel was not changed. Try again.",
          snapshot: null,
        };
      }

      // RECALCULATED reads back what was stored; NOT_PRICED lets the read say why.
      const snapshot = await this.tripPricing.requireCurrentSnapshot(tripId);

      return { tripId, outcome: TripReprocessOutcome.REPROCESSED, reasonCode: null, message: null, snapshot };
    } catch (error: unknown) {
      return this.notRecalculated(tripId, error);
    }
  }

  private notRecalculated(tripId: string, error: unknown): TripReprocessResultDto {
    const skipReason = skipReasonOf(error);

    if (skipReason) {
      return this.skipped(tripId, skipReason, (error as Error).message);
    }

    if (error instanceof TripPricingNotFoundException) {
      return this.skipped(tripId, FuelSkipReason.NOT_PRICED, error.message);
    }

    return this.failed(tripId, error);
  }

  private skipped(tripId: string, reasonCode: string, message: string): TripReprocessResultDto {
    return { tripId, outcome: TripReprocessOutcome.SKIPPED, reasonCode, message, snapshot: null };
  }

  private failed(tripId: string, error: unknown): TripReprocessResultDto {
    if (error instanceof PricingEngineException) {
      this.logger.warn("Fuel of selected Trip could not be recalculated", { tripId, reasonCode: error.code });

      return { tripId, outcome: TripReprocessOutcome.FAILED, reasonCode: error.code, message: error.message, snapshot: null };
    }

    this.logger.error("Fuel of selected Trip failed unexpectedly", {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });

    // The detail is in the log; a raw error message is not for the screen.
    return { tripId, outcome: TripReprocessOutcome.FAILED, reasonCode: UNEXPECTED_ERROR, message: null, snapshot: null };
  }
}
