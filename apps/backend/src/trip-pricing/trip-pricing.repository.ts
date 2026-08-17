import { Injectable } from "@nestjs/common";
import { Prisma, TripPricing } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import type { TripPricingItemWithComponent } from "../trip-pricing-items/dto/trip-pricing-item-response.dto";

/** A snapshot together with its breakdown, as one read returns it. */
export type TripPricingWithItems = TripPricing & {
  items: TripPricingItemWithComponent[];
};

export type CreateTripPricingData = Prisma.TripPricingUncheckedCreateInput;
export type UpdateTripPricingData = Prisma.TripPricingUncheckedUpdateInput;

/**
 * The two repositories a snapshot write needs, bound to one transaction.
 *
 * A snapshot IS its parent plus its breakdown: `trip_pricing_item` cascades
 * from `trip_pricing` and has no lifecycle of its own, so the two tables are
 * written as a single unit. Handing both out together is what lets a service
 * replace a whole snapshot without ever seeing a Prisma client.
 */
export interface PricingSnapshotRepositories {
  readonly pricing: TripPricingRepository;
  readonly items: TripPricingItemRepository;
}

/**
 * Database access for the TripPricing domain.
 *
 * Contains no business rules and performs no arithmetic: the Trip's status
 * check, duplicate policy and error translation belong to TripPricingService,
 * and the amounts themselves are produced by the future Pricing Engine. There
 * is no delete method, because a pricing snapshot is never removed — historical
 * pricing must stay explainable.
 */
@Injectable()
export class TripPricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` against transaction-scoped clones of this repository and the
   * item repository.
   *
   * The service never sees a Prisma client: it receives repositories bound to
   * the transaction, so the layering rule holds while the parent and its whole
   * breakdown are written as one unit. A failure anywhere inside rolls back
   * everything, which is the only way a stored total can be guaranteed to equal
   * the sum of its own items.
   *
   * Both clones are constructed directly rather than injected, following the
   * pattern Trip and VehicleAssignment already use: they are the same classes,
   * differing only in the client they hold.
   */
  runInTransaction<TResult>(
    work: (repositories: PricingSnapshotRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) => {
      const scoped = transaction as unknown as PrismaService;

      return work({
        pricing: new TripPricingRepository(scoped),
        items: new TripPricingItemRepository(scoped),
      });
    });
  }

  findById(id: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findUnique({ where: { id } });
  }

  /** Unique on trip_id, so a Trip resolves to at most one snapshot. */
  /**
   * The snapshots of many Trips, with their lines, in one query.
   *
   * Trips without a snapshot are simply absent: an unpriced Trip is an ordinary
   * state, and an empty row would be indistinguishable from a priced one whose
   * total happens to be zero.
   */
  findManyByTripIds(
    tripIds: readonly string[],
  ): Promise<TripPricingWithItems[]> {
    return this.prisma.tripPricing.findMany({
      where: { tripId: { in: [...tripIds] } },
      include: {
        items: {
          include: { pricingComponent: { select: { code: true } } },
          orderBy: [{ calculationOrder: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  findByTripId(tripId: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findUnique({ where: { tripId } });
  }

  create(data: CreateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.create({ data });
  }

  update(id: string, data: UpdateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.update({ where: { id }, data });
  }
}
