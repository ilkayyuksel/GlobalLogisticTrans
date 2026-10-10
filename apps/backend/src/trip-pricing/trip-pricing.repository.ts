import { Injectable } from "@nestjs/common";
import { Prisma, TripPricing, TripPricingRouteLeg } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PRICED_TRIP_STATUS } from "./current-pricing";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import type { TripPricingItemWithComponent } from "../trip-pricing-items/dto/trip-pricing-item-response.dto";

/** A snapshot together with its breakdown, as one read returns it. */
export type TripPricingWithItems = TripPricing & {
  items: TripPricingItemWithComponent[];
};

/** A snapshot with its breakdown AND the route(s) it was priced against. */
export type TripPricingWithItemsAndRoute = TripPricingWithItems & {
  routeLegs: TripPricingRouteLeg[];
};

/** One matched road to store with a snapshot. */
export type TripPricingRouteLegData = Omit<
  Prisma.TripPricingRouteLegUncheckedCreateInput,
  "id" | "tripPricingId" | "createdAt"
>;

/** The same lines, ordered, every read: by calculation order, then id. */
const ITEMS_WITH_COMPONENT = {
  include: { pricingComponent: { select: { code: true } } },
  orderBy: [{ calculationOrder: "asc" as const }, { id: "asc" as const }],
};

/** Leg 1 before Leg 2; an ordinary route's single row has no position. */
const ROUTE_LEGS_IN_ORDER = { orderBy: { legPosition: "asc" as const } };

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
  /**
   * The CURRENT snapshots of many Trips: those of CLOSED Trips only.
   *
   * A reopened, cancelled or deleted Trip keeps its snapshot as history, and
   * it is simply absent here — the same answer as a Trip never priced. See
   * `current-pricing.ts`.
   */
  findCurrentByTripIds(
    tripIds: readonly string[],
  ): Promise<TripPricingWithItemsAndRoute[]> {
    return this.readConsistently((client) =>
      client.tripPricing.findMany({
        where: {
          tripId: { in: [...tripIds] },
          trip: { status: PRICED_TRIP_STATUS },
        },
        include: { items: ITEMS_WITH_COMPONENT, routeLegs: ROUTE_LEGS_IN_ORDER },
      }),
    );
  }

  /**
   * ── ONE CALCULATION, NEVER TWO HALVES ─────────────────────────────────────
   * A snapshot is read as a header, its items and its route legs — separate
   * statements under Prisma's relation loading. A recalculation committing in
   * between would pair one calculation's route with another's amounts. One
   * REPEATABLE READ transaction sees all three as of the same moment, and a
   * snapshot is only ever replaced as a whole inside one transaction, so the
   * read always returns one calculation.
   */
  private readConsistently<TResult>(
    read: (client: PrismaService) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(
      (transaction) => read(transaction as unknown as PrismaService),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Replaces the road(s) a snapshot was priced against.
   *
   * One half of the atomic snapshot replacement, like the items': called only
   * inside `runInTransaction`, after the header was written.
   */
  async replaceRouteLegs(
    tripPricingId: string,
    legs: readonly TripPricingRouteLegData[],
  ): Promise<void> {
    await this.prisma.tripPricingRouteLeg.deleteMany({ where: { tripPricingId } });

    if (legs.length > 0) {
      await this.prisma.tripPricingRouteLeg.createMany({
        data: legs.map((leg) => ({ ...leg, tripPricingId })),
      });
    }
  }

  /**
   * The Trip's stored snapshot, WHATEVER its status.
   *
   * For the Engine and the snapshot store, which must find a reopened Trip's
   * old snapshot to replace it when the Trip closes again. Never for showing a
   * price — that is `findCurrentByTripId`.
   */
  findByTripId(tripId: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findUnique({ where: { tripId } });
  }

  /** The Trip's CURRENT snapshot: only while the Trip is CLOSED. */
  findCurrentByTripId(tripId: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findFirst({
      where: { tripId, trip: { status: PRICED_TRIP_STATUS } },
    });
  }

  create(data: CreateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.create({ data });
  }

  update(id: string, data: UpdateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.update({ where: { id }, data });
  }

  /**
   * Rewrites a snapshot's header unless the stored one describes LATER inputs.
   *
   * A conditional UPDATE in one statement: a concurrent writer of the same row
   * waits on its lock, and Postgres then re-checks `calculated_at` against the
   * row as that writer left it. Two recalculations of one Trip therefore cannot
   * land out of order. Null when the stored snapshot is newer and nothing was
   * written.
   */
  async updateUnlessNewerStored(
    id: string,
    data: Prisma.TripPricingUncheckedUpdateManyInput & { calculatedAt: Date },
  ): Promise<TripPricing | null> {
    const { count } = await this.prisma.tripPricing.updateMany({
      where: { id, calculatedAt: { lte: data.calculatedAt } },
      data,
    });

    return count === 1 ? this.findById(id) : null;
  }
}
