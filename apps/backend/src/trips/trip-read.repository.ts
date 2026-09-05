import { Injectable } from "@nestjs/common";
import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/**
 * The Trip columns the Pricing Engine reads, and no others.
 *
 * A Prisma `select` rather than a whole row, because the list IS the contract:
 * a reader of this file can see exactly which facts about a Trip pricing is
 * allowed to depend on, and adding a dependency means adding a column here
 * deliberately instead of it appearing by accident on an already-loaded row.
 */
const ENGINE_TRIP_COLUMNS = {
  id: true,
  bookingNumber: true,
  status: true,
  direction: true,
  terminal: true,
  destinationCity: true,
  planningDate: true,
  distanceKm: true,
  waitingTimeMinutes: true,
  // Whether TAR may be charged at all is decided from this column.
  tarNummer: true,
  tripGroupId: true,
  pdfDocumentId: true,
} as const;

/** One Trip row, restricted to the engine columns. */
export type EngineTripRow = Prisma.TripGetPayload<{
  select: typeof ENGINE_TRIP_COLUMNS;
}> & {
  // Named explicitly so the mapper's expectations are visible without
  // resolving the generated payload type.
  status: TripStatus;
  direction: TripDirection | null;
};

/**
 * Database access for the Trip read side.
 *
 * It knows nothing about pricing and nothing about the Trip lifecycle: it reads
 * eleven columns and returns rows. Every rule that interprets them lives above
 * it, which is what keeps this usable by any caller that needs the narrow shape
 * without dragging the planning domain along.
 */
@Injectable()
export class TripReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tripId: string): Promise<EngineTripRow | null> {
    return this.prisma.trip.findUnique({
      where: { id: tripId },
      select: ENGINE_TRIP_COLUMNS,
    });
  }

  /**
   * Every Trip sharing a group, including the one that asked.
   *
   * Unpaginated on purpose: a Combination holds two Trips and a manual group a
   * handful, so paging it would be machinery for a size that does not occur.
   * The order is the row order the group was built in, which nothing here
   * depends on — the Combination rule reads directions, never positions.
   */
  findByGroupId(tripGroupId: string): Promise<EngineTripRow[]> {
    return this.prisma.trip.findMany({
      where: { tripGroupId },
      select: ENGINE_TRIP_COLUMNS,
      orderBy: { id: "asc" },
    });
  }
}
