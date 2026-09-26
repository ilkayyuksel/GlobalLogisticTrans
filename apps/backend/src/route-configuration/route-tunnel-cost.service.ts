import { Injectable } from "@nestjs/common";

import { isSameTerminal } from "../common/terminal";
import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostResponseDto } from "../route-costs/dto/route-cost-response.dto";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { UnknownPricingComponentException } from "./exceptions/route-configuration.exceptions";

/**
 * The catalog code of the one route-dependent cost this screen configures.
 *
 * ── TOLL IS NO LONGER ONE OF THEM ───────────────────────────────────────────
 * A route used to carry a stored toll AMOUNT beside its tunnel. It now carries a
 * DISTANCE, and the toll a Trip pays is that distance times the rate configured
 * once for the whole business (PRICING.TOLL_RATE_PER_KM). So there is nothing
 * per route for the Engine to read as a toll cost, and nothing to write as one.
 *
 * Tunnel is untouched: it is a fixed amount for the road, not a rate.
 */
export const TUNNEL_CODE = "TUNNEL";

/**
 * Whose tunnel a cost is.
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
export type TunnelCostOwner =
  | { readonly kind: "ROAD"; readonly departure: string; readonly destination: string }
  | {
      readonly kind: "ROUTE";
      readonly routePricingId: string;
      readonly departure: string;
      readonly destination: string;
    };

/** The road a cost is recorded against, whichever kind of owner it has. */
export function roadOf(owner: TunnelCostOwner): {
  departure: string;
  destination: string;
} {
  return { departure: owner.departure, destination: owner.destination };
}

/**
 * The tunnel amount a configured route carries, read and written in one place.
 *
 * ── WHY THIS IS ITS OWN SERVICE ─────────────────────────────────────────────
 * Two screens configure a route now — the ordinary one and the Combination, each
 * of whose legs is a route in its own right — and both need exactly the same
 * three operations on exactly the same kind of record. Repeating them would have
 * meant two places that decide when a tunnel cost is created, corrected or
 * stopped, and they would drift.
 *
 * It owns no table and adds no rule: every write goes through RouteCostService,
 * so the component validation, the duplicate check and the canonical terminal
 * matching all keep working exactly as they already did.
 */
@Injectable()
export class RouteTunnelCostService {
  constructor(
    private readonly routeCosts: RouteCostService,
    /*
     * The repository for ONE read the service layer does not expose: turning a
     * component CODE into its id. The screen speaks in Tunnel and never in
     * identifiers, so the translation has to happen somewhere; doing it here
     * keeps a raw UUID out of the API and out of the browser.
     */
    private readonly routeCostRepository: RouteCostRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteTunnelCostService.name);
  }

  /**
   * The owner's tunnel cost, active or not.
   *
   * An INACTIVE cost is found too, because reactivating a route must correct the
   * row already there rather than create a second one beside it.
   */
  async find(owner: TunnelCostOwner): Promise<RouteCostResponseDto | null> {
    const active = await this.activeCostsOf(owner);
    const activeMatch = active.find(
      (cost) => cost.pricingComponent.code === TUNNEL_CODE,
    );

    if (activeMatch) {
      return activeMatch;
    }

    return this.findInactive(owner);
  }

  /**
   * Writes the owner's tunnel, creating or correcting whichever row exists.
   *
   * An amount of ZERO is stored as a real row rather than as no row. The two
   * price a Trip identically but say different things: an explicit zero is "this
   * route has no tunnel", and an absent row is "nobody has said". The second is
   * reported as a configuration gap, and an operator who typed 0 should not be
   * nagged about it.
   */
  async save(owner: TunnelCostOwner, amount: number): Promise<void> {
    const component = await this.requireTunnelComponent();
    const existing = await this.find(owner);

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
   * Stops the owner's tunnel from being charged.
   *
   * Used when a route MOVES or goes: a cost of the ROAD is matched by departure
   * and destination, so the one left at the old pair would go on charging Trips
   * that still drive it. The row stays; only the Engine stops reading it.
   */
  async deactivate(owner: TunnelCostOwner): Promise<void> {
    const cost = await this.find(owner);

    if (cost?.isActive) {
      await this.routeCosts.deactivate(cost.id);
    }
  }

  private activeCostsOf(
    owner: TunnelCostOwner,
  ): Promise<RouteCostResponseDto[]> {
    return owner.kind === "ROUTE"
      ? this.routeCosts.findActiveForRoutePricing(owner.routePricingId)
      : this.routeCosts.findActiveForRoute(owner.departure, owner.destination);
  }

  /**
   * The owner's deactivated tunnel cost, if it has one.
   *
   * The active lookups above cannot see it, so the paginated list of inactive
   * costs is searched — a road is matched with the canonical terminal rule, a
   * route by its identity.
   */
  private async findInactive(
    owner: TunnelCostOwner,
  ): Promise<RouteCostResponseDto | null> {
    const { items } = await this.routeCosts.findAll({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      isActive: false,
    });

    return (
      items.find(
        (cost) =>
          cost.pricingComponent.code === TUNNEL_CODE &&
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

  private async requireTunnelComponent() {
    const component =
      await this.routeCostRepository.findPricingComponentByCode(TUNNEL_CODE);

    if (!component) {
      throw new UnknownPricingComponentException(TUNNEL_CODE);
    }

    return component;
  }
}
