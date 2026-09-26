import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingDto } from "../route-pricing/dto/route-pricing-response.dto";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingResponseDto } from "../route-pricing/dto/route-pricing-response.dto";
import {
  CombinationRouteConfigurationDto,
  RouteConfigurationDto,
  SaveCombinationRouteConfigurationDto,
  SaveRouteConfigurationDto,
  composeRouteConfiguration,
  routeNameOf,
} from "./dto/route-configuration.dto";
import {
  RouteTunnelCostService,
  TunnelCostOwner,
} from "./route-tunnel-cost.service";

/**
 * A Combination route configuration, as an operator configures it.
 *
 * ── WHAT AN OPERATOR SEES ───────────────────────────────────────────────────
 * One record with two legs: Antwerp to Kallo at 100 over 25 km, and Kallo back
 * to Antwerp at 80 over the same 25 km. They are configured, edited and removed
 * as one thing, because half a Combination prices one direction and silently
 * charges nothing for the other.
 *
 * ── NOT A TRIP GROUP ────────────────────────────────────────────────────────
 * Nothing here relates to the group an operator makes in the Rittenlijst. That
 * group decides which Trips carry the €50 Backload; this decides what the two
 * legs of a Combination COST. Neither reads the other, and no Trip, snapshot or
 * pricing line is touched by anything in this service.
 *
 * ── WHAT IT OWNS ────────────────────────────────────────────────────────────
 * Nothing. Like the ordinary configuration service it is an application-layer
 * composition: the legs are written by CombinationRoutePricingService, which
 * holds the transaction and the exactly-two rule, and each leg's tunnel by
 * RouteTunnelCostService. This service decides only how the two are put
 * together, which is why it stays short.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CombinationRouteConfigurationService {
  constructor(
    private readonly combinationPricing: CombinationRoutePricingService,
    private readonly tunnelCosts: RouteTunnelCostService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CombinationRouteConfigurationService.name);
  }

  /** Every Combination configuration, each with both of its legs. */
  async findAll(): Promise<CombinationRouteConfigurationDto[]> {
    const combinations = await this.combinationPricing.findAll();

    return Promise.all(combinations.map((group) => this.compose(group)));
  }

  async findById(
    combinationGroupId: string,
  ): Promise<CombinationRouteConfigurationDto> {
    return this.compose(
      await this.combinationPricing.findById(combinationGroupId),
    );
  }

  /**
   * Configures a Combination.
   *
   * The two legs are written first and together, in one transaction: they are
   * the records that identify the configuration, and a Combination refused for
   * any reason must leave nothing behind. Only once both exist does each leg's
   * tunnel follow, written against the LEG rather than against the road — see
   * `TunnelCostOwner`.
   */
  async create(
    dto: SaveCombinationRouteConfigurationDto,
  ): Promise<CombinationRouteConfigurationDto> {
    const created = await this.combinationPricing.create(
      dto.legs.map((leg) => this.toLegPrice(leg)),
    );

    await this.saveTunnels(created.legs, dto.legs);

    this.logger.log("Combination route configuration created", {
      combinationGroupId: created.id,
    });

    return this.findById(created.id);
  }

  /**
   * Changes both legs of a Combination in one edit.
   *
   * Both are always rewritten, even when only one changed: a Combination is
   * edited as a whole, and accepting one leg at a time is what would allow the
   * pair to disagree. The legs keep their identities, so each keeps its own
   * tunnel — and because that tunnel belongs to the LEG rather than to the road,
   * moving a leg does not strand it the way an ordinary route's cost would be
   * stranded. Its recorded road follows the leg instead.
   */
  async update(
    combinationGroupId: string,
    dto: SaveCombinationRouteConfigurationDto,
  ): Promise<CombinationRouteConfigurationDto> {
    const updated = await this.combinationPricing.replaceLegs(
      combinationGroupId,
      dto.legs.map((leg) => this.toLegPrice(leg)),
    );

    await this.saveTunnels(updated.legs, dto.legs);

    this.logger.log("Combination route configuration updated", {
      combinationGroupId,
    });

    return this.findById(combinationGroupId);
  }

  /**
   * Removes a Combination configuration entirely: the group and both legs.
   *
   * ── WHAT GOES, AND WHAT STAYS ─────────────────────────────────────────────
   * Each leg's tunnel goes with it. A cost owned by a leg describes that leg and
   * nothing else, so keeping it would leave a row no lookup can reach — unlike an
   * ordinary route's cost, which describes a road that still exists and is
   * therefore deactivated rather than removed. The database performs both in one
   * statement through the cascade, so there is no moment at which one leg or one
   * cost survives alone.
   *
   * Nothing priced changes. A TripPricing snapshot holds the amounts it was
   * priced with and reads no configuration ever again, so historical invoices
   * stay exactly as explainable as they were.
   */
  async remove(combinationGroupId: string): Promise<void> {
    await this.combinationPricing.remove(combinationGroupId);

    this.logger.log("Combination route configuration deleted", {
      combinationGroupId,
    });
  }

  /** Each leg's tunnel, against the leg that was just written. */
  private async saveTunnels(
    legs: readonly RoutePricingResponseDto[],
    configured: readonly SaveRouteConfigurationDto[],
  ): Promise<void> {
    for (const [index, leg] of legs.entries()) {
      await this.tunnelCosts.save(this.ownerOf(leg), configured[index].tunnel);
    }
  }

  private async compose(
    group: CombinationRoutePricingDto,
  ): Promise<CombinationRouteConfigurationDto> {
    return {
      id: group.id,
      legs: await Promise.all(group.legs.map((leg) => this.composeLeg(leg))),
    };
  }

  private async composeLeg(
    leg: RoutePricingResponseDto,
  ): Promise<RouteConfigurationDto> {
    return composeRouteConfiguration(
      leg,
      await this.tunnelCosts.find(this.ownerOf(leg)),
    );
  }

  /**
   * A leg OWNS its tunnel.
   *
   * The road it runs may also be an ordinary configured route with a tunnel of
   * its own, and the two must not be the same row: correcting the Combination's
   * tunnel would otherwise silently change what every ordinary Trip on that road
   * pays.
   */
  private ownerOf(leg: RoutePricingResponseDto): TunnelCostOwner {
    return {
      kind: "ROUTE",
      routePricingId: leg.id,
      departure: leg.departure,
      destination: leg.destination,
    };
  }

  /** One leg, as the price record that stores it. */
  private toLegPrice(leg: SaveRouteConfigurationDto) {
    return {
      routeName: routeNameOf(leg),
      departure: leg.departure,
      destination: leg.destination,
      basePrice: leg.tarief,
      kilometres: leg.kilometres,
    };
  }
}
