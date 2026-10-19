import { RouteSelectionSource } from "@prisma/client";

import type {
  CombinationRoutePricingDto,
  RoutePricingResponseDto,
} from "../route-pricing/dto/route-pricing-response.dto";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import type { ManualRouteChoiceKind } from "../trip-pricing/manual-route-choice";
import type { TripReadView } from "../trips/trip-read.service";
import { pricingPartnerOf } from "./combination-leg";
import { decideOverSt } from "./combination-over-st";
import type { PricingRouteMatchTrace } from "./pricing-calculation-context";
import type { MatchedRouteConfiguration, RouteSelection } from "./pricing-component.resolver";
import { combinationTrace, ordinaryRouteTrace } from "./route-match-trace";

/** Route choices not yet stored, by Trip id — what a choice is priced with before it is kept. */
export type RouteChoices = ReadonlyMap<string, string>;

export const NO_ROUTE_CHOICES: RouteChoices = new Map();

export interface ManualRouteInputs {
  readonly trip: TripReadView;
  readonly kind: ManualRouteChoiceKind;
  /** The route the operator chose for this Trip (stored, or offered in `choices`). */
  readonly chosenId: string;
  /** What the automatic matcher found — kept on the trace, because it says why. */
  readonly automatic: PricingRouteMatchTrace;
  readonly choices: RouteChoices;
  readonly ordinaryRoutes: readonly RoutePricingResponseDto[];
  readonly combinations: readonly CombinationRoutePricingDto[];
  /** The Trip's group, for its pricing partner; empty for a Trip in no group. */
  readonly members: readonly TripReadView[];
}

export type ManualRouteOutcome =
  | { readonly kind: "CHOSEN"; readonly selection: RouteSelection }
  | { readonly kind: "NOT_USABLE"; readonly reason: string };

/**
 * The route selection an operator's choice gives a Trip — or why it cannot.
 *
 * ── NOTHING NEW IS CALCULATED HERE ──────────────────────────────────────────
 * It only decides WHICH configured row prices the Trip; the Engine prices it
 * exactly as it prices a matched one. A Combination leg takes its Over ST from
 * `decideOverSt` and its partner from `pricingPartnerOf`, the rules automatic
 * pricing uses.
 *
 * The kind must fit the Trip (a grouped Trip prices ONLY on a Combination, an
 * ungrouped one only on an ordinary route), and a Combination needs its partner
 * to hold the OTHER leg of the same Combination — written together, so never
 * one without the other. Anything else is not used, and the automatic outcome
 * stands: never an ordinary route for a grouped Trip.
 */
export function chooseManualRoute(inputs: ManualRouteInputs): ManualRouteOutcome {
  return inputs.kind === "NORMAL" ? chooseOrdinaryRoute(inputs) : chooseCombinationLeg(inputs);
}

function chooseOrdinaryRoute(inputs: ManualRouteInputs): ManualRouteOutcome {
  const route = inputs.ordinaryRoutes.find((each) => each.id === inputs.chosenId);

  if (!route) {
    return { kind: "NOT_USABLE", reason: "NOT_AN_ORDINARY_ROUTE" };
  }

  return {
    kind: "CHOSEN",
    selection: {
      route: toMatch(route, RouteConfigurationKind.NORMAL),
      trace: {
        ...ordinaryRouteTrace(route, inputs.automatic.method, null),
        selection: RouteSelectionSource.MANUAL,
      },
    },
  };
}

function chooseCombinationLeg(inputs: ManualRouteInputs): ManualRouteOutcome {
  const { trip, chosenId, automatic, choices } = inputs;
  const group = inputs.combinations.find((each) => each.legs.some((leg) => leg.id === chosenId));
  const ownLeg = group?.legs.find((leg) => leg.id === chosenId);
  const pairing = pricingPartnerOf(trip, inputs.members);

  if (!group || !ownLeg) {
    return { kind: "NOT_USABLE", reason: "NOT_A_COMBINATION_LEG" };
  }

  if (pairing.kind !== "PAIRED") {
    return { kind: "NOT_USABLE", reason: "NO_PARTNER" };
  }

  const partnerChoice = choices.get(pairing.partner.id) ?? pairing.partner.manualRoutePricingId;
  const partnerLeg = group.legs.find(
    (leg) => leg.id === partnerChoice && leg.combinationLegPosition !== ownLeg.combinationLegPosition,
  );

  if (!partnerLeg) {
    return { kind: "NOT_USABLE", reason: "PARTNER_DOES_NOT_HOLD_THE_OTHER_LEG" };
  }

  const overSt = decideOverSt(trip, pairing.partner, group.overSt);
  const method = automatic.method;

  return {
    kind: "CHOSEN",
    selection: {
      route: {
        ...toMatch(ownLeg, RouteConfigurationKind.COMBINATION),
        overSt: overSt.applies ? overSt.amounts : null,
      },
      trace: {
        ...combinationTrace(group.id, method, { leg: ownLeg, method }, { leg: partnerLeg, method }),
        // Still the automatic outcome: it is the reason the choice was needed.
        combinationMatch: automatic.combinationMatch,
        selection: RouteSelectionSource.MANUAL,
      },
    },
  };
}

function toMatch(route: RoutePricingResponseDto, kind: RouteConfigurationKind): MatchedRouteConfiguration {
  return {
    routePricingId: route.id,
    basePrice: route.basePrice,
    departure: route.departure,
    destination: route.destination,
    kind,
    overSt: null,
  };
}
