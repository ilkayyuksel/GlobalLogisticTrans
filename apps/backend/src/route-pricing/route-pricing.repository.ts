import { Injectable } from "@nestjs/common";
import { CombinationRouteGroup, Prisma, RoutePricing } from "@prisma/client";

import { isSameTerminal } from "../common/terminal";
import { PrismaService } from "../prisma/prisma.service";

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
    const candidates = await this.prisma.routePricing.findMany({
      where: {
        destination,
        /*
         * The kind is part of the identity of a configured route, not a filter
         * over one set: the two partial unique indexes make each kind unique on
         * its own, so scoping here is what lets a lookup return exactly one row.
         */
        combinationGroupId:
          options.kind === RouteConfigurationKind.COMBINATION
            ? { not: null }
            : null,
        ...(options.excludeRoutePricingId
          ? { id: { not: options.excludeRoutePricingId } }
          : {}),
      },
      // Ordered so a caller gets the same answer every time. The unique index
      // makes more than one row per exact route impossible, but two SPELLINGS
      // of one terminal are not excluded by it.
      orderBy: { id: "asc" },
    });

    return (
      candidates.find((candidate) =>
        isSameTerminal(candidate.departure, departure),
      ) ?? null
    );
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

  /** Every Combination configuration with its legs, oldest first. */
  findGroups(): Promise<CombinationRouteGroupWithLegs[]> {
    return this.prisma.combinationRouteGroup.findMany({
      include: { legs: { orderBy: { combinationLegPosition: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  createGroup(notes: string | null = null): Promise<CombinationRouteGroup> {
    return this.prisma.combinationRouteGroup.create({ data: { notes } });
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
