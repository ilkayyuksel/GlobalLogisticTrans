import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import {
  PricingSnapshotItemData,
  TripPricingService,
} from "../trip-pricing/trip-pricing.service";
import { UnknownPricingComponentException } from "./exceptions/pricing-engine.exceptions";
import { ExistingPricingSnapshot } from "./pricing-calculation-context";
import { PricingCalculationResult } from "./pricing-calculation-result";
import { PricingLine } from "./pricing-line";

/**
 * The Pricing Engine's boundary to the pricing store.
 *
 * Every read and write of a pricing snapshot passes through here, so the rest
 * of the Engine never talks to the pricing modules directly and a future change
 * in how results are persisted touches one file.
 *
 * It stores; it never calculates. Every amount, quantity, unit price and total
 * arrives already computed on the result, and nothing here recomputes any of
 * them — persistence is a mechanical mapping from calculated lines onto rows.
 *
 * Amounts are never logged. Identifiers, component codes, statuses and counts
 * are, which is enough to trace a snapshot without exposing what it is worth.
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

  /**
   * Stores a finished calculation as the Trip's snapshot.
   *
   * The component codes are resolved to catalog ids BEFORE the write begins, so
   * the transaction contains writes only and stays as short as it can be. An
   * unresolvable code is refused here rather than left to the foreign key,
   * which would report a column and a UUID instead of the missing component.
   *
   * The write itself is one transaction owned by TripPricingService: parent and
   * breakdown succeed together or not at all. That is what guarantees the
   * stored total always equals the sum of its own items — the invariant is a
   * property of the transaction, not something checked afterwards.
   */
  async writeSnapshot(result: PricingCalculationResult): Promise<string> {
    const items = await this.toItemData(result.lines);

    const stored = await this.tripPricingService.replaceSnapshot({
      tripId: result.tripId,
      totalPrice: result.totalPrice,
      calculatedAt: result.calculatedAt,
      pricingEngineVersion: result.pricingEngineVersion,
      pricingRuleVersion: result.pricingRuleVersion,
      calculationStatus: result.calculationStatus,
      items,
    });

    this.logger.log("Pricing snapshot written", {
      tripId: result.tripId,
      tripPricingId: stored.id,
      calculationStatus: stored.calculationStatus,
      itemCount: items.length,
      isReprocess: result.isReprocess,
    });

    return stored.id;
  }

  /**
   * Maps calculated lines onto storable rows.
   *
   * A mechanical field-for-field copy. No amount is recalculated, no quantity
   * is derived and no customPropertyId is inferred: a line that carries one
   * keeps it, and a line that does not stores null. Inferring a reference here
   * would attach a property to a charge the property did not produce.
   */
  private async toItemData(
    lines: readonly PricingLine[],
  ): Promise<PricingSnapshotItemData[]> {
    const componentIds = await this.resolveComponentIds(lines);

    return lines.map((line) => ({
      pricingComponentId: componentIds.get(line.component) as string,
      customPropertyId: line.customPropertyId,
      description: line.description,
      amount: line.amount,
      calculationOrder: line.calculationOrder,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }));
  }

  /**
   * Every distinct component the breakdown uses, resolved in one query.
   *
   * Deduplicated first, because several lines can share a component — a Trip
   * with two fixed-price Custom Properties produces two CUSTOM_PROPERTY lines.
   */
  private async resolveComponentIds(
    lines: readonly PricingLine[],
  ): Promise<Map<string, string>> {
    const codes = [...new Set(lines.map((line) => line.component))];
    const resolved =
      await this.tripPricingItemService.resolvePricingComponentIds(codes);

    for (const code of codes) {
      if (!resolved.has(code)) {
        this.logger.warn("Calculated line names an unknown pricing component", {
          componentCode: code,
        });

        throw new UnknownPricingComponentException(code);
      }
    }

    return resolved;
  }
}
