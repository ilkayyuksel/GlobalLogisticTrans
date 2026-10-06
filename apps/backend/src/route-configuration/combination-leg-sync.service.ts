import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { isSameRoad } from "../route-pricing/route-identity";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import type { CombinationLegPosition, CombinationLegSyncDto } from "./dto/combination-leg-sync.dto";
import type {
  CombinationRouteConfigurationDto,
  RouteConfigurationDto,
  SaveRouteConfigurationDto,
} from "./dto/route-configuration.dto";
import { RouteConfigurationUnitOfWork } from "./route-configuration.unit-of-work";

/**
 * Copies one Combination leg's prices to every other Combination that runs the
 * same leg in the same position.
 *
 * ── WHICH LEGS ARE THE SAME LEG ─────────────────────────────────────────────
 * Three things, all of them, and nothing looser — see `findSyncTargets`:
 *
 *   * the leg is in a COMBINATION — an ordinary route is never reached;
 *   * it is in the SAME POSITION — the outbound leg of one Combination is never
 *     the return leg of another, even when both run the same From and To;
 *   * it is the SAME ROAD as the source leg, by the application's one road
 *     identity (`isSameRoad`): the departure compared as a terminal, so
 *     `PSA Quay 869` and `Quay 869` are one place, the destination exactly —
 *     the very rule RoutePricing and RouteCost are matched by, so a sync can
 *     never call two legs the same that pricing would tell apart, or the other
 *     way round.
 *
 * One road may be a leg of many Combinations — a Combination is identified by
 * its PAIR of legs, not by either one — so a sync reaches every such
 * Combination, however many there are.
 *
 * ── WHAT IS COPIED ──────────────────────────────────────────────────────────
 * Tarief, Toll and Tunnel, exactly as the source leg stores them now — the
 * values its own inline edit last saved. Nothing is recalculated. From, To, the
 * review mark, the Combination's Over ST and the Combination itself are left
 * exactly as they are: the update below sends no Over ST, which leaves it as
 * stored.
 *
 * ── THROUGH THE SAME DOOR AS AN EDIT ────────────────────────────────────────
 * Each target Combination is saved through `CombinationRouteConfigurationService
 * .update` — the very update an operator's inline leg edit goes through — with
 * the untouched leg passed through as it stands. There is no second way prices
 * are written, and every rule an edit obeys applies here too.
 *
 * All targets in ONE transaction: a sync that stopped halfway would leave the
 * same leg priced two ways with nothing on screen saying which were reached.
 */
@Injectable()
export class CombinationLegSyncService {
  constructor(
    private readonly combinations: CombinationRouteConfigurationService,
    private readonly unitOfWork: RouteConfigurationUnitOfWork,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CombinationLegSyncService.name);
  }

  /** What a sync of this leg would reach. Writes nothing. */
  async preview(
    combinationGroupId: string,
    legPosition: CombinationLegPosition,
  ): Promise<CombinationLegSyncDto> {
    const source = await this.combinations.findById(combinationGroupId);
    const all = await this.combinations.findAll();

    return toSyncAnswer(source, legPosition, findSyncTargets(source, legPosition, all));
  }

  /** Performs the sync, all targets together, and answers what it reached. */
  async sync(
    combinationGroupId: string,
    legPosition: CombinationLegPosition,
  ): Promise<CombinationLegSyncDto> {
    const answer = await this.unitOfWork.run(async (services) => {
      // Read inside the transaction: the source's values are the ones it holds
      // at this moment, and the targets are those that exist at this moment.
      const source = await services.combinations.findById(combinationGroupId);
      const all = await services.combinations.findAll();
      const targets = findSyncTargets(source, legPosition, all);
      const index = indexOf(legPosition);
      const prices = pricesOf(source.legs[index]);

      for (const target of targets) {
        await services.combinations.update(target.id, {
          legs: target.legs.map((leg, legIndex) =>
            legIndex === index ? { ...toSaveValues(leg), ...prices } : toSaveValues(leg),
          ),
        });
      }

      return toSyncAnswer(source, legPosition, targets);
    });

    this.logger.log("Combination leg prices synchronised", {
      combinationGroupId,
      legPosition,
      targets: answer.targetCombinationGroupIds.length,
    });

    return answer;
  }
}

/**
 * The OTHER Combinations whose leg in the same position is the same road as the
 * source leg, by the shared road identity.
 *
 * Exported because this rule is the feature: it is tested on its own, and both
 * the preview and the sync ask it, so they cannot disagree.
 */
export function findSyncTargets(
  source: CombinationRouteConfigurationDto,
  legPosition: CombinationLegPosition,
  all: readonly CombinationRouteConfigurationDto[],
): CombinationRouteConfigurationDto[] {
  const index = indexOf(legPosition);
  const sourceLeg = source.legs[index];

  return all.filter((candidate) => {
    const leg = candidate.legs[index];

    return (
      candidate.id !== source.id && leg !== undefined && isSameRoad(leg, sourceLeg)
    );
  });
}

/** Position 1 is the outbound leg, first in the list; position 2 the return. */
function indexOf(legPosition: CombinationLegPosition): number {
  return legPosition - 1;
}

/** The three values a sync copies, as a save takes them. */
function pricesOf(
  leg: RouteConfigurationDto,
): Pick<SaveRouteConfigurationDto, "tarief" | "toll" | "tunnel"> {
  const { tarief, toll, tunnel } = toSaveValues(leg);

  return { tarief, toll, tunnel };
}

/**
 * A stored leg, as the update takes it back: every value exactly as it is.
 *
 * An unmeasured distance stays null — never turned into a road of no length.
 */
function toSaveValues(leg: RouteConfigurationDto): SaveRouteConfigurationDto {
  return {
    departure: leg.departure,
    destination: leg.destination,
    tarief: Number(leg.tarief),
    toll: Number(leg.toll),
    tunnel: Number(leg.tunnel),
  };
}

function toSyncAnswer(
  source: CombinationRouteConfigurationDto,
  legPosition: CombinationLegPosition,
  targets: readonly CombinationRouteConfigurationDto[],
): CombinationLegSyncDto {
  const leg = source.legs[indexOf(legPosition)];

  return {
    combinationGroupId: source.id,
    legPosition,
    departure: leg.departure,
    destination: leg.destination,
    prices: { tarief: leg.tarief, toll: leg.toll, tunnel: leg.tunnel },
    targetCombinationGroupIds: targets.map((target) => target.id),
  };
}
