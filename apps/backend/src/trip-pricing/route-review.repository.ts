import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

/** Whether an administrator has been through each configuration's prices, by id. */
export interface RouteReviewStatus {
  /** Ordinary routes only: a Combination LEG carries no review of its own. */
  readonly routes: ReadonlyMap<string, boolean>;
  readonly combinations: ReadonlyMap<string, boolean>;
}

export const NO_REVIEW_STATUS: RouteReviewStatus = { routes: new Map(), combinations: new Map() };

/**
 * The review mark of the configurations stored snapshots were priced on — the
 * very `reviewed` flag the Routeprijzen page sets, read live and never copied.
 *
 * ── READ, NEVER STORED BESIDE A PRICE ───────────────────────────────────────
 * The mark is bookkeeping about a CONFIGURATION, and it changes after a Trip
 * was priced: copying it into the snapshot would freeze a fact that is meant
 * to change. So it is looked up when a price is read, by the ids the snapshot
 * recorded, in one query per kind whatever the number of Trips. A Combination
 * is reviewed as a whole, on its group — see `CombinationRouteGroup.reviewed`.
 *
 * Here rather than in the route-pricing module: this module reads nothing but
 * Prisma (see `effective-pricing.module.ts`), and reaching for a service there
 * would close a dependency cycle for the sake of one boolean.
 */
@Injectable()
export class RouteReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReviewStatus(
    routePricingIds: readonly string[],
    combinationRouteGroupIds: readonly string[],
  ): Promise<RouteReviewStatus> {
    const [routes, combinations] = await Promise.all([
      routePricingIds.length === 0
        ? []
        : this.prisma.routePricing.findMany({
            // A leg's own flag is never read: its group carries the mark.
            where: { id: { in: [...routePricingIds] }, combinationGroupId: null },
            select: { id: true, reviewed: true },
          }),
      combinationRouteGroupIds.length === 0
        ? []
        : this.prisma.combinationRouteGroup.findMany({
            where: { id: { in: [...combinationRouteGroupIds] } },
            select: { id: true, reviewed: true },
          }),
    ]);

    return {
      routes: new Map(routes.map((route) => [route.id, route.reviewed])),
      combinations: new Map(combinations.map((group) => [group.id, group.reviewed])),
    };
  }
}
