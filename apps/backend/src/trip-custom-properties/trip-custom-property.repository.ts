import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/**
 * An assignment together with the property it points at.
 *
 * The join row on its own carries two identifiers and a timestamp, which is
 * never what a caller wants: the question is always "which properties does this
 * Trip carry", and that needs the property. Loading it through the declared
 * relation costs one query instead of one per assignment.
 */
const WITH_CUSTOM_PROPERTY = { customProperty: true } as const;

export type TripCustomPropertyWithProperty =
  Prisma.TripCustomPropertyGetPayload<{ include: typeof WITH_CUSTOM_PROPERTY }>;

export type CreateTripCustomPropertyData =
  Prisma.TripCustomPropertyUncheckedCreateInput;

/**
 * Database access for the TripCustomProperty domain.
 *
 * Contains no business rules: the active-property rule, the duplicate policy
 * and error translation belong to TripCustomPropertyService.
 *
 * This is the one module in the system with a real delete. An assignment is a
 * current fact, not a historical one — database_schema.md §4.4 states rows may
 * be physically deleted when an Administrator unassigns a property, because the
 * pricing consequence is already frozen in `trip_pricing_item` and no longer
 * depends on this row.
 */
@Injectable()
export class TripCustomPropertyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every property assigned to a Trip, in the configured display order.
   *
   * The property's own `displayOrder` decides the sequence, so a Trip's
   * properties appear in the same order everywhere in the application. `id`
   * breaks ties, because display order is not unique.
   */
  findByTripId(tripId: string): Promise<TripCustomPropertyWithProperty[]> {
    return this.prisma.tripCustomProperty.findMany({
      where: { tripId },
      include: WITH_CUSTOM_PROPERTY,
      orderBy: [{ customProperty: { displayOrder: "asc" } }, { id: "asc" }],
    });
  }

  findById(id: string): Promise<TripCustomPropertyWithProperty | null> {
    return this.prisma.tripCustomProperty.findUnique({
      where: { id },
      include: WITH_CUSTOM_PROPERTY,
    });
  }

  /** Uses the unique pair index, so at most one row can match. */
  findByTripAndProperty(
    tripId: string,
    customPropertyId: string,
  ): Promise<TripCustomPropertyWithProperty | null> {
    return this.prisma.tripCustomProperty.findUnique({
      where: { tripId_customPropertyId: { tripId, customPropertyId } },
      include: WITH_CUSTOM_PROPERTY,
    });
  }

  create(
    data: CreateTripCustomPropertyData,
  ): Promise<TripCustomPropertyWithProperty> {
    return this.prisma.tripCustomProperty.create({
      data,
      include: WITH_CUSTOM_PROPERTY,
    });
  }

  /** Physically removes the assignment. Neither Trip nor property is touched. */
  delete(id: string): Promise<TripCustomPropertyWithProperty> {
    return this.prisma.tripCustomProperty.delete({
      where: { id },
      include: WITH_CUSTOM_PROPERTY,
    });
  }
}
