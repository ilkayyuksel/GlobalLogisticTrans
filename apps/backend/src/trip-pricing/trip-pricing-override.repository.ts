import { Injectable } from "@nestjs/common";
import { Prisma, TripPricingOverride } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/**
 * Database access for operator price corrections.
 *
 * Deliberately separate from `TripPricingRepository`: an override is not part
 * of a snapshot and must not be written or deleted by the code that replaces
 * one. Keeping the two behind different doors is what makes it impossible for
 * a recalculation to reach an override by accident.
 */
@Injectable()
export class TripPricingOverrideRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForTrip(tripId: string): Promise<TripPricingOverride[]> {
    return this.prisma.tripPricingOverride.findMany({
      where: { tripId },
      orderBy: { componentCode: "asc" },
    });
  }

  /**
   * Every override of these Trips, for a whole page at once.
   *
   * ONE query for a list, which is what keeps the pricing columns off the N+1
   * path — the same reason the assignment lookups are batched.
   */
  findForTrips(
    tripIds: readonly string[],
  ): Promise<TripPricingOverride[]> {
    if (tripIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.tripPricingOverride.findMany({
      where: { tripId: { in: [...tripIds] } },
      orderBy: { componentCode: "asc" },
    });
  }

  /**
   * Records a correction, replacing any earlier one for the same component.
   *
   * An upsert rather than an insert: changing a price twice is one opinion
   * revised, not two opinions held, and the unique constraint says so.
   *
   * Currency is absent on purpose. The column defaults to EUR and no caller has
   * a reason to choose one, so leaving it out keeps a hardcoded currency from
   * spreading through the service layer.
   */
  upsert(data: {
    tripId: string;
    componentCode: string;
    amount: Prisma.Decimal;
    overriddenBy: string;
  }): Promise<TripPricingOverride> {
    return this.prisma.tripPricingOverride.upsert({
      where: {
        tripId_componentCode: {
          tripId: data.tripId,
          componentCode: data.componentCode,
        },
      },
      create: data,
      update: {
        amount: data.amount,
        overriddenBy: data.overriddenBy,
      },
    });
  }

  /**
   * Withdraws a correction, returning the component to the Engine's figure.
   *
   * Reports whether a row was actually removed. `deleteMany` rather than
   * `delete` so a component that carries no override is an ordinary false
   * instead of a thrown Prisma error — but the caller still learns nothing
   * happened, because a reset that silently did nothing would let a screen
   * claim a value returned to its calculated figure when it never moved.
   */
  async remove(tripId: string, componentCode: string): Promise<boolean> {
    const { count } = await this.prisma.tripPricingOverride.deleteMany({
      where: { tripId, componentCode },
    });

    return count > 0;
  }
}
