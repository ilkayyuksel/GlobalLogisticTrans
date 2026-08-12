import { Injectable } from "@nestjs/common";
import { Prisma, RouteCost } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindRouteCostsFilter {
  isActive?: boolean;
  pricingComponentId?: string;
  search?: string;
  skip: number;
  take: number;
}

export interface RouteCostPage {
  items: RouteCostWithComponent[];
  totalItems: number;
}

export type CreateRouteCostData = Prisma.RouteCostUncheckedCreateInput;
export type UpdateRouteCostData = Prisma.RouteCostUncheckedUpdateInput;

/** Identity of the component, without its lifecycle or presentation fields. */
export interface PricingComponentSummary {
  id: string;
  code: string;
  name: string;
}

export type RouteCostWithComponent = RouteCost & {
  pricingComponent: PricingComponentSummary;
};

/**
 * Every read returns the component alongside the cost.
 *
 * A route cost is meaningless without knowing which component it prices, and
 * there is no endpoint yet that resolves a component id, so returning the bare
 * foreign key would leave the response unusable. The join is a single indexed
 * lookup, so this is not an N+1.
 */
const WITH_COMPONENT = {
  pricingComponent: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RouteCostInclude;

/**
 * Database access for the RouteCost domain.
 *
 * Contains no business rules and performs no arithmetic: which components may
 * be route-priced, duplicate-route policy and error translation belong to
 * RouteCostService, and reading these amounts into a price belongs to the
 * Pricing Engine. There is no delete method, because records are never removed.
 */
@Injectable()
export class RouteCostRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindRouteCostsFilter): Promise<RouteCostPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.routeCost.findMany({
        where,
        include: WITH_COMPONENT,
        orderBy: [{ departure: "asc" }, { destination: "asc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.routeCost.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<RouteCostWithComponent | null> {
    return this.prisma.routeCost.findUnique({
      where: { id },
      include: WITH_COMPONENT,
    });
  }

  /**
   * The active cost configured for one route and component.
   *
   * Mirrors the partial unique index on
   * (departure, destination, pricing_component_id) WHERE is_active.
   *
   * `excludeRouteCostId` lets an update ignore the row being edited, so saving a
   * record without moving it never conflicts with itself.
   */
  findActiveByRouteAndComponent(
    departure: string,
    destination: string,
    pricingComponentId: string,
    excludeRouteCostId?: string,
  ): Promise<RouteCost | null> {
    return this.prisma.routeCost.findFirst({
      where: {
        departure,
        destination,
        pricingComponentId,
        isActive: true,
        ...(excludeRouteCostId ? { id: { not: excludeRouteCostId } } : {}),
      },
    });
  }

  /**
   * Every active cost configured for one route, across all components.
   *
   * Ordered by the component's display order so a breakdown built from this list
   * comes out in the documented pricing sequence.
   */
  findActiveByRoute(
    departure: string,
    destination: string,
  ): Promise<RouteCostWithComponent[]> {
    return this.prisma.routeCost.findMany({
      where: { departure, destination, isActive: true },
      include: WITH_COMPONENT,
      orderBy: [{ pricingComponent: { displayOrder: "asc" } }, { id: "asc" }],
    });
  }

  /**
   * The referenced PricingComponent, or null when it does not exist.
   *
   * Read-only and deliberately narrow, following the precedent set by
   * CustomPropertyRepository: the pricing-configuration domain has no module
   * yet, and inventing one for a single lookup would be an abstraction built for
   * a later phase. The foreign key remains the real guard.
   */
  findPricingComponent(
    pricingComponentId: string,
  ): Promise<PricingComponentSummary | null> {
    return this.prisma.pricingComponent.findUnique({
      where: { id: pricingComponentId },
      select: { id: true, code: true, name: true },
    });
  }

  /**
   * True when any Custom Property links to this component.
   *
   * That link is how the model expresses "this component applies per Trip and is
   * priced per route" (database_model.md §4.12), so it is also the answer to
   * whether the component may carry route costs at all.
   *
   * Inactive properties count. Whether a component is route-priced is a property
   * of the component's nature, not of one property's lifecycle — deactivating
   * the Toll property must not retroactively invalidate Toll route costs.
   */
  async isRoutePricedComponent(pricingComponentId: string): Promise<boolean> {
    const linkedProperty = await this.prisma.customProperty.findFirst({
      where: { pricingComponentId },
      select: { id: true },
    });

    return linkedProperty !== null;
  }

  create(data: CreateRouteCostData): Promise<RouteCostWithComponent> {
    return this.prisma.routeCost.create({ data, include: WITH_COMPONENT });
  }

  update(
    id: string,
    data: UpdateRouteCostData,
  ): Promise<RouteCostWithComponent> {
    return this.prisma.routeCost.update({
      where: { id },
      data,
      include: WITH_COMPONENT,
    });
  }

  setActive(id: string, isActive: boolean): Promise<RouteCostWithComponent> {
    return this.prisma.routeCost.update({
      where: { id },
      data: { isActive },
      include: WITH_COMPONENT,
    });
  }

  private buildWhere(filter: FindRouteCostsFilter): Prisma.RouteCostWhereInput {
    const where: Prisma.RouteCostWhereInput = {};

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.pricingComponentId !== undefined) {
      where.pricingComponentId = filter.pricingComponentId;
    }

    if (filter.search) {
      const contains = { contains: filter.search, mode: "insensitive" } as const;

      where.OR = [{ departure: contains }, { destination: contains }];
    }

    return where;
  }
}
