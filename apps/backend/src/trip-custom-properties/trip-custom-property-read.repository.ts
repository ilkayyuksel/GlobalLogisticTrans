import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/**
 * An assignment reduced to what a price depends on.
 *
 * The join row itself contributes nothing to a calculation — it says only THAT
 * the Trip carries the property — so the four fields that decide the charge are
 * lifted from the property it points at.
 */
const PRICING_COLUMNS = {
  customProperty: {
    select: {
      id: true,
      name: true,
      pricingComponentId: true,
      defaultPrice: true,
    },
  },
} as const;

export type TripCustomPropertyPricingRow =
  Prisma.TripCustomPropertyGetPayload<{ select: typeof PRICING_COLUMNS }>;

/**
 * Database access for the assignment read side.
 *
 * No create and no delete: assigning and unassigning belong to
 * TripCustomPropertyRepository, which the write module owns. This half exists
 * so the Pricing Engine can read a Trip's properties without reaching through
 * the module that now calls the Engine back.
 */
@Injectable()
export class TripCustomPropertyReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every property a Trip carries, in the properties' configured display order.
   *
   * The order is the one the whole application uses, so a stored breakdown
   * lists its Custom Property lines the same way the planning screen lists the
   * assignments that produced them. `id` breaks ties, because display order is
   * not unique.
   */
  findByTripId(tripId: string): Promise<TripCustomPropertyPricingRow[]> {
    return this.prisma.tripCustomProperty.findMany({
      where: { tripId },
      select: PRICING_COLUMNS,
      orderBy: [{ customProperty: { displayOrder: "asc" } }, { id: "asc" }],
    });
  }
}
