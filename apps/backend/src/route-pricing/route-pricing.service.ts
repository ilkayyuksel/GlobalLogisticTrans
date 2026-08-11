import { Injectable } from "@nestjs/common";
import { Prisma, RoutePricing } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { CreateRoutePricingDto } from "./dto/create-route-pricing.dto";
import { ListRoutePricingQueryDto } from "./dto/list-route-pricing-query.dto";
import {
  PaginatedRoutePricingDto,
  RoutePricingResponseDto,
  toRoutePricingResponse,
} from "./dto/route-pricing-response.dto";
import { UpdateRoutePricingDto } from "./dto/update-route-pricing.dto";
import {
  DuplicateActiveRouteException,
  RoutePricingNotFoundException,
} from "./exceptions/route-pricing.exceptions";
import { RoutePricingRepository } from "./route-pricing.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Stores route pricing configuration. It never calculates a price — the future
 * Pricing Engine reads these records and does the arithmetic.
 *
 * Deactivated records are retained rather than deleted, so a historical Trip's
 * pricing stays reproducible even after the configuration changes.
 */
@Injectable()
export class RoutePricingService {
  constructor(
    private readonly repository: RoutePricingRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RoutePricingService.name);
  }

  async findAll(
    query: ListRoutePricingQueryDto,
  ): Promise<PaginatedRoutePricingDto> {
    const { items, totalItems } = await this.repository.findPage({
      isActive: query.isActive,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toRoutePricingResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<RoutePricingResponseDto> {
    return toRoutePricingResponse(await this.requireRoutePricing(id));
  }

  /**
   * The active record configured for a route, or null when none is.
   *
   * Exposes the exact lookup the duplicate check already performs, because the
   * Pricing Engine has to select a route deterministically and the paginated
   * search matches partial text. Null rather than a 404: whether an unconfigured
   * route is an error depends on the caller's pricing strategy, so that decision
   * stays with the caller.
   */
  async findActiveRoute(
    departure: string,
    destination: string,
  ): Promise<RoutePricingResponseDto | null> {
    const routePricing = await this.repository.findActiveByRoute(
      departure,
      destination,
    );

    return routePricing ? toRoutePricingResponse(routePricing) : null;
  }

  async create(dto: CreateRoutePricingDto): Promise<RoutePricingResponseDto> {
    // New records are always active, so any existing active record for the same
    // route is a conflict.
    await this.assertRouteAvailable(dto.departure, dto.destination);

    const created = await this.runGuardingRoute(
      dto.departure,
      dto.destination,
      () =>
        this.repository.create({
          routeName: dto.routeName,
          departure: dto.departure,
          destination: dto.destination,
          basePrice: dto.basePrice,
          notes: dto.notes ?? null,
        }),
    );

    // The price itself is never logged: it is commercial configuration.
    this.logger.log("Route pricing created", { routePricingId: created.id });

    return toRoutePricingResponse(created);
  }

  async update(
    id: string,
    dto: UpdateRoutePricingDto,
  ): Promise<RoutePricingResponseDto> {
    const existing = await this.requireRoutePricing(id);

    const departure = dto.departure ?? existing.departure;
    const destination = dto.destination ?? existing.destination;
    const routeChanged =
      departure !== existing.departure || destination !== existing.destination;

    // Only re-check when the route actually moves, and only while the record is
    // active — an inactive record cannot collide with the active-only index.
    if (routeChanged && existing.isActive) {
      await this.assertRouteAvailable(departure, destination, id);
    }

    const updated = await this.runGuardingRoute(departure, destination, () =>
      this.repository.update(id, this.toUpdateData(dto)),
    );

    this.logger.log("Route pricing updated", {
      routePricingId: id,
      changedFields: changedFieldNames(dto),
    });

    return toRoutePricingResponse(updated);
  }

  /**
   * Reactivating can resurrect a clash: the record kept its route while
   * inactive, but another record may have taken it in the meantime.
   */
  async activate(id: string): Promise<RoutePricingResponseDto> {
    const routePricing = await this.requireRoutePricing(id);

    if (routePricing.isActive) {
      return toRoutePricingResponse(routePricing);
    }

    await this.assertRouteAvailable(
      routePricing.departure,
      routePricing.destination,
      id,
    );

    const activated = await this.runGuardingRoute(
      routePricing.departure,
      routePricing.destination,
      () => this.repository.setActive(id, true),
    );

    this.logger.log("Route pricing activated", { routePricingId: id });

    return toRoutePricingResponse(activated);
  }

  /**
   * Soft delete. The record is never removed, so pricing already calculated
   * from it remains explainable.
   */
  async deactivate(id: string): Promise<RoutePricingResponseDto> {
    const routePricing = await this.requireRoutePricing(id);

    if (!routePricing.isActive) {
      return toRoutePricingResponse(routePricing);
    }

    const deactivated = await this.repository.setActive(id, false);

    this.logger.log("Route pricing deactivated", { routePricingId: id });

    return toRoutePricingResponse(deactivated);
  }

  private async requireRoutePricing(id: string): Promise<RoutePricing> {
    const routePricing = await this.repository.findById(id);

    if (!routePricing) {
      throw new RoutePricingNotFoundException(id);
    }

    return routePricing;
  }

  private async assertRouteAvailable(
    departure: string,
    destination: string,
    excludeRoutePricingId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByRoute(
      departure,
      destination,
      excludeRoutePricingId,
    );

    if (holder) {
      this.logger.warn("Rejected duplicate active route", {
        routePricingId: excludeRoutePricingId,
        conflictingRoutePricingId: holder.id,
      });

      throw new DuplicateActiveRouteException(departure, destination);
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The partial unique index is the real guard, so its violation is
   * translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingRoute<TResult>(
    departure: string,
    destination: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DuplicateActiveRouteException(departure, destination);
      }

      throw error;
    }
  }

  /**
   * Passes the DTO through unchanged: Prisma treats `undefined` as "leave
   * alone" and `null` as "set to null", which is exactly PATCH semantics.
   */
  private toUpdateData(
    dto: UpdateRoutePricingDto,
  ): Prisma.RoutePricingUncheckedUpdateInput {
    return {
      routeName: dto.routeName,
      departure: dto.departure,
      destination: dto.destination,
      basePrice: dto.basePrice,
      notes: dto.notes,
    };
  }
}
