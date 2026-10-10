import { Injectable } from "@nestjs/common";
import { CombinationRouteGroup, Prisma, RoutePricing } from "@prisma/client";

import { isSameTerminal } from "../common/terminal";
import { PrismaService } from "../prisma/prisma.service";
import { RoadEndpoints, isSameCombination } from "./route-identity";

export interface FindRoutePricingFilter {
  search?: string;
  /** Restricts the page to ordinary routes or to Combination legs. */
  kind?: RouteConfigurationKind;
  skip: number;
  take: number;
}

/**
 * Which KIND of route configuration a lookup means.
 *
 * ── WHY A LOOKUP HAS TO SAY ─────────────────────────────────────────────────
 * One road can be configured twice: once as an ordinary route, and once as a leg
 * of a Combination, priced differently because a Combination's outbound and
 * return are their own transports. Both rows are legitimate and neither
 * overwrites the other, so a caller asking "what is configured for Antwerp to
 * Kallo" has to say which of the two it is pricing.
 */
export const RouteConfigurationKind = {
  NORMAL: "NORMAL",
  COMBINATION: "COMBINATION",
} as const;

export type RouteConfigurationKind =
  (typeof RouteConfigurationKind)[keyof typeof RouteConfigurationKind];

export type CombinationRouteGroupWithLegs = CombinationRouteGroup & {
  legs: RoutePricing[];
};

/**
 * The Over ST amounts of a Combination as they are written. Null clears one back
 * to "nobody has stated it".
 */
export interface CombinationOverStData {
  readonly tarief: number | null;
  readonly toll: number | null;
  readonly tunnel: number | null;
}

const NO_OVER_ST: CombinationOverStData = { tarief: null, toll: null, tunnel: null };

function toOverStColumns(overSt: CombinationOverStData) {
  return {
    overStBasePrice: overSt.tarief,
    overStToll: overSt.toll,
    overStTunnel: overSt.tunnel,
  };
}

export interface FindRouteOptions {
  readonly kind: RouteConfigurationKind;
  /** Lets an update ignore the row being edited, so it never conflicts with itself. */
  readonly excludeRoutePricingId?: string;
}

export interface RoutePricingPage {
  items: RoutePricing[];
  totalItems: number;
}

export type CreateRoutePricingData = Prisma.RoutePricingUncheckedCreateInput;
export type UpdateRoutePricingData = Prisma.RoutePricingUncheckedUpdateInput;

/**
 * Database access for the RoutePricing domain.
 *
 * Contains no business rules and performs no arithmetic: duplicate-route
 * policy and error translation belong to RoutePricingService, and price
 * calculation belongs to the Pricing Engine.
 *
 * A route CAN be deleted. It used to be deactivated instead, on the rule that
 * pricing already calculated had to stay explainable — which it does: a
 * snapshot stores the amounts it was priced with and reads no configuration
 * afterwards. What a kept-but-inactive row actually produced was a second
 * state for the screen to explain, so the row goes and history is untouched.
 */
