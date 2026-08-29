import { Injectable } from "@nestjs/common";
import { Prisma, RoutePricing } from "@prisma/client";

import { isSameTerminal } from "../common/terminal";
import { PrismaService } from "../prisma/prisma.service";

export interface FindRoutePricingFilter {
  isActive?: boolean;
  search?: string;
  skip: number;
  take: number;
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
 * policy, activation rules and error translation belong to
 * RoutePricingService, and price calculation belongs to the future Pricing
 * Engine. There is no delete method, because records are never removed.
 */
@Injectable()
export class RoutePricingRepository {
  constructor(private readonly prisma: PrismaService) {}

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
   * Finds the active record for a route.
   *
   * `excludeRoutePricingId` lets an update ignore the row being edited, so
   * saving a record without changing its route never conflicts with itself.
   */
  /**
   * The active route configured between two places.
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
  async findActiveByRoute(
    departure: string,
    destination: string,
    excludeRoutePricingId?: string,
  ): Promise<RoutePricing | null> {
    const candidates = await this.prisma.routePricing.findMany({
      where: {
        destination,
        isActive: true,
        ...(excludeRoutePricingId
          ? { id: { not: excludeRoutePricingId } }
          : {}),
      },
      // Ordered so a caller gets the same answer every time. The partial unique
      // index makes more than one active row per exact route impossible, but
      // two SPELLINGS of one terminal are not excluded by it.
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

  setActive(id: string, isActive: boolean): Promise<RoutePricing> {
    return this.prisma.routePricing.update({
      where: { id },
      data: { isActive },
    });
  }

  private buildWhere(
    filter: FindRoutePricingFilter,
  ): Prisma.RoutePricingWhereInput {
    const where: Prisma.RoutePricingWhereInput = {};

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
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
