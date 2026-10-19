import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { RouteSelectionSource } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import type { CombinationRoutePricingDto, RoutePricingResponseDto } from "../route-pricing/dto/route-pricing-response.dto";
import { matchRoad } from "../route-pricing/route-matcher";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { hasCurrentPrice } from "../trip-pricing/current-pricing";
import { manualRouteChoiceFor } from "../trip-pricing/manual-route-choice";
import {
  TripRouteSelectionRepository,
  type TripRouteChoice,
} from "../trip-route-selection/trip-route-selection.repository";
import { TripReadService, type TripReadView } from "../trips/trip-read.service";
import { pricingPartnerOf } from "./combination-leg";
import { pricingRoadOf } from "./combination-over-st";
import { PairedPricingService } from "./paired-pricing.service";
import type { PricingCalculationResult } from "./pricing-calculation-result";
import { PricingComponentResolver } from "./pricing-component.resolver";

/** What the operator chose: an ordinary route, or a Combination (and maybe this Trip's leg). */
export type RouteChoiceRequest =
  | { readonly kind: "NORMAL"; readonly routePricingId: string }
  | { readonly kind: "COMBINATION"; readonly combinationRouteGroupId: string; readonly legPosition?: 1 | 2 };

type CombinationLegDto = RoutePricingResponseDto;

