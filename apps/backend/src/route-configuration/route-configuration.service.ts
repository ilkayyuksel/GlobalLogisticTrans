import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import { RoutePricingResponseDto } from "../route-pricing/dto/route-pricing-response.dto";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  RouteConfigurationDto,
  SaveRouteConfigurationDto,
  composeRouteConfiguration,
  routeNameOf,
} from "./dto/route-configuration.dto";
import {
  CombinationLegNotSeparatelyEditableException,
  CombinationLegNotSeparatelyRemovableException,
} from "../route-pricing/exceptions/route-pricing.exceptions";
import { RouteConfigurationNotFoundException } from "./exceptions/route-configuration.exceptions";
import {
  RouteComponentCostService,
  RouteCostOwner,
  TOLL_CODE,
  TUNNEL_CODE,
} from "./route-component-cost.service";

/**
 * The route-dependent components this screen configures, by catalog code.
 *
 * Named here and asserted by one binding test: a route cost may only exist for a
 * component some Custom Property links to, and the pricing bootstrap is what
 * provisions those properties. Adding a second column to this screen without a
 * matching entry in that catalog would make saving a route fail with "is not
 * route-priced", so `pricing-component.catalog.spec.ts` asserts the two lists
 * agree.
 */
export const ROUTE_CONFIGURED_COMPONENT_CODES = [TOLL_CODE, TUNNEL_CODE] as const;

