import { Injectable } from "@nestjs/common";

import { isSameTerminal } from "../common/terminal";
import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostResponseDto } from "../route-costs/dto/route-cost-response.dto";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { UnknownPricingComponentException } from "./exceptions/route-configuration.exceptions";

/**
 * The catalog codes of the route-dependent costs this screen configures.
 *
 * Both are a fixed AMOUNT for the route, stored as a RouteCost and read by the
 * Engine verbatim. The Toll was briefly derived from kilometres times one
 * global rate instead; it is an amount per route and per Combination leg again,
 * exactly like the Tunnel beside it.
 */
export const TUNNEL_CODE = "TUNNEL";
export const TOLL_CODE = "TOLL";

export type RouteComponentCode = typeof TUNNEL_CODE | typeof TOLL_CODE;

/** The amounts a configured route carries, by component. Null: none stated. */
export type RouteComponentCosts = Readonly<
  Record<RouteComponentCode, RouteCostResponseDto | null>
>;

/**
 * Whose cost a cost is.
 *
 * ── WHY A COST NEEDS AN OWNER AT ALL ────────────────────────────────────────
 * A route cost has always been matched by departure and destination, which
 * answered the question while one road had one configuration. A Combination
 * broke that: its outbound leg may run the very road an ordinary Trip also runs,
 * priced differently, so "the tunnel of Antwerp to Kallo" stopped being a single
 * answer.
 *
 * ROAD keeps the original meaning and the original rows — every ordinary route
 * is one. ROUTE means the cost belongs to that configured route alone, which is
 * what lets a Combination leg carry its own tunnel without reaching the ordinary
 * route's. The departure and destination travel with both, because the columns
 * that record the road are NOT NULL either way.
 */
export type RouteCostOwner =
  | { readonly kind: "ROAD"; readonly departure: string; readonly destination: string }
  | {
      readonly kind: "ROUTE";
      readonly routePricingId: string;
      readonly departure: string;
      readonly destination: string;
    };

/** The road a cost is recorded against, whichever kind of owner it has. */
export function roadOf(owner: RouteCostOwner): {
  departure: string;
  destination: string;
} {
  return { departure: owner.departure, destination: owner.destination };
}

/**
 * The Tunnel and Toll amounts a configured route carries, read and written in
 * one place.
 *
 * ── WHY THIS IS ITS OWN SERVICE ─────────────────────────────────────────────
 * Two screens configure a route now — the ordinary one and the Combination, each
 * of whose legs is a route in its own right — and both need exactly the same
 * three operations on exactly the same kind of record. Repeating them would have
 * meant two places that decide when such a cost is created, corrected or
 * stopped, and they would drift.
 *
 * It owns no table and adds no rule: every write goes through RouteCostService,
 * so the component validation, the duplicate check and the canonical terminal
 * matching all keep working exactly as they already did.
 *
 * Toll and Tunnel are the same kind of record — a fixed amount for a road or a
 * leg — so one service handles both, told which by its catalog code.
 */