/**
 * Choosing a route by hand for a Trip whose automatic match is unusable
 * (owner, October 2026).
 *
 * ── WHAT IT DECIDES, AND WHAT IT LEAVES TO THE ENGINE ───────────────────────
 * Whether the choice may be made (the AUTOMATIC outcome, now — see
 * `manualRouteChoiceFor`), whether the route fits the Trip (an ordinary route
 * for a Trip in no group, a Combination for a grouped one), and for a
 * Combination which leg each Trip of the pair holds. Pricing is the Engine's:
 * the pair is CALCULATED with the choice first, and the choice and the new
 * snapshots are stored only when every leg priced on it — otherwise nothing
 * changes and the reason is returned.
 *
 * ── WHICH LEG (owner's choice: derive, otherwise ask) ───────────────────────
 * The roads decide when they can: a Trip whose road matches exactly one leg of
 * the chosen Combination holds that leg, and its partner the other. When
 * neither road says, the operator names this Trip's leg; a named leg that the
 * roads contradict is refused. Never the order of clicks, never a guess.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class ManualRouteSelectionService {
  constructor(
    private readonly trips: TripReadService,
    private readonly components: PricingComponentResolver,
    private readonly routePricing: RoutePricingService,
    private readonly combinationPricing: CombinationRoutePricingService,
    private readonly pairs: PairedPricingService,
    private readonly routeChoices: TripRouteSelectionRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ManualRouteSelectionService.name);
  }

  /** Stores the choice and the prices it produced; answers the Trips priced. */
  async choose(tripId: string, request: RouteChoiceRequest): Promise<string[]> {
    const trip = await this.requireFinishedTrip(tripId);
    const allowed = await this.allowedKind(trip);

    if (request.kind !== allowed) {
      throw new BadRequestException(
        allowed === "NORMAL"
          ? "Voor een rit zonder groep kan alleen een gewone route gekozen worden."
          : "Voor een rit in een groep kan alleen een combinatieroute gekozen worden.",
      );
    }

    const choices =
      request.kind === "NORMAL"
        ? [await this.ordinaryChoice(trip, request.routePricingId)]
        : await this.combinationChoices(trip, request.combinationRouteGroupId, request.legPosition);

    await this.pairs.calculateAndStoreTogether(
      choices.map((choice) => choice.tripId),
      {
        choices: new Map(choices.map((choice) => [choice.tripId, choice.routePricingId])),
        beforeStore: (results) => this.keepChoices(choices, results),
      },
    );

    this.logger.log("Route chosen by hand and priced", { tripId, choices });

    return choices.map((choice) => choice.tripId);
  }

  private async requireFinishedTrip(tripId: string): Promise<TripReadView> {
    const trip = await this.trips.findById(tripId);

    if (!trip) {
      throw new NotFoundException(`Rit ${tripId} bestaat niet.`);
    }

    if (!hasCurrentPrice(trip.status)) {
      throw new ConflictException("Alleen voor een afgewerkte rit kan een route gekozen worden.");
    }

    return trip;
  }

  /** The kind of route the AUTOMATIC outcome lets the operator choose — or a refusal. */
  private async allowedKind(trip: TripReadView): Promise<"NORMAL" | "COMBINATION"> {
    const automatic = await this.components.resolveAutomaticRouteSelection(trip);
    const kind = automatic.route === null ? manualRouteChoiceFor(automatic.trace) : null;

    if (kind !== null) {
      return kind;
    }

    throw new ConflictException(
      automatic.route !== null
        ? "De automatische routeherkenning vindt voor deze rit een bruikbare route; die blijft leidend."
        : "Deze rit heeft geen eenduidige andere leg, dus er kan geen combinatieroute gekozen worden.",
    );
  }

  private async ordinaryChoice(trip: TripReadView, routePricingId: string): Promise<TripRouteChoice> {
    const route = (await this.routePricing.findAllOrdinary()).find((each) => each.id === routePricingId);

    if (!route) {
      throw new NotFoundException("Deze gewone route bestaat niet (meer).");
    }

    return { tripId: trip.id, routePricingId: route.id };
  }

  private async combinationChoices(
    trip: TripReadView,
    combinationRouteGroupId: string,
    legPosition: 1 | 2 | undefined,
  ): Promise<TripRouteChoice[]> {
    const combination = (await this.combinationPricing.findAll()).find(
      (each) => each.id === combinationRouteGroupId,
    );

    if (!combination) {
      throw new NotFoundException("Deze combinatieroute bestaat niet (meer).");
    }

    const partner = await this.closedPartnerOf(trip);
    const ownLeg = this.legOf(trip, partner, combination, legPosition);
    const otherLeg = combination.legs.find(
      (leg) => leg.combinationLegPosition !== ownLeg.combinationLegPosition,
    ) as CombinationLegDto;

    return [
      { tripId: trip.id, routePricingId: ownLeg.id },
      { tripId: partner.id, routePricingId: otherLeg.id },
    ];
  }

  private async closedPartnerOf(trip: TripReadView): Promise<TripReadView> {
    const members = await this.trips.findByGroupId(trip.tripGroupId as string);
    const pairing = pricingPartnerOf(trip, members);

    if (pairing.kind !== "PAIRED") {
      throw new ConflictException("De andere leg van deze groep kan niet eenduidig bepaald worden.");
    }

    if (!hasCurrentPrice(pairing.partner.status)) {
      throw new ConflictException(
        `De andere leg (${pairing.partner.bookingNumber ?? pairing.partner.id}) is nog niet afgewerkt; kies de combinatieroute wanneer beide legs afgewerkt zijn.`,
      );
    }

    return pairing.partner;
  }

  /** This Trip's leg: from the roads when they say, else as the operator named it. */
  private legOf(
    trip: TripReadView,
    partner: TripReadView,
    combination: CombinationRoutePricingDto,
    legPosition: 1 | 2 | undefined,
  ): CombinationLegDto {
    const derived = this.derivedLeg(trip, partner, combination);
    const named = combination.legs.find((leg) => leg.combinationLegPosition === legPosition);

    if (legPosition !== undefined && !named) {
      throw new BadRequestException("Kies Leg 1 of Leg 2.");
    }

    if (named && derived && named.id !== derived.id) {
      throw new ConflictException(
        `De route van deze rit past bij Leg ${derived.combinationLegPosition} van deze combinatie, niet bij Leg ${legPosition}.`,
      );
    }

    const leg = named ?? derived;

    if (!leg) {
      throw new UnprocessableEntityException(
        "Uit de routegegevens blijkt niet welke leg deze rit is. Kies of deze rit Leg 1 of Leg 2 van de combinatie is.",
      );
    }

    return leg;
  }

  /**
   * The leg the ROADS give this Trip, or null when they do not say. Each road
   * is compared with each leg by the central matcher; a road matching both or
   * neither leg says nothing, and two roads claiming one leg are refused.
   */
  private derivedLeg(
    trip: TripReadView,
    partner: TripReadView,
    combination: CombinationRoutePricingDto,
  ): CombinationLegDto | null {
    const own = this.legsMatching(trip, combination);
    const partners = this.legsMatching(partner, combination);

    if (own.length === 1 && partners.length === 1 && own[0].id === partners[0].id) {
      throw new ConflictException(
        "Beide ritten passen bij dezelfde leg van deze combinatie; de legs kunnen niet toegewezen worden.",
      );
    }

    if (own.length === 1) {
      return own[0];
    }

    if (partners.length === 1) {
      return combination.legs.find((leg) => leg.id !== partners[0].id) ?? null;
    }

    return null;
  }

  private legsMatching(trip: TripReadView, combination: CombinationRoutePricingDto): CombinationLegDto[] {
    const road = pricingRoadOf(trip);

    return road ? combination.legs.filter((leg) => matchRoad(road, [leg]).matches.length === 1) : [];
  }

  /**
   * Kept only when every leg was priced on the choice — the Engine's own
   * verdict, read from the calculations — and before any snapshot is stored.
   */
  private async keepChoices(
    choices: readonly TripRouteChoice[],
    results: readonly PricingCalculationResult[],
  ): Promise<void> {
    const notApplied = results.filter(
      (result) => result.context.routeMatch.selection !== RouteSelectionSource.MANUAL,
    );

    if (notApplied.length > 0) {
      this.logger.warn("A route choice could not be applied; nothing stored", {
        tripIds: notApplied.map((result) => result.tripId),
      });

      throw new ConflictException("De gekozen route kon niet op de rit worden toegepast; er is niets gewijzigd.");
    }

    await this.routeChoices.replace(choices);
  }
}