@Injectable()
export class RoutePricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` against a transaction-scoped clone of this repository.
   *
   * The service never sees a Prisma client: it receives a repository bound to
   * the transaction, so the layering rule holds while a Combination's group row
   * and BOTH its legs commit together. That is what makes a one-leg Combination
   * impossible to store.
   */
  runInTransaction<TResult>(
    work: (repository: RoutePricingRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) =>
      work(new RoutePricingRepository(transaction as unknown as PrismaService)),
    );
  }

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindRoutePricingFilter): Promise<RoutePricingPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.routePricing.findMany({
        where,
        orderBy: [{ routeName: "asc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.routePricing.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<RoutePricing | null> {
    return this.prisma.routePricing.findUnique({ where: { id } });
  }

  /**
   * `excludeRoutePricingId` lets an update ignore the row being edited, so
   * saving a record without changing its route never conflicts with itself.
   */
  /**
   * The route configured between two places.
   *
   * ── THE DEPARTURE IS MATCHED, NOT COMPARED ────────────────────────────────
   * The destination is an exact match, but the departure is a TERMINAL, and one
   * terminal has more than one spelling: a transport order writes the same quay
   * as `PSA Quay 869` or `Quay 869` depending on which section a Trip was read
   * from. Both spellings also exist in this table, because the configuration
   * was entered from documents that used both.
   *
   * So the departure is matched with the shared terminal rule rather than by
   * SQL equality: a Trip carrying either spelling finds configuration carrying
   * either spelling. Nothing is rewritten to achieve that — the stored values
   * stay exactly as the operator entered them.
   *
   * The candidates are narrowed in SQL by destination and active state, and the
   * terminal decides among them in memory. The set is small by construction:
   * these are the routes configured to one destination.
   */
  async findByRoute(
    departure: string,
    destination: string,
    options: FindRouteOptions,
  ): Promise<RoutePricing | null> {
    /*
     * The kind is part of the identity of a configured route, not a filter over
     * one set: an ordinary route and a Combination leg may describe the same
     * road and are read in different contexts.
     *
     * Ordered by id inside `findAllByRoute`, so a caller gets the same answer
     * every time. ONE row per road is guaranteed for an ordinary route by its
     * partial unique index; a Combination leg's road may now be held by several
     * groups, and a caller that must know takes `findAllByRoute` instead.
     */
    const matches = await this.findAllByRoute(departure, destination, options);

    return matches[0] ?? null;
  }

  /**
   * Every ORDINARY route, in a stable order — what a Trip's road is matched
   * against (`route-matcher.ts`). The matcher needs them all: whether a road
   * is a typo of one configuration, or fits two, cannot be answered from the
   * exact matches alone.
   */
  findAllOrdinary(): Promise<RoutePricing[]> {
    return this.prisma.routePricing.findMany({
      where: { combinationGroupId: null },
      orderBy: { id: "asc" },
    });
  }

  create(data: CreateRoutePricingData): Promise<RoutePricing> {
    return this.prisma.routePricing.create({ data });
  }

  update(id: string, data: UpdateRoutePricingData): Promise<RoutePricing> {
    return this.prisma.routePricing.update({ where: { id }, data });
  }

  /** Removes the configuration. Snapshots priced from it are untouched. */
  delete(id: string): Promise<RoutePricing> {
    return this.prisma.routePricing.delete({ where: { id } });
  }

  /**
   * The legs of one Combination configuration, outbound first.
   *
   * Ordered by the stored POSITION rather than by `createdAt`: both legs are
   * written in one transaction and therefore share a timestamp, which could not
   * order them.
   */
  findLegsOfGroup(combinationGroupId: string): Promise<RoutePricing[]> {
    return this.prisma.routePricing.findMany({
      where: { combinationGroupId },
      orderBy: { combinationLegPosition: "asc" },
    });
  }

  findGroupById(id: string): Promise<CombinationRouteGroup | null> {
    return this.prisma.combinationRouteGroup.findUnique({ where: { id } });
  }

  /**
   * The Combination configured for exactly these roads, or null.
   *
   * ── WHY THE GROUP AND NOT THE LEG ─────────────────────────────────────────
   * A road may be a leg of many Combinations: everything leaving MPET 1742
   * shares its outbound, and each of those is its own configuration with its own
   * return. So "is this already configured" is a question about the PAIR, which
   * only the group can answer — see `isSameCombination`.
   *
   * Narrowed in SQL by destination, decided in memory by the terminal rule, for
   * the same reason `findByRoute` is: `PSA Quay 869` and `Quay 869` are one
   * place, and SQL equality cannot say so. The candidate set is small by
   * construction — the Combinations that touch one of these two destinations.
   */
  async findGroupWithLegRoads(
    roads: readonly RoadEndpoints[],
    options: { excludeCombinationGroupId?: string } = {},
  ): Promise<CombinationRouteGroupWithLegs | null> {
    const candidates = await this.prisma.combinationRouteGroup.findMany({
      where: {
        ...(options.excludeCombinationGroupId
          ? { id: { not: options.excludeCombinationGroupId } }
          : {}),
        legs: { some: { destination: { in: roads.map((road) => road.destination) } } },
      },
      include: { legs: { orderBy: { combinationLegPosition: "asc" } } },
      // The oldest first, so the configuration an operator made first is the one
      // reported as the holder of the pair.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return (
      candidates.find((group) => isSameCombination(group.legs, roads)) ?? null
    );
  }

  /**
   * Every configured route on this road, rather than the first of them.
   *
   * Exists because a Combination leg's road is no longer unique across groups:
   * `findByRoute` answers with one row, and a caller that needs to know whether
   * the road is ambiguous cannot learn it from that answer. Same query, same
   * terminal rule, so the two can never disagree about what matches.
   */
  async findAllByRoute(
    departure: string,
    destination: string,
    options: FindRouteOptions,
  ): Promise<RoutePricing[]> {
    const candidates = await this.prisma.routePricing.findMany({
      where: {
        destination,
        combinationGroupId:
          options.kind === RouteConfigurationKind.COMBINATION
            ? { not: null }
            : null,
        ...(options.excludeRoutePricingId
          ? { id: { not: options.excludeRoutePricingId } }
          : {}),
      },
      orderBy: { id: "asc" },
    });

    return candidates.filter((candidate) =>
      isSameTerminal(candidate.departure, departure),
    );
  }

  /** Every Combination configuration with its legs, oldest first. */
  findGroups(): Promise<CombinationRouteGroupWithLegs[]> {
    return this.prisma.combinationRouteGroup.findMany({
      include: { legs: { orderBy: { combinationLegPosition: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  createGroup(
    overSt: CombinationOverStData = NO_OVER_ST,
    notes: string | null = null,
  ): Promise<CombinationRouteGroup> {
    return this.prisma.combinationRouteGroup.create({
      data: { notes, ...toOverStColumns(overSt) },
    });
  }

  /** Writes the Combination's Over ST — all three amounts together. */
  setGroupOverSt(
    id: string,
    overSt: CombinationOverStData,
  ): Promise<CombinationRouteGroup> {
    return this.prisma.combinationRouteGroup.update({
      where: { id },
      data: toOverStColumns(overSt),
    });
  }

  /** Records that somebody has been through this Combination's prices. */
  setGroupReviewed(
    id: string,
    reviewed: boolean,
  ): Promise<CombinationRouteGroup> {
    return this.prisma.combinationRouteGroup.update({
      where: { id },
      data: { reviewed },
    });
  }

  /**
   * Removes a Combination configuration and, through the cascade, both legs.
   *
   * One statement rather than three: the foreign key carries the rule, so there
   * is no window in which a group has one leg left.
   */
  deleteGroup(id: string): Promise<CombinationRouteGroup> {
    return this.prisma.combinationRouteGroup.delete({ where: { id } });
  }

  private buildWhere(
    filter: FindRoutePricingFilter,
  ): Prisma.RoutePricingWhereInput {
    const where: Prisma.RoutePricingWhereInput = {};

    if (filter.kind !== undefined) {
      where.combinationGroupId =
        filter.kind === RouteConfigurationKind.COMBINATION ? { not: null } : null;
    }

    if (filter.search) {
      const contains = { contains: filter.search, mode: "insensitive" } as const;

      where.OR = [
        { routeName: contains },
        { departure: contains },
        { destination: contains },
      ];
    }

    return where;
  }
}