@Injectable()
export class RouteComponentCostService {
  constructor(
    private readonly routeCosts: RouteCostService,
    /*
     * The repository for ONE read the service layer does not expose: turning a
     * component CODE into its id. The screen speaks in Tunnel and Toll, never in
     * identifiers, so the translation has to happen somewhere; doing it here
     * keeps a raw UUID out of the API and out of the browser.
     */
    private readonly routeCostRepository: RouteCostRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteComponentCostService.name);
  }

  /**
   * The owner's cost for one component, active or not.
   *
   * An INACTIVE cost is found too, because reactivating a route must correct the
   * row already there rather than create a second one beside it.
   */
  async find(
    owner: RouteCostOwner,
    code: RouteComponentCode,
  ): Promise<RouteCostResponseDto | null> {
    return (await this.findAll(owner))[code];
  }

  /**
   * The owner's Tunnel and Toll, from ONE active lookup.
   *
   * A screen shows both on every row, and two lookups per row would double the
   * queries of a page that already reads one per row. The inactive list is read
   * only for a component that has no active cost, as `find` always did.
   */
  async findAll(owner: RouteCostOwner): Promise<RouteComponentCosts> {
    const active = await this.activeCostsOf(owner);
    const activeOf = (code: RouteComponentCode) =>
      active.find((cost) => cost.pricingComponent.code === code) ?? null;

    return {
      [TUNNEL_CODE]: activeOf(TUNNEL_CODE) ?? (await this.findInactive(owner, TUNNEL_CODE)),
      [TOLL_CODE]: activeOf(TOLL_CODE) ?? (await this.findInactive(owner, TOLL_CODE)),
    };
  }

  /**
   * Writes the owner's cost for one component, creating or correcting whichever
   * row exists.
   *
   * An amount of ZERO is stored as a real row rather than as no row. The two
   * price a Trip identically but say different things: an explicit zero is "this
   * route has no tunnel", and an absent row is "nobody has said". The second is
   * reported as a configuration gap, and an operator who typed 0 should not be
   * nagged about it.
   */
  async save(
    owner: RouteCostOwner,
    code: RouteComponentCode,
    amount: number,
  ): Promise<void> {
    const component = await this.requireComponent(code);
    const existing = await this.find(owner, code);

    if (existing) {
      /*
       * The road travels with the amount. For a cost of the ROAD it is the road
       * that was just looked up and cannot differ; for one owned by a ROUTE the
       * leg may have moved, and the row records which road it is charged on.
       */
      await this.routeCosts.update(existing.id, { amount, ...roadOf(owner) });

      if (!existing.isActive) {
        await this.routeCosts.activate(existing.id);
      }

      return;
    }

    await this.routeCosts.create({
      ...roadOf(owner),
      pricingComponentId: component.id,
      amount,
      routePricingId: owner.kind === "ROUTE" ? owner.routePricingId : null,
    });
  }

  /**
   * Stops the owner's costs — Tunnel and Toll — from being charged.
   *
   * Used when a route MOVES or goes: a cost of the ROAD is matched by departure
   * and destination, so the one left at the old pair would go on charging Trips
   * that still drive it. The row stays; only the Engine stops reading it.
   */
  async deactivate(owner: RouteCostOwner): Promise<void> {
    for (const cost of Object.values(await this.findAll(owner))) {
      if (cost?.isActive) {
        await this.routeCosts.deactivate(cost.id);
      }
    }
  }

  private activeCostsOf(
    owner: RouteCostOwner,
  ): Promise<RouteCostResponseDto[]> {
    return owner.kind === "ROUTE"
      ? this.routeCosts.findActiveForRoutePricing(owner.routePricingId)
      : this.routeCosts.findActiveForRoute(owner.departure, owner.destination);
  }

  /**
   * The owner's deactivated cost for one component, if it has one.
   *
   * The active lookups above cannot see it, so the paginated list of inactive
   * costs is searched — a road is matched with the canonical terminal rule, a
   * route by its identity.
   */
  private async findInactive(
    owner: RouteCostOwner,
    code: RouteComponentCode,
  ): Promise<RouteCostResponseDto | null> {
    const { items } = await this.routeCosts.findAll({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      isActive: false,
    });

    return (
      items.find(
        (cost) =>
          cost.pricingComponent.code === code &&
          (owner.kind === "ROUTE"
            ? cost.routePricingId === owner.routePricingId
            : /*
               * Truthiness rather than a null check, so a cost that names no
               * owner reads as the road's. Mistaking one for a leg's would make
               * the route look unconfigured and write a second row beside it.
               */
              !cost.routePricingId &&
              cost.destination === owner.destination &&
              isSameTerminal(cost.departure, owner.departure)),
      ) ?? null
    );
  }

  private async requireComponent(code: RouteComponentCode) {
    const component =
      await this.routeCostRepository.findPricingComponentByCode(code);

    if (!component) {
      throw new UnknownPricingComponentException(code);
    }

    return component;
  }
}
