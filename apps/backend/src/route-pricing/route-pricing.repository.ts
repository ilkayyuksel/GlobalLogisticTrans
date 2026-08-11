import { Injectable } from "@nestjs/common";
import { Prisma, RoutePricing } from "@prisma/client";

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
  findActiveByRoute(
    departure: string,
    destination: string,
    excludeRoutePricingId?: string,
  ): Promise<RoutePricing | null> {
    return this.prisma.routePricing.findFirst({
      where: {
        departure,
        destination,
        isActive: true,
        ...(excludeRoutePricingId
          ? { id: { not: excludeRoutePricingId } }
          : {}),
      },
    });
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
