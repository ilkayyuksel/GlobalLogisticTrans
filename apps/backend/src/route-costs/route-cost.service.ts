import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { CreateRouteCostDto } from "./dto/create-route-cost.dto";
import { ListRouteCostsQueryDto } from "./dto/list-route-costs-query.dto";
import {
  PaginatedRouteCostsDto,
  RouteCostResponseDto,
  toRouteCostResponse,
} from "./dto/route-cost-response.dto";
import { UpdateRouteCostDto } from "./dto/update-route-cost.dto";
import {
  ComponentNotRoutePricedException,
  DuplicateRouteCostException,
  RouteCostNotFoundException,
  UnknownPricingComponentException,
} from "./exceptions/route-cost.exceptions";
import {
  PricingComponentSummary,
  RouteCostRepository,
  RouteCostWithComponent,
} from "./route-cost.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Stores what a route-dependent pricing component costs on one route.
 *
 * It never calculates a price and never decides whether a component applies to
 * a Trip: applicability comes from trip_custom_property, and the arithmetic
 * belongs to the Pricing Engine, which reads these records.
 *
 * Deactivated records are retained rather than deleted, so a historical Trip's
 * frozen pricing stays explainable.
 */
@Injectable()
export class RouteCostService {
  constructor(
    private readonly repository: RouteCostRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteCostService.name);
  }

  async findAll(
    query: ListRouteCostsQueryDto,
  ): Promise<PaginatedRouteCostsDto> {
    const { items, totalItems } = await this.repository.findPage({
      isActive: query.isActive,
      pricingComponentId: query.pricingComponentId,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toRouteCostResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<RouteCostResponseDto> {
    return toRouteCostResponse(await this.requireRouteCost(id));
  }

  /**
   * Every active cost configured for one route.
   *
   * Exposes the exact lookup the Pricing Engine needs: it prices a Trip against
   * one route and must see all of that route's costs at once. The paginated
   * search matches partial text and would be the wrong tool.
   *
   * An empty list rather than an error when nothing is configured — whether a
   * missing cost matters depends on which components the Trip actually carries,
   * and that decision belongs to the caller.
   */
  async findActiveForRoute(
    departure: string,
    destination: string,
  ): Promise<RouteCostResponseDto[]> {
    const routeCosts = await this.repository.findActiveByRoute(
      departure,
      destination,
    );

    return routeCosts.map(toRouteCostResponse);
  }

  async create(dto: CreateRouteCostDto): Promise<RouteCostResponseDto> {
    const component = await this.requireRoutePricedComponent(
      dto.pricingComponentId,
    );

    // New records are always active, so any existing active record for the same
    // route and component is a conflict.
    await this.assertRouteAvailable(dto.departure, dto.destination, component);

    const created = await this.runGuardingUniqueness(
      dto.departure,
      dto.destination,
      component,
      () =>
        this.repository.create({
          departure: dto.departure,
          destination: dto.destination,
          pricingComponentId: dto.pricingComponentId,
          amount: dto.amount,
          notes: dto.notes ?? null,
        }),
    );

    // The amount is never logged: it is commercial configuration.
    this.logger.log("Route cost created", {
      routeCostId: created.id,
      pricingComponentId: created.pricingComponentId,
    });

    return toRouteCostResponse(created);
  }

  async update(
    id: string,
    dto: UpdateRouteCostDto,
  ): Promise<RouteCostResponseDto> {
    const existing = await this.requireRouteCost(id);

    // The checks read the values the row will HOLD after the update, not the
    // ones the request happens to mention.
    const departure = dto.departure ?? existing.departure;
    const destination = dto.destination ?? existing.destination;
    const componentId = dto.pricingComponentId ?? existing.pricingComponentId;

    // Only re-validate a component that actually moves. Re-checking an unchanged
    // one would let an unrelated edit fail because the component's linked custom
    // property was removed long after this record was configured.
    const component =
      componentId === existing.pricingComponentId
        ? existing.pricingComponent
        : await this.requireRoutePricedComponent(componentId);

    const identityChanged =
      departure !== existing.departure ||
      destination !== existing.destination ||
      componentId !== existing.pricingComponentId;

    // Only while the record is active — an inactive row cannot collide with the
    // active-only index.
    if (identityChanged && existing.isActive) {
      await this.assertRouteAvailable(departure, destination, component, id);
    }

    const updated = await this.runGuardingUniqueness(
      departure,
      destination,
      component,
      () => this.repository.update(id, this.toUpdateData(dto)),
    );

    this.logger.log("Route cost updated", {
      routeCostId: id,
      changedFields: changedFieldNames(dto),
    });

    return toRouteCostResponse(updated);
  }

  /**
   * Reactivating can resurrect a clash: the record kept its route and component
   * while inactive, but another record may have taken them in the meantime.
   */
  async activate(id: string): Promise<RouteCostResponseDto> {
    const routeCost = await this.requireRouteCost(id);

    if (routeCost.isActive) {
      return toRouteCostResponse(routeCost);
    }

    await this.assertRouteAvailable(
      routeCost.departure,
      routeCost.destination,
      routeCost.pricingComponent,
      id,
    );

    const activated = await this.runGuardingUniqueness(
      routeCost.departure,
      routeCost.destination,
      routeCost.pricingComponent,
      () => this.repository.setActive(id, true),
    );

    this.logger.log("Route cost activated", { routeCostId: id });

    return toRouteCostResponse(activated);
  }

  /**
   * Soft delete, never blocked. Trip pricing items already written from this
   * record keep their frozen amounts, so withdrawing the configuration cannot
   * invalidate history — it only stops the record being used for new
   * calculations.
   */
  async deactivate(id: string): Promise<RouteCostResponseDto> {
    const routeCost = await this.requireRouteCost(id);

    if (!routeCost.isActive) {
      return toRouteCostResponse(routeCost);
    }

    const deactivated = await this.repository.setActive(id, false);

    this.logger.log("Route cost deactivated", { routeCostId: id });

    return toRouteCostResponse(deactivated);
  }

  private async requireRouteCost(id: string): Promise<RouteCostWithComponent> {
    const routeCost = await this.repository.findById(id);

    if (!routeCost) {
      throw new RouteCostNotFoundException(id);
    }

    return routeCost;
  }

  /**
   * Resolves the component and rejects one that cannot carry route costs.
   *
   * "Route-priced" is derived from the data rather than from a hardcoded list of
   * codes: a component is route-priced when a Custom Property links to it, which
   * is how the model expresses that its amount comes from this table
   * (database_model.md §4.12). Every other component — BASE_PRICE,
   * FUEL_SURCHARGE, COMBINATION, WAITING_TIME, CUSTOM_PROPERTY — resolves its
   * amount elsewhere, so a route cost for it would never be read.
   */
  private async requireRoutePricedComponent(
    pricingComponentId: string,
  ): Promise<PricingComponentSummary> {
    const component =
      await this.repository.findPricingComponent(pricingComponentId);

    if (!component) {
      throw new UnknownPricingComponentException(pricingComponentId);
    }

    if (!(await this.repository.isRoutePricedComponent(pricingComponentId))) {
      this.logger.warn("Rejected a route cost for a non route-priced component", {
        pricingComponentId,
      });

      throw new ComponentNotRoutePricedException(component.code);
    }

    return component;
  }

  private async assertRouteAvailable(
    departure: string,
    destination: string,
    component: PricingComponentSummary,
    excludeRouteCostId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByRouteAndComponent(
      departure,
      destination,
      component.id,
      excludeRouteCostId,
    );

    if (holder) {
      this.logger.warn("Rejected duplicate active route cost", {
        routeCostId: excludeRouteCostId,
        conflictingRouteCostId: holder.id,
        pricingComponentId: component.id,
      });

      throw new DuplicateRouteCostException(
        departure,
        destination,
        component.code,
      );
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The partial unique index is the real guard, so its violation is
   * translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingUniqueness<TResult>(
    departure: string,
    destination: string,
    component: PricingComponentSummary,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DuplicateRouteCostException(
          departure,
          destination,
          component.code,
        );
      }

      throw error;
    }
  }

  /**
   * Passes the DTO through unchanged: Prisma treats `undefined` as "leave
   * alone" and `null` as "set to null", which is exactly PATCH semantics.
   */
  private toUpdateData(
    dto: UpdateRouteCostDto,
  ): Prisma.RouteCostUncheckedUpdateInput {
    return {
      departure: dto.departure,
      destination: dto.destination,
      pricingComponentId: dto.pricingComponentId,
      amount: dto.amount,
      notes: dto.notes,
    };
  }
}