/**
 * One route, as an operator configures it — composed from the tables that
 * actually store it.
 *
 * ── WHAT THIS SERVICE IS ────────────────────────────────────────────────────
 * An application-layer abstraction, and nothing more. It owns no table, adds no
 * column and duplicates no rule. Every write goes through RoutePricingService
 * or RouteCostService, so the duplicate-route check, the canonical terminal
 * matching, the active-only unique index and the component validation all keep
 * working exactly as they already did — this service could not bypass them if
 * it tried, because it never touches Prisma.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * A route's price lives in `route_pricing` and each of its route-dependent
 * costs in `route_cost`. That split serves the Engine well and serves a person
 * badly: configuring "Quay 869 to Dourges" would mean creating and keeping in
 * step three records, and forgetting one of them is a half-configured route
 * that prices a Trip wrongly without ever looking wrong.
 *
 * So the operator sees ONE record with three amounts, and the composition
 * happens here.
 *
 * ── THE SPINE IS THE PRICE ──────────────────────────────────────────────────
 * A configuration IS a RoutePricing record; the costs hang off it, found by the
 * route rather than by a foreign key — which is how `route_cost` is already
 * keyed, and why no schema change is needed. A route with costs but no price
 * would not appear here; the live data has none, and creating the route through
 * this screen ADOPTS any costs already recorded for it rather than duplicating
 * them.
 *
 * ── AND IT CHANGES NO HISTORY ───────────────────────────────────────────────
 * Nothing here touches a Trip, a snapshot or a pricing line. Configuration is
 * read when a Trip is priced; a Trip already priced keeps the amounts it was
 * priced with. Changing a route affects the NEXT calculation — a Trip closing
 * afterwards, or an explicit reprocess — and never a historical one.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class RouteConfigurationService {
  constructor(
    private readonly routePricing: RoutePricingService,
    private readonly routeCosts: RouteComponentCostService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteConfigurationService.name);
  }

  /**
   * Every ORDINARY configured route.
   *
   * Combination legs are deliberately absent. A leg listed on its own would look
   * like a route an operator could edit or delete by itself, and it is neither:
   * it exists only as half of a pair. Combinations are read whole, through
   * CombinationRouteConfigurationService.
   *
   * Unpaginated: this is configuration an operator reads as a whole, and the
   * set is bounded by how many routes the business runs. The underlying list
   * IS paginated, so the maximum page size is asked for explicitly rather than
   * relied upon by default.
   */
  async findAll(): Promise<RouteConfigurationDto[]> {
    const { items } = await this.routePricing.findAll(
      {
        page: 1,
        pageSize: MAX_PAGE_SIZE,
      },
      RouteConfigurationKind.NORMAL,
    );

    return Promise.all(items.map((route) => this.compose(route)));
  }

  async findById(id: string): Promise<RouteConfigurationDto> {
    return this.compose(await this.routePricing.findById(id));
  }

  /**
   * Configures a route that has none.
   *
   * The price is created first: it is the record that identifies the
   * configuration, and its own duplicate check is what refuses a second active
   * configuration of the same canonical route. Only once it exists are the
   * costs written, so a refused route leaves nothing behind.
   */
  async create(dto: SaveRouteConfigurationDto): Promise<RouteConfigurationDto> {
    const route = await this.routePricing.create({
      routeName: routeNameOf(dto),
      departure: dto.departure,
      destination: dto.destination,
      basePrice: dto.tarief,
    });

    await this.saveCosts(this.ownerOf(dto), dto);

    this.logger.log("Route configuration created", { routePricingId: route.id });

    return this.compose(await this.routePricing.findById(route.id));
  }

  /**
   * Changes what a route costs, or where it runs.
   *
   * Moving the route moves its costs with it: the costs are keyed by departure
   * and destination, so leaving them behind would strand them on a route that
   * no longer exists and quietly stop charging them. The OLD costs are
   * deactivated and the new amounts written against the new route.
   */
  async update(
    id: string,
    dto: SaveRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    const existing = await this.requireConfiguration(id);

    this.assertOrdinaryRoute(existing, "EDIT");

    const route = await this.routePricing.update(id, {
      routeName: routeNameOf(dto),
      departure: dto.departure,
      destination: dto.destination,
      basePrice: dto.tarief,
    });

    const hasMoved =
      existing.departure !== dto.departure ||
      existing.destination !== dto.destination;

    if (hasMoved) {
      await this.routeCosts.deactivate(this.ownerOf(existing));
    }

    await this.saveCosts(this.ownerOf(dto), dto);

    this.logger.log("Route configuration updated", {
      routePricingId: id,
      hasMoved,
    });

    return this.compose(await this.routePricing.findById(route.id));
  }

  /**
   * Removes a route's configuration entirely.
   *
   * ── WHAT GOES, AND WHAT STAYS ─────────────────────────────────────────────
   * The price record and the route's tunnel cost go together, for the reason
   * the two were always written together: a cost left behind is matched by
   * departure and destination and would keep charging Trips on a route nobody
   * has configured any more.
   *
   * Nothing priced changes. A TripPricing snapshot holds the amounts it was
   * priced with and never reads configuration again, so last month's invoices
   * are exactly as explainable as they were before.
   *
   * This replaced deactivation. A switched-off route was a second state the
   * screen had to explain and a configuration that looked present while
   * charging nothing.
   *
   * Answers with the configuration that was removed, which is the convention
   * every DELETE in this API follows — see the controller.
   */
  async remove(id: string): Promise<RouteConfigurationDto> {
    const existing = await this.requireConfiguration(id);

    /*
     * Checked BEFORE anything is written. A leg's tunnel belongs to the leg, so
     * treating it as a road here would switch off the ORDINARY route's tunnel on
     * its way to a refusal — the deletion would fail and still have changed
     * something it was never allowed to touch.
     */
    this.assertOrdinaryRoute(existing, "REMOVE");

    await this.routeCosts.deactivate(this.ownerOf(existing));
    await this.routePricing.remove(id);

    this.logger.log("Route configuration deleted", { routePricingId: id });

    return existing;
  }

  /**
   * Refuses to treat a Combination leg as an ordinary route.
   *
   * These endpoints identify a route by its road and write its tunnel against
   * that road. A leg is neither: it exists only as half of a pair, and its tunnel
   * is its own. Both legs are edited and removed together, through
   * CombinationRouteConfigurationService.
   */
  private assertOrdinaryRoute(
    route: RouteConfigurationDto,
    action: "EDIT" | "REMOVE",
  ): void {
    if (route.combinationGroupId === null) {
      return;
    }

    this.logger.warn("Rejected an ordinary route action on a Combination leg", {
      routePricingId: route.id,
      combinationGroupId: route.combinationGroupId,
      action,
    });

    throw action === "EDIT"
      ? new CombinationLegNotSeparatelyEditableException(
          route.id,
          route.combinationGroupId,
        )
      : new CombinationLegNotSeparatelyRemovableException(
          route.id,
          route.combinationGroupId,
        );
  }

  /**
   * Whose tunnel an ordinary route's is.
   *
   * The ROAD, as it always has been: an ordinary route's tunnel is a fact about
   * the road, and every existing row says so. Only a Combination leg owns its
   * tunnel, because the road it runs may be an ordinary route's as well.
   */
  /** The route's Toll and Tunnel — the two amounts it carries beside its Tarief. */
  private async saveCosts(
    owner: RouteCostOwner,
    dto: SaveRouteConfigurationDto,
  ): Promise<void> {
    await this.routeCosts.save(owner, TOLL_CODE, dto.toll);
    await this.routeCosts.save(owner, TUNNEL_CODE, dto.tunnel);
  }

  private ownerOf(route: { departure: string; destination: string }): RouteCostOwner {
    return {
      kind: "ROAD" as const,
      departure: route.departure,
      destination: route.destination,
    };
  }

  /** What a route carries, read back onto its price record. */
  private async compose(
    route: RoutePricingResponseDto,
  ): Promise<RouteConfigurationDto> {
    return composeRouteConfiguration(
      route,
      await this.routeCosts.findAll(this.ownerOf(route)),
      route.reviewed,
    );
  }

  /**
   * Records that somebody has been through this route's prices.
   *
   * ── BOOKKEEPING, AND ONLY THAT ────────────────────────────────────────────
   * It changes no amount, no route and nothing the Pricing Engine reads. It is
   * here rather than in the ordinary update because an administrator ticking a
   * box has not edited the route: sending the amounts back to mark one would
   * rewrite the tunnel cost and risk changing a price nobody meant to touch.
   */
  async setReviewed(
    id: string,
    reviewed: boolean,
  ): Promise<RouteConfigurationDto> {
    const existing = await this.requireConfiguration(id);

    this.assertOrdinaryRoute(existing, "EDIT");

    await this.routePricing.setReviewed(id, reviewed);

    this.logger.log("Route configuration review mark changed", {
      routePricingId: id,
      reviewed,
    });

    return this.findById(id);
  }

  private async requireConfiguration(
    id: string,
  ): Promise<RouteConfigurationDto> {
    try {
      return await this.findById(id);
    } catch {
      throw new RouteConfigurationNotFoundException(id);
    }
  }

}

