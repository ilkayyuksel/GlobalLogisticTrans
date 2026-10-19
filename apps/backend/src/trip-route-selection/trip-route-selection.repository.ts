import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

/** One Trip's chosen route: an ordinary route, or one leg of a Combination. */
export interface TripRouteChoice {
  readonly tripId: string;
  readonly routePricingId: string;
}

/**
 * The operators' route choices — `trip_route_selection`.
 *
 * Shared by the two sides that touch it: pricing writes a choice and clears it
 * on an explicit reprocess; the Trip module clears it when the Trip's road,
 * group or status changes. Constructed over a transaction client where the
 * clearing must be atomic with the Trip write (see `TripRepository`).
 */
@Injectable()
export class TripRouteSelectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores these choices together, replacing each Trip's previous one. The
   * two legs of a Combination are always written in one call.
   */
  async replace(choices: readonly TripRouteChoice[]): Promise<void> {
    await this.prisma.$transaction(
      choices.map((choice) =>
        this.prisma.tripRouteSelection.upsert({
          where: { tripId: choice.tripId },
          create: { tripId: choice.tripId, routePricingId: choice.routePricingId },
          update: { routePricingId: choice.routePricingId, selectedAt: new Date() },
        }),
      ),
    );
  }

  /**
   * Removes these Trips' choices AND the matching choice of their partner leg.
   *
   * A Combination choice is a fact about the PAIR — both legs were written
   * together — so it never outlives one of its halves: removing one leg's
   * removes every choice of the same Combination within the same Trip group.
   * Returns how many choices were removed.
   */
  async clearForTrips(tripIds: readonly string[]): Promise<number> {
    if (tripIds.length === 0) {
      return 0;
    }

    const own = await this.prisma.tripRouteSelection.findMany({
      where: { tripId: { in: [...tripIds] } },
      select: {
        trip: { select: { tripGroupId: true } },
        routePricing: { select: { combinationGroupId: true } },
      },
    });
    const pairs = own.flatMap((choice) =>
      choice.trip.tripGroupId && choice.routePricing.combinationGroupId
        ? [{ tripGroupId: choice.trip.tripGroupId, combinationGroupId: choice.routePricing.combinationGroupId }]
        : [],
    );

    const removed = await this.prisma.tripRouteSelection.deleteMany({
      where: {
        OR: [
          { tripId: { in: [...tripIds] } },
          ...pairs.map((pair) => ({
            trip: { tripGroupId: pair.tripGroupId },
            routePricing: { combinationGroupId: pair.combinationGroupId },
          })),
        ],
      },
    });

    return removed.count;
  }
}
