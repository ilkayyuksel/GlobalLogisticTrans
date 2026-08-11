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
 * Contains no business rules and performs no arithmetic: the reference-entity
 * rule, the active-component rule and the duplicate policy belong to
 * TripPricingItemService, and every amount is produced by the future Pricing
 * Engine. There is no delete method — historical pricing items are never
 * removed, and replacing a whole item set belongs to reprocessing, which this
 * module does not implement.
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

  /** An existing item in this snapshot already pricing a given Custom Property. */
  findByCustomProperty(
    tripPricingId: string,
    customPropertyId: string,
  ): Promise<TripPricingItem | null> {
    return this.prisma.tripPricingItem.findFirst({
      where: { tripPricingId, customPropertyId },
    });
  }

  /**
   * Classification lookup for the owning PricingComponent.
   *
   * Read-only and deliberately narrow: the pricing-configuration domain has no
   * module yet, and inventing one for a single lookup would be an abstraction
   * built for a later phase. The foreign key remains the real guard.
   */
  findPricingComponentById(
    pricingComponentId: string,
  ): Promise<PricingComponentClassification | null> {
    return this.prisma.pricingComponent.findUnique({
      where: { id: pricingComponentId },
      select: { id: true, code: true, isActive: true },
    });
  }

  create(data: CreateTripPricingItemData): Promise<TripPricingItem> {
    return this.prisma.tripPricingItem.create({ data });
  }

  update(
    id: string,
    data: UpdateTripPricingItemData,
  ): Promise<TripPricingItem> {
    return this.prisma.tripPricingItem.update({ where: { id }, data });
  }
}
