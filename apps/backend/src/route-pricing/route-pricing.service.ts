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
  CombinationLegNotSeparatelyRemovableException,
  DuplicateActiveRouteException,
  RoutePricingNotFoundException,
} from "./exceptions/route-pricing.exceptions";
import {
  RouteConfigurationKind,
  RoutePricingRepository,
} from "./route-pricing.repository";

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

  /**
   * A page of configured routes.
   *
   * `kind` narrows the page to ordinary routes or to Combination legs. Omitted,
   * it returns both — which is what the REST endpoint does, because a
   * configuration list that hid half its rows would be misleading.
   */
  async findAll(
    query: ListRoutePricingQueryDto,
    kind?: RouteConfigurationKind,
  ): Promise<PaginatedRoutePricingDto> {
    const { items, totalItems } = await this.repository.findPage({
      search: query.search,
      kind,
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
   * The record configured for a route, or null when none is.
   *
   * Exposes the exact lookup the duplicate check already performs, because the
   * Pricing Engine has to select a route deterministically and the paginated
   * search matches partial text. Null rather than a 404: whether an unconfigured
   * route is an error depends on the caller's pricing strategy, so that decision
   * stays with the caller.
   */
  async findConfiguredRoute(
    departure: string,
    destination: string,
    kind: RouteConfigurationKind = RouteConfigurationKind.NORMAL,
  ): Promise<RoutePricingResponseDto | null> {
    const routePricing = await this.repository.findByRoute(
      departure,
      destination,
      { kind },
    );

    return routePricing ? toRoutePricingResponse(routePricing) : null;
  }

  async create(dto: CreateRoutePricingDto): Promise<RoutePricingResponseDto> {
    // One ORDINARY configuration per route: an existing record for the same
    // route is a conflict, and there is no longer a dormant state one could hide
    // in. A Combination leg on the same road is not a conflict — the two are
    // read in different pricing contexts and never overwrite each other.
    await this.assertRouteAvailable(
      dto.departure,
      dto.destination,
      RouteConfigurationKind.NORMAL,
    );

    const created = await this.runGuardingRoute(
      dto.departure,
      dto.destination,
      () =>
        this.repository.create({
          routeName: dto.routeName,
          departure: dto.departure,
          destination: dto.destination,
          basePrice: dto.basePrice,
          kilometres: dto.kilometres ?? null,
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

    // Only re-check when the route actually moves: a record never collides
    // with itself.
    if (routeChanged) {
      await this.assertRouteAvailable(
        departure,
        destination,
        existing.combinationGroupId === null
          ? RouteConfigurationKind.NORMAL
          : RouteConfigurationKind.COMBINATION,
        id,
      );
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
   * Removes a route's configuration.
   *
   * ── WHY THIS REPLACED DEACTIVATION ────────────────────────────────────────
   * A route used to be switched off and kept, so that pricing calculated from
   * it stayed explainable. It stays explainable either way: a TripPricing
   * snapshot holds the amounts it was priced with and reads no configuration
   * ever again. What the kept row really produced was a second state on a
   * screen that had no use for one, and a route that looked configured while
   * charging nothing.
   *
   * So the row goes. A Trip priced yesterday keeps its price; a Trip priced
   * tomorrow finds no configuration for this route, which is exactly what
   * deleting it means.
   */
  async remove(id: string): Promise<RoutePricingResponseDto> {
    const existing = await this.requireRoutePricing(id);

    /*
     * A Combination is two legs or it is nothing. Removing one would leave a
     * configuration that prices the outbound and silently charges nothing for
     * the return, so the whole group goes through
     * CombinationRoutePricingService or none of it does.
     */
    if (existing.combinationGroupId !== null) {
      throw new CombinationLegNotSeparatelyRemovableException(
        id,
        existing.combinationGroupId,
      );
    }

    const removed = await this.repository.delete(id);

    this.logger.log("Route pricing deleted", { routePricingId: id });

    return toRoutePricingResponse(removed);
  }

  /**
   * Records that somebody has been through this route's prices.
   *
   * Administrative bookkeeping: it changes no amount, no route and nothing the
   * Pricing Engine reads. Idempotent, so marking a route that is already marked
   * is not an error.
   */
  async setReviewed(
    id: string,
    reviewed: boolean,
  ): Promise<RoutePricingResponseDto> {
    await this.requireRoutePricing(id);

    const updated = await this.repository.update(id, { reviewed });

    this.logger.log("Route pricing review mark changed", {
      routePricingId: id,
      reviewed,
    });

    return toRoutePricingResponse(updated);
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
    kind: RouteConfigurationKind,
    excludeRoutePricingId?: string,
  ): Promise<void> {
    const holder = await this.repository.findByRoute(departure, destination, {
      kind,
      excludeRoutePricingId,
    });

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
      /*
       * The route's length, which the Toll is derived from. It reached the
       * service and was dropped here, so an edited distance was accepted and
       * never stored.
       */
      kilometres: dto.kilometres,
      notes: dto.notes,
    };
  }
}
