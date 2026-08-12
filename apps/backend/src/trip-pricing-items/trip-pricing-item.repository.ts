import { Injectable } from "@nestjs/common";
import { Prisma, TripPricingItem } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreateTripPricingItemData =
  Prisma.TripPricingItemUncheckedCreateInput;
export type UpdateTripPricingItemData =
  Prisma.TripPricingItemUncheckedUpdateInput;

/** The fields of a PricingComponent this module needs to classify an item. */
export interface PricingComponentClassification {
  id: string;
  code: string;
  isActive: boolean;
}

/**
 * Database access for the TripPricingItem domain.
 *
 * Contains no business rules and performs no arithmetic: every amount is
 * produced by the Pricing Engine.
 *
 * The two write methods here — `createMany` and `deleteByTripPricingId` — are
 * the halves of the Engine's atomic snapshot replacement and are used only from
 * inside its transaction. Neither is reachable over REST, and there is no
 * single-item create or delete, because a line written on its own would leave
 * `trip_pricing.total_price` disagreeing with the sum of its items.
 */
@Injectable()
export class TripPricingItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<TripPricingItem | null> {
    return this.prisma.tripPricingItem.findUnique({ where: { id } });
  }

  /**
   * The complete breakdown of one snapshot, in calculation order.
   *
   * `calculation_order` is deliberately not unique, so `id` breaks ties and
   * keeps the sequence stable across requests.
   */
  findByTripPricingId(tripPricingId: string): Promise<TripPricingItem[]> {
    return this.prisma.tripPricingItem.findMany({
      where: { tripPricingId },
      orderBy: [{ calculationOrder: "asc" }, { id: "asc" }],
    });
  }

  /**
   * The catalog rows for a set of component codes.
   *
   * Every item carries a foreign key to `pricing_component`, and a calculated
   * line names its component by CODE. One query resolves them all, so the
   * number of lookups does not grow with the size of a breakdown.
   *
   * Read-only and deliberately narrow: the pricing-configuration domain has no
   * module yet, and inventing one for a lookup would be an abstraction built
   * for a later phase.
   */
  findPricingComponentsByCodes(
    codes: readonly string[],
  ): Promise<PricingComponentClassification[]> {
    return this.prisma.pricingComponent.findMany({
      where: { code: { in: [...codes] } },
      select: { id: true, code: true, isActive: true },
    });
  }

  /**
   * Writes a whole breakdown in one statement.
   *
   * Used only by the Pricing Engine's snapshot write, where the items are
   * always created together with — or alongside — their parent. Inserting them
   * one by one would multiply the round trips inside a transaction that should
   * stay as short as possible.
   */
  createMany(data: CreateTripPricingItemData[]): Promise<{ count: number }> {
    return this.prisma.tripPricingItem.createMany({ data });
  }

  /**
   * Discards a snapshot's entire breakdown.
   *
   * Reprocessing replaces the whole item set, so the old lines go before the
   * new ones arrive — otherwise a component that no longer applies would
   * survive as a stale charge. Deliberately not exposed through the REST API:
   * this is one half of an atomic replacement, never an operation of its own.
   */
  deleteByTripPricingId(tripPricingId: string): Promise<{ count: number }> {
    return this.prisma.tripPricingItem.deleteMany({ where: { tripPricingId } });
  }

  update(
    id: string,
    data: UpdateTripPricingItemData,
  ): Promise<TripPricingItem> {
    return this.prisma.tripPricingItem.update({ where: { id }, data });
  }
}
