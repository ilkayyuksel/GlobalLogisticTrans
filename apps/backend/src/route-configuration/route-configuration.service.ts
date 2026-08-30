import { Injectable } from "@nestjs/common";

import { isSameTerminal } from "../common/terminal";
import { AppLoggerService } from "../logger/app-logger.service";
import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { RouteCostResponseDto } from "../route-costs/dto/route-cost-response.dto";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { RoutePricingResponseDto } from "../route-pricing/dto/route-pricing-response.dto";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  ChangeRouteConfigurationStateDto,
  RouteConfigurationDto,
  SaveRouteConfigurationDto,
} from "./dto/route-configuration.dto";
import {
  RouteConfigurationNotFoundException,
  UnknownPricingComponentException,
} from "./exceptions/route-configuration.exceptions";

/**
 * The route-dependent components this screen configures, by catalog code.
 *
 * Deliberately a fixed pair rather than "every route-priced component there is".
 * Toll and Tunnel are the two the business configures per route and the two the
 * Ritten columns show; a component added to the catalog later would need a
 * column of its own on the screen before it could be configured here, so
 * discovering it automatically would produce an amount nobody can see.
 */
const TOLL_CODE = "TOLL";
const TUNNEL_CODE = "TUNNEL";

/** Money leaves as exact decimal text, never as a JSON number. */
const ZERO_AMOUNT = (0).toFixed(MONEY_DECIMAL_PLACES);

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
    private readonly routeCosts: RouteCostService,
    /*
     * The repository for ONE read the service layer does not expose: turning a
     * component CODE into its id. The screen speaks in Toll and Tunnel and
     * never in identifiers, so the translation has to happen somewhere; doing
     * it here keeps a raw UUID out of the API and out of the browser.
     */
    private readonly routeCostRepository: RouteCostRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteConfigurationService.name);
  }

  /**
   * Every configured route, active and inactive.
   *
   * Unpaginated: this is configuration an operator reads as a whole, and the
   * set is bounded by how many routes the business runs. The underlying list
   * IS paginated, so the maximum page size is asked for explicitly rather than
   * relied upon by default.
   */
  async findAll(): Promise<RouteConfigurationDto[]> {
    const { items } = await this.routePricing.findAll({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    });

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
      routeName: this.toRouteName(dto),
      departure: dto.departure,
      destination: dto.destination,
      basePrice: dto.tarief,
    });

    await this.saveCosts(dto);

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

    const route = await this.routePricing.update(id, {
      routeName: this.toRouteName(dto),
      departure: dto.departure,
      destination: dto.destination,
      basePrice: dto.tarief,
    });

    const hasMoved =
      existing.departure !== dto.departure ||
      existing.destination !== dto.destination;

    if (hasMoved) {
      await this.deactivateCostsOf(existing.departure, existing.destination);
    }

    await this.saveCosts(dto);

    this.logger.log("Route configuration updated", {
      routePricingId: id,
      hasMoved,
    });

    return this.compose(await this.routePricing.findById(route.id));
  }

  /**
   * Activates or deactivates a whole configuration.
   *
   * The price and both costs move together. A route whose price is inactive but
   * whose toll is still active would charge a toll on a route the Engine prices
   * at zero — a state the operator never asked for and could not see on this
   * screen, which shows one switch.
   */
  async changeState(
    id: string,
    dto: ChangeRouteConfigurationStateDto,
  ): Promise<RouteConfigurationDto> {
    const existing = await this.requireConfiguration(id);

    const route = dto.isActive
      ? await this.routePricing.activate(id)
      : await this.routePricing.deactivate(id);

    if (dto.isActive) {
      await this.saveCosts({
        departure: existing.departure,
        destination: existing.destination,
        tarief: Number(existing.tarief),
        toll: Number(existing.toll),
        tunnel: Number(existing.tunnel),
      });
    } else {
      await this.deactivateCostsOf(existing.departure, existing.destination);
    }

    this.logger.log("Route configuration state changed", {
      routePricingId: id,
      isActive: dto.isActive,
    });

    return this.compose(route);
  }

  /**
   * Writes both route costs, creating or correcting whichever already exists.
   *
   * An amount of ZERO is stored as a real row rather than as no row. The two
   * price a Trip identically, but they say different things: an explicit zero
   * is "this route has no toll", and an absent row is "nobody has said". The
   * second is reported as a configuration gap when a Trip carries the property,
   * and an operator who typed 0 should not be nagged about it.
   */
  private async saveCosts(dto: SaveRouteConfigurationDto): Promise<void> {
    await this.saveCost(dto, TOLL_CODE, dto.toll);
    await this.saveCost(dto, TUNNEL_CODE, dto.tunnel);
  }

  private async saveCost(
    dto: SaveRouteConfigurationDto,
    code: string,
    amount: number,
  ): Promise<void> {
    const component = await this.requireComponent(code);
    const existing = await this.findCost(dto.departure, dto.destination, code);

    if (existing) {
      await this.routeCosts.update(existing.id, { amount });

      if (!existing.isActive) {
        await this.routeCosts.activate(existing.id);
      }

      return;
    }

    await this.routeCosts.create({
      departure: dto.departure,
      destination: dto.destination,
      pricingComponentId: component.id,
      amount,
    });
  }

  /** Leaves the rows in place; only the Engine stops reading them. */
  private async deactivateCostsOf(
    departure: string,
    destination: string,
  ): Promise<void> {
    for (const code of [TOLL_CODE, TUNNEL_CODE]) {
      const cost = await this.findCost(departure, destination, code);

      if (cost?.isActive) {
        await this.routeCosts.deactivate(cost.id);
      }
    }
  }

  /**
   * The route's cost for one component, active or not.
   *
   * Matched through the route-cost service's own active lookup first, which
   * applies the canonical terminal rule. An INACTIVE cost is invisible to that
   * lookup, so the paginated list is searched as well — otherwise reactivating
   * a route would create a second cost row beside the one already there.
   */
  private async findCost(
    departure: string,
    destination: string,
    code: string,
  ): Promise<RouteCostResponseDto | null> {
    const active = await this.routeCosts.findActiveForRoute(
      departure,
      destination,
    );
    const activeMatch = active.find(
      (cost) => cost.pricingComponent.code === code,
    );

    if (activeMatch) {
      return activeMatch;
    }

    const { items } = await this.routeCosts.findAll({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      isActive: false,
    });

    return (
      items.find(
        (cost) =>
          cost.pricingComponent.code === code &&
          cost.destination === destination &&
          isSameRouteEnd(cost.departure, departure),
      ) ?? null
    );
  }

  /** The two amounts a route carries, read back onto its price record. */
  private async compose(
    route: RoutePricingResponseDto,
  ): Promise<RouteConfigurationDto> {
    const toll = await this.findCost(
      route.departure,
      route.destination,
      TOLL_CODE,
    );
    const tunnel = await this.findCost(
      route.departure,
      route.destination,
      TUNNEL_CODE,
    );

    return {
      id: route.id,
      departure: route.departure,
      destination: route.destination,
      tarief: route.basePrice,
      toll: toll?.amount ?? ZERO_AMOUNT,
      tunnel: tunnel?.amount ?? ZERO_AMOUNT,
      hasToll: toll !== null,
      hasTunnel: tunnel !== null,
      isActive: route.isActive,
    };
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

  private async requireComponent(code: string) {
    const component =
      await this.routeCostRepository.findPricingComponentByCode(code);

    if (!component) {
      throw new UnknownPricingComponentException(code);
    }

    return component;
  }

  /**
   * The name the underlying price record carries.
   *
   * RoutePricing requires one, and this screen does not ask for it: an operator
   * configuring a route has already said what it is by naming both ends, and a
   * second free-text field would be a name that could disagree with them.
   */
  private toRouteName(dto: {
    departure: string;
    destination: string;
  }): string {
    return `${dto.departure} - ${dto.destination}`;
  }
}

/**
 * Whether two route ends are the same place.
 *
 * The canonical terminal rule, applied through the same helper the repositories
 * use, so a cost recorded against "PSA Quay 869" is found for a route typed as
 * "Quay 869". Kept as a function rather than inlined because it is the one rule
 * this service applies itself, and it should be visible.
 */
function isSameRouteEnd(left: string, right: string): boolean {
  return isSameTerminal(left, right);
}
