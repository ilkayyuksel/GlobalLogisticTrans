import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { ExistingPricingSnapshot } from "./pricing-calculation-context";

/**
 * The Pricing Engine's boundary to the pricing store.
 *
 * Every read and write of a pricing snapshot passes through here, so the rest
 * of the Engine never talks to the pricing modules directly and a future change
 * in how results are persisted touches one file.
 *
 * In this foundation phase the boundary is READ-ONLY. It reports whether a Trip
 * already has a snapshot, which is what tells a calculation whether it is the
 * Trip's first or a reprocess — pricing_rules.md treats those as two distinct
 * events. The write operation lands with the calculation phases, because there
 * is nothing to write until a total exists.
 *
 * When it does land it will need one atomic operation, not a sequence of calls:
 * a snapshot and its lines must be replaced together, or a failure halfway
 * leaves a total that disagrees with its own breakdown.
 */
@Injectable()
export class PricingSnapshotWriter {
  constructor(
    private readonly tripPricingService: TripPricingService,
    private readonly tripPricingItemService: TripPricingItemService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingSnapshotWriter.name);
  }

  /**
   * The snapshot a recalculation would replace, or null on a first calculation.
   *
   * The line count is included because it is what reprocessing discards, and an
   * administrator asking why a breakdown changed needs to know how much was
   * there before. No amount is read or reported.
   */
  async findExistingSnapshot(
    tripId: string,
  ): Promise<ExistingPricingSnapshot | null> {
    const snapshot = await this.tripPricingService.findByTripId(tripId);

    if (!snapshot) {
      return null;
    }

    const breakdown = await this.tripPricingItemService.findByTripPricingId(
      snapshot.id,
    );

    this.logger.log("Existing pricing snapshot found", {
      tripId,
      tripPricingId: snapshot.id,
      calculationStatus: snapshot.calculationStatus,
      itemCount: breakdown.items.length,
    });

    return {
      tripPricingId: snapshot.id,
      calculationStatus: snapshot.calculationStatus,
      itemCount: breakdown.items.length,
    };
  }
}
