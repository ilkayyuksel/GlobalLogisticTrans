import { Injectable } from "@nestjs/common";

import { changedFieldNames } from "../common/changed-fields";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import {
  TripPricingBreakdownDto,
  TripPricingItemResponseDto,
  toTripPricingItemResponse,
  type TripPricingItemWithComponent,
} from "./dto/trip-pricing-item-response.dto";
import { UpdateTripPricingItemDto } from "./dto/update-trip-pricing-item.dto";
import { TripPricingItemNotFoundException } from "./exceptions/trip-pricing-item.exceptions";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";

/**
 * Reads the individual lines of a pricing breakdown. It never calculates one.
 *
 * This module does not write pricing lines. The Pricing Engine creates them,
 * together with their parent snapshot, inside one transaction — that is what
 * keeps `trip_pricing.total_price` equal to the sum of its items, which
 * database_model.md §4.13 requires and §4.14 assigns to the Engine alone.
 *
 * A line added here on its own would change that sum without changing the
 * total, so the only write this module offers is the note, which no total
 * depends on.
 *
 * Monetary values are never written to the log. Only identifiers and the
 * calculation order are, which is enough to trace a line without exposing what
 * it is worth.
 */
@Injectable()
export class TripPricingItemService {
  constructor(
    private readonly repository: TripPricingItemRepository,
    private readonly tripPricingService: TripPricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripPricingItemService.name);
  }

  /**
   * The complete breakdown of one snapshot, in calculation order.
   *
   * The snapshot's existence is verified first, so an unknown parent is
   * reported as 404 rather than as an empty breakdown — the two mean very
   * different things when a total is being explained.
   */
  async findByTripPricingId(
    tripPricingId: string,
  ): Promise<TripPricingBreakdownDto> {
    await this.tripPricingService.findById(tripPricingId);

    const items = await this.repository.findByTripPricingId(tripPricingId);

    return { items: items.map(toTripPricingItemResponse) };
  }

  async findById(id: string): Promise<TripPricingItemResponseDto> {
    return toTripPricingItemResponse(await this.requireItem(id));
  }

  /**
   * Updates the note, and nothing else.
   *
   * The DTO exposes only `notes`, so the calculated values and their provenance
   * cannot move. In particular the parent's total stays consistent with the sum
   * of its lines, because no line's amount can change here.
   */
  async update(
    id: string,
    dto: UpdateTripPricingItemDto,
  ): Promise<TripPricingItemResponseDto> {
    const existing = await this.requireItem(id);

    const updated = await this.repository.update(id, { notes: dto.notes });

    this.logger.log("Pricing item notes updated", {
      tripPricingItemId: id,
      tripPricingId: existing.tripPricingId,
      changedFields: changedFieldNames(dto),
    });

    return toTripPricingItemResponse(updated);
  }

  /**
   * Resolves component CODES to the catalog ids their items must reference.
   *
   * A calculated line names its component by code, but `trip_pricing_item`
   * carries a foreign key, so the two have to be reconciled before a breakdown
   * can be stored. One query resolves every code at once: the number of lookups
   * does not grow with the size of a breakdown, and no UUID is ever hardcoded.
   *
   * Deterministic by construction — `pricing_component.code` identifies exactly
   * one catalog row. A code with no row is simply absent from the returned map,
   * and the caller decides what that means.
   *
   * Active state is deliberately not filtered. An item records what a
   * calculation produced, and a component withdrawn from the catalog afterwards
   * must not make an already-calculated breakdown impossible to store.
   */
  async resolvePricingComponentIds(
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    const components =
      await this.repository.findPricingComponentsByCodes(codes);

    return new Map(
      components.map((component) => [component.code, component.id]),
    );
  }

  private async requireItem(id: string): Promise<TripPricingItemWithComponent> {
    const item = await this.repository.findById(id);

    if (!item) {
      throw new TripPricingItemNotFoundException(id);
    }

    return item;
  }
}
