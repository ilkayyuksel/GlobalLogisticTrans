import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { MissingTripPricingInputException } from "./exceptions/pricing-engine.exceptions";
import {
  PricingBaseSource,
  PricingRuleConfiguration,
} from "./pricing-calculation-context";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** The Custom Property the Engine applies on its own — TAR in this system. */
const AUTOMATIC_PROPERTY_ID = "property-tar";
const ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** The Combination configuration of the same road, priced differently. */
const LEG_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

/** One document that printed two legs, and the pair it produced. */
const GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const DOCUMENT_ID = "pdf-1";
const OTHER_TRIP_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";

/**
 * The narrow engine shape, not the response DTO: the resolver reads eleven
 * scalar columns and can reach nothing else.
 */
function buildTrip(overrides: Partial<TripReadView> = {}): TripReadView {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    // A stated TAR-nummer, because eligibility now depends on it. These
    // fixtures are about ALLOCATION — which leg owes the charge — so they must
    // clear the new precondition to keep testing what they were written for.
    tarNummer: "TAR-2026-0042",
    tripGroupId: null,
    status: TripStatus.CLOSED,
    direction: null,
    bookingNumber: "BK-2026-0042",
    terminal: "Antwerp",
    destinationCity: "Rotterdam",
    planningDate: "2026-08-17",
    waitingTimeMinutes: null,
    distanceKm: null,
    ...overrides,
  };
}

function buildRules(
  overrides: Partial<PricingRuleConfiguration> = {},
): PricingRuleConfiguration {
  return {
    strategy: PricingStrategy.ROUTE_BASED,
    fuelPercentage: "15",
    combinationSurcharge: "75",
    overStSurcharge: "70.00",
    automaticCustomPropertyId: AUTOMATIC_PROPERTY_ID,
    waitingTimeFreeMinutes: 60,
    waitingTimeThresholdMinutes: 0,
    waitingTimeBlockMinutes: 30,
    waitingTimeBlockPrice: "25.00",
    ruleVersion: "2026.1",
    ...overrides,
  };
}

const ROUTE_PRICING = {
  id: ROUTE_ID,
  routeName: "Antwerp - Rotterdam",
  departure: "Antwerp",
  destination: "Rotterdam",
  basePrice: "380.00",
  // The road's length, which the Toll is derived from. It travels with the match
  // rather than being looked up again, so it cannot come from another row.
  kilometres: "25.00",
  combinationGroupId: null,
  combinationLegPosition: null,
  notes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

/** One assignment, shaped as TripCustomPropertyService returns it. */
/**
 * One assigned property as the READ side returns it.
 *
 * Four fields, because those are the four a price depends on. The assignment
 * row's own id, its timestamp and the property's active flag are absent: the
 * Engine never reads them, and a builder that supplied them would suggest it
 * could.
 */
function assignment(
  id: string,
  name: string,
  pricingComponentId: string | null,
  defaultPrice: string | null,
) {
  return { customPropertyId: id, name, pricingComponentId, defaultPrice };
}

describe("PricingComponentResolver", () => {
  let routePricingService: { findAllOrdinary: jest.Mock };
  let combinationPricing: { findAll: jest.Mock };
  let tripCustomProperties: { findByTripId: jest.Mock };
  let ruleResolver: { resolveDistanceRatePerKm: jest.Mock };
  let customPropertyService: { findById: jest.Mock };
  let trips: { findByGroupId: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let tarCharges: { hasBeenChargedToday: jest.Mock };
  let resolver: PricingComponentResolver;

  beforeEach(() => {
    routePricingService = {
      findAllOrdinary: jest.fn().mockResolvedValue([ROUTE_PRICING]),
    };
    // No Combination is configured unless a test says so.
    combinationPricing = { findAll: jest.fn().mockResolvedValue([]) };
    tripCustomProperties = {
      findByTripId: jest.fn().mockResolvedValue([]),
    };
    customPropertyService = {
      findById: jest.fn().mockResolvedValue({
        id: AUTOMATIC_PROPERTY_ID,
        name: "TAR",
        pricingComponentId: null,
        defaultPrice: "20.00",
      }),
    };
    trips = {
      findByGroupId: jest.fn().mockResolvedValue([]),
    };
    ruleResolver = {
      resolveDistanceRatePerKm: jest.fn().mockResolvedValue("1.85"),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    // Nothing has been charged today unless a test says otherwise.
    tarCharges = { hasBeenChargedToday: jest.fn().mockResolvedValue(false) };

    resolver = new PricingComponentResolver(
      routePricingService as unknown as RoutePricingService,
      combinationPricing as unknown as CombinationRoutePricingService,
      tripCustomProperties as unknown as TripCustomPropertyReadService,
      customPropertyService as unknown as CustomPropertyService,
      trips as unknown as TripReadService,
      ruleResolver as unknown as PricingRuleResolver,
      tarCharges as never,
      logger as unknown as AppLoggerService,
    );
  });

  describe("route-based base source", () => {
    /**
     * The route is matched first and the match is then priced — the two steps the
     * Engine performs, in the order it performs them.
     *
     * Passing the match in rather than looking it up again is what keeps the
     * Tarief, the road's length and the road's tunnel on ONE configured row: a
     * road may be configured twice, as an ordinary route and as a leg of a
     * Combination, and separate lookups could match different rows.
     */
    async function priceRouteBased(
      trip = buildTrip(),
      rules = buildRules(),
    ): Promise<PricingBaseSource> {
      return resolver.resolveBaseSource(
        trip,
        rules,
        (await resolver.resolveRouteSelection(trip)).route,
      );
    }

    /** An ordinary Trip is priced against the ORDINARY configurations only. */
    it("matches among the ordinary configurations, never a Combination's", async () => {
      await priceRouteBased();

      expect(routePricingService.findAllOrdinary).toHaveBeenCalledTimes(1);
      expect(combinationPricing.findAll).not.toHaveBeenCalled();
    });

    it("returns the configured base price as an exact string", async () => {
      const source = await priceRouteBased();

      expect(source).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        routePricingId: ROUTE_ID,
        basePrice: "380.00",
      });
    });

    it("carries no route, which belongs to the Trip rather than the strategy", async () => {
      const source = await priceRouteBased();

      expect(source).not.toHaveProperty("departure");
      expect(source).not.toHaveProperty("destination");
    });

    /**
     * ── AN UNCONFIGURED ROUTE PRICES AT ZERO ────────────────────────────────
     * It used to raise MissingRoutePricingException, and the consequence
     * reached far past the base price: no snapshot was written at all, so the
     * Trip showed nothing in any pricing column, offered no way to correct the
     * Tarief by hand, and could carry no waiting time, custom property or cost
     * confirmation — every one of those reads the snapshot that never existed.
     *
     * On this business's data an unconfigured route is the ORDINARY case. So
     * it is now what it always was in fact: a price of zero that an operator
     * can correct, on a Trip that still receives a complete snapshot.
     *
     * Zero is not a guess at what the route costs. It is the honest statement
     * that nobody has said what it costs, and it is visibly zero rather than
     * silently absent.
     */
    it("prices at zero when no active route pricing is configured", async () => {
      routePricingService.findAllOrdinary.mockResolvedValue([]);

      const source = await priceRouteBased();

      expect(source).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        routePricingId: null,
        basePrice: "0.00",
      });
    });

    /** Half a route matches no configuration, so it takes the same answer. */
    it("prices at zero when the Trip has no terminal", async () => {
      const source = await priceRouteBased(buildTrip({ terminal: null }));

      expect(source).toMatchObject({ basePrice: "0.00", routePricingId: null });
      expect(routePricingService.findAllOrdinary).not.toHaveBeenCalled();
    });

    it("prices at zero when the Trip has no destination", async () => {
      const source = await priceRouteBased(
        buildTrip({ destinationCity: null }),
      );

      expect(source).toMatchObject({ basePrice: "0.00", routePricingId: null });
      expect(routePricingService.findAllOrdinary).not.toHaveBeenCalled();
    });

    /** The gap is still reported, so an administrator can close it. */
    it("says so in the log rather than passing over it", async () => {
      routePricingService.findAllOrdinary.mockResolvedValue([]);

      await priceRouteBased();

      expect(logger.warn).toHaveBeenCalledWith(
        "Route pricing not matched; route components priced at zero",
        expect.objectContaining({ tripId: TRIP_ID, routeMatch: "NOT_FOUND" }),
      );
    });

    it("never reads the distance rate", async () => {
      await priceRouteBased();

      expect(ruleResolver.resolveDistanceRatePerKm).not.toHaveBeenCalled();
    });
  });

  /**
   * ── WHICH CONFIGURATION OF A ROAD APPLIES ────────────────────────────────
   * The road is the Trip's real driving direction, compared by the central
   * matcher (`route-matcher.ts`, tested on its own). These tests prove the
   * resolver asks it the right question: ordinary routes for an ordinary Trip,
   * the PAIR of roads for a genuine Combination, and an honest "nothing" —
   * with its reason — when no configuration is reliable.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("which configured route a Trip matches", () => {
    function ordinary(departure: string, destination: string, id = ROUTE_ID) {
      return { ...ROUTE_PRICING, id, departure, destination };
    }

    it("matches the ordinary configuration exactly", async () => {
      expect(await resolver.resolveRouteSelection(buildTrip())).toEqual({
        route: {
          routePricingId: ROUTE_ID,
          basePrice: "380.00",
          departure: "Antwerp",
          destination: "Rotterdam",
          kind: RouteConfigurationKind.NORMAL,
          overSt: null,
        },
        // What the snapshot records: the configured road as it reads now.
        trace: {
          routePricingId: ROUTE_ID,
          method: "EXACT",
          combinationRouteGroupId: null,
          legs: [
            {
              legPosition: null,
              isPricedLeg: true,
              routePricingId: ROUTE_ID,
              departure: "Antwerp",
              destination: "Rotterdam",
              method: "EXACT",
            },
          ],
        },
      });
    });

    /** The configured spelling travels on, so its Toll and Tunnel are found. */
    it("matches a difference in letter case as NORMALIZED", async () => {
      routePricingService.findAllOrdinary.mockResolvedValue([
        ordinary("ANTWERP", "ROTTERDAM"),
      ]);

      const selection = await resolver.resolveRouteSelection(buildTrip());

      expect(selection.trace.method).toBe("NORMALIZED");
      expect(selection.route).toMatchObject({
        routePricingId: ROUTE_ID,
        departure: "ANTWERP",
        destination: "ROTTERDAM",
      });
    });

    it("matches a single trusted typo as FUZZY, and says so", async () => {
      const selection = await resolver.resolveRouteSelection(
        buildTrip({ destinationCity: "Roterdam" }),
      );

      expect(selection.trace.method).toBe("FUZZY");
      expect(selection.route?.routePricingId).toBe(ROUTE_ID);
      expect(logger.log).toHaveBeenCalledWith(
        "Route matched by a trusted typo",
        expect.objectContaining({ tripId: TRIP_ID, routeMatch: "FUZZY" }),
      );
    });

    it("matches nothing, with the nearest candidates, when nothing is reliable", async () => {
      const selection = await resolver.resolveRouteSelection(
        buildTrip({ destinationCity: "Gent" }),
      );

      expect(selection).toEqual({
        route: null,
        trace: {
            routePricingId: null,
            method: "NOT_FOUND",
            combinationRouteGroupId: null,
            legs: [],
          },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Route pricing not matched; route components priced at zero",
        expect.objectContaining({
          tripId: TRIP_ID,
          departure: "Antwerp",
          destination: "Gent",
          routeMatch: "NOT_FOUND",
          routePricingId: null,
          nearest: [
            expect.objectContaining({
              routePricingId: ROUTE_ID,
              departureEdits: 0,
            }),
          ],
        }),
      );
    });

    /** Never logs an amount: a warning is read by more people than a price. */
    it("logs no configured amount with the nearest candidates", async () => {
      await resolver.resolveRouteSelection(buildTrip({ destinationCity: "Gent" }));

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("380.00");
    });

    it("never chooses between two configurations of one road", async () => {
      routePricingService.findAllOrdinary.mockResolvedValue([
        ordinary("ANTWERP", "ROTTERDAM", "route-a"),
        ordinary("antwerp", "rotterdam", "route-b"),
      ]);

      expect(await resolver.resolveRouteSelection(buildTrip())).toEqual({
        route: null,
        trace: {
            routePricingId: null,
            method: "AMBIGUOUS",
            combinationRouteGroupId: null,
            legs: [],
          },
      });
    });

    /** The road is directional: the reverse is a different transport. */
    describe("direction", () => {
      it("never matches a road configured the other way round", async () => {
        routePricingService.findAllOrdinary.mockResolvedValue([
          ordinary("Rotterdam", "Antwerp"),
        ]);

        expect(
          (await resolver.resolveRouteSelection(buildTrip())).trace.method,
        ).toBe("NOT_FOUND");
      });

      it("prices a collection on its road from the city to the terminal", async () => {
        routePricingService.findAllOrdinary.mockResolvedValue([
          ordinary("Rotterdam", "Antwerp"),
        ]);

        const selection = await resolver.resolveRouteSelection(
          buildTrip({ direction: TripDirection.COLLECTION }),
        );

        expect(selection).toMatchObject({
          trace: { method: "EXACT", legs: [{ departure: "Rotterdam", destination: "Antwerp" }] },
          route: { routePricingId: ROUTE_ID },
        });
      });

      it("does not price a collection on the terminal-first road", async () => {
        const selection = await resolver.resolveRouteSelection(
          buildTrip({ direction: TripDirection.COLLECTION }),
        );

        expect(selection.trace.method).toBe("NOT_FOUND");
      });
    });

    /** Half a route matches nothing, and costs no query to find out. */
    it.each([
      ["no terminal", { terminal: null }],
      ["no destination", { destinationCity: null }],
    ])("matches nothing for a Trip with %s", async (_name, overrides) => {
      expect(
        await resolver.resolveRouteSelection(buildTrip(overrides)),
      ).toEqual({
        route: null,
        trace: {
            routePricingId: null,
            method: "NOT_FOUND",
            combinationRouteGroupId: null,
            legs: [],
          },
      });
      expect(routePricingService.findAllOrdinary).not.toHaveBeenCalled();
    });

    /** An ordinary Trip is not in a group, so its group is never read. */
    it("reads no group for a Trip that is in none", async () => {
      await resolver.resolveRouteSelection(buildTrip());

      expect(trips.findByGroupId).not.toHaveBeenCalled();
      expect(combinationPricing.findAll).not.toHaveBeenCalled();
    });
  });

  /**
   * ── A COMBINATION IS IDENTIFIED BY ITS PAIR ──────────────────────────────
   * One road may be a leg of several Combinations. Only BOTH roads of the
   * genuine pair name one, so a single road never picks a Combination — and a
   * pair that names none, or more than one, falls back to the ordinary route.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a genuine Combination", () => {
    type ConfiguredOverSt = {
      tarief: string | null;
      toll: string | null;
      tunnel: string | null;
    };
    const NO_OVER_ST: ConfiguredOverSt = { tarief: null, toll: null, tunnel: null };
    const RETURN_LEG_ID = "6b2e1d2f-3c4e-4f5a-9b0c-1d2e3f4a5b6c";

    /** Outbound: delivery Antwerp → Rotterdam. Return: collection Gent → Antwerp. */
    function outbound(overrides: Partial<TripReadView> = {}): TripReadView {
      return buildTrip({
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.DELIVERY,
        ...overrides,
      });
    }

    function inbound(overrides: Partial<TripReadView> = {}): TripReadView {
      return buildTrip({
        id: OTHER_TRIP_ID,
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.COLLECTION,
        destinationCity: "Gent",
        ...overrides,
      });
    }

    function leg(
      id: string,
      departure: string,
      destination: string,
      position: number,
      groupId: string,
    ) {
      return {
        ...ROUTE_PRICING,
        id,
        departure,
        destination,
        basePrice: position === 1 ? "100.00" : "90.00",
        combinationGroupId: groupId,
        combinationLegPosition: position,
        reviewed: false,
      };
    }

    function combination(
      id: string,
      returnFrom: string,
      overSt: ConfiguredOverSt = NO_OVER_ST,
      ids: [string, string] = [LEG_ID, RETURN_LEG_ID],
    ) {
      return {
        id,
        reviewed: false,
        legs: [
          leg(ids[0], "Antwerp", "Rotterdam", 1, id),
          leg(ids[1], returnFrom, "Antwerp", 2, id),
        ],
        overSt,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      };
    }

    function pair(
      own: Partial<TripReadView> = {},
      partner: Partial<TripReadView> = {},
    ): [TripReadView, TripReadView] {
      const members: [TripReadView, TripReadView] = [outbound(own), inbound(partner)];
      trips.findByGroupId.mockResolvedValue(members);

      return members;
    }

    it("prices each leg on its own leg of the configured pair", async () => {
      const [first, second] = pair();
      combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Gent")]);

      expect(await resolver.resolveRouteSelection(first)).toEqual({
        route: {
          routePricingId: LEG_ID,
          basePrice: "100.00",
          departure: "Antwerp",
          destination: "Rotterdam",
          kind: RouteConfigurationKind.COMBINATION,
          overSt: null,
        },
        // Both legs of the selected pair, this Trip's marked.
        trace: {
          routePricingId: LEG_ID,
          method: "EXACT",
          combinationRouteGroupId: "combo-1",
          legs: [
            {
              legPosition: 1,
              isPricedLeg: true,
              routePricingId: LEG_ID,
              departure: "Antwerp",
              destination: "Rotterdam",
              method: "EXACT",
            },
            {
              legPosition: 2,
              isPricedLeg: false,
              routePricingId: RETURN_LEG_ID,
              departure: "Gent",
              destination: "Antwerp",
              method: "EXACT",
            },
          ],
        },
      });
      expect(
        (await resolver.resolveRouteSelection(second)).route,
      ).toMatchObject({ routePricingId: RETURN_LEG_ID, basePrice: "90.00" });
    });

    /** The outbound alone fits both; the return decides. */
    it("chooses the Combination by its pair, not by a shared outbound", async () => {
      const [first] = pair();
      combinationPricing.findAll.mockResolvedValue([
        combination("combo-brugge", "Brugge", NO_OVER_ST, ["leg-b1", "leg-b2"]),
        combination("combo-gent", "Gent", NO_OVER_ST, ["leg-g1", "leg-g2"]),
      ]);

      expect(
        (await resolver.resolveRouteSelection(first)).route?.routePricingId,
      ).toBe("leg-g1");
    });

    it.each([
      ["a road that is no leg at all", [combination("combo-1", "Brugge")], "LEG_NOT_IDENTIFIED"],
      [
        "both roads configured, but in different Combinations",
        [
          combination("combo-1", "Brugge", NO_OVER_ST, ["leg-11", "leg-12"]),
          {
            ...combination("combo-2", "Gent", NO_OVER_ST, ["leg-21", "leg-22"]),
            legs: [
              leg("leg-21", "Antwerp", "Brussel", 1, "combo-2"),
              leg("leg-22", "Gent", "Antwerp", 2, "combo-2"),
            ],
          },
        ],
        "PAIR_NOT_CONFIGURED",
      ],
      [
        "two Combinations of this pair",
        [
          combination("combo-1", "Gent", NO_OVER_ST, ["leg-11", "leg-12"]),
          combination("combo-2", "Gent", NO_OVER_ST, ["leg-21", "leg-22"]),
        ],
        "AMBIGUOUS",
      ],
    ])("falls back to the ordinary route with %s", async (_name, groups, reason) => {
      const [first] = pair();
      combinationPricing.findAll.mockResolvedValue(groups);

      expect(await resolver.resolveRouteSelection(first)).toMatchObject({
        route: { routePricingId: ROUTE_ID, kind: RouteConfigurationKind.NORMAL },
        // Never a Combination recorded for a pair that was not identified.
        trace: { method: "EXACT", combinationRouteGroupId: null, legs: [{ legPosition: null }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Combination pair not identified; pricing the ordinary route",
        expect.objectContaining({ tripId: TRIP_ID, reason }),
      );
    });

    /** A group an operator made by hand claims nothing about pairing. */
    it("matches the ordinary configuration for a manual group", async () => {
      const [first] = pair({}, { pdfDocumentId: "a-different-document" });
      combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Gent")]);

      expect(await resolver.resolveRouteSelection(first)).toMatchObject({
        route: { routePricingId: ROUTE_ID, kind: RouteConfigurationKind.NORMAL },
      });
      expect(combinationPricing.findAll).not.toHaveBeenCalled();
    });

    /** A malformed pair is reported elsewhere and never priced on a guess. */
    it("matches the ordinary configuration for a malformed pair", async () => {
      const [first] = pair({}, { direction: TripDirection.DELIVERY });
      combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Gent")]);

      expect(await resolver.resolveRouteSelection(first)).toMatchObject({
        route: { routePricingId: ROUTE_ID, kind: RouteConfigurationKind.NORMAL },
      });
    });

    /**
     * ── OVER ST ────────────────────────────────────────────────────────────
     * Leg 2 only, planningDates that differ, Over ST configured. The amounts
     * travel on the match; the calculators add them (and the €70) — see
     * combination-over-st.pricing.spec.ts.
     */
    describe("Over ST", () => {
      const OVER_ST: ConfiguredOverSt = { tarief: "50.00", toll: null, tunnel: "0.00" };

      async function overStOf(
        legDates: { first: string | null; second: string | null },
        configured: ConfiguredOverSt = OVER_ST,
        priced: "first" | "second" = "second",
      ) {
        const [first, second] = pair(
          { planningDate: legDates.first },
          { planningDate: legDates.second },
        );
        combinationPricing.findAll.mockResolvedValue([
          combination("combo-1", "Gent", configured),
        ]);

        return (
          await resolver.resolveRouteSelection(priced === "first" ? first : second)
        ).route?.overSt;
      }

      it("applies to Leg 2 planned on another day, unstated amounts as zero", async () => {
        expect(
          await overStOf({ first: "2026-08-17", second: "2026-08-18" }),
        ).toEqual({ tarief: "50.00", toll: "0.00", tunnel: "0.00" });
      });

      it("never applies to Leg 1", async () => {
        expect(
          await overStOf({ first: "2026-08-17", second: "2026-08-18" }, OVER_ST, "first"),
        ).toBeNull();
      });

      it("does not apply on the same day", async () => {
        expect(
          await overStOf({ first: "2026-08-17", second: "2026-08-17" }),
        ).toBeNull();
      });

      it("does not apply when a planningDate is missing", async () => {
        expect(await overStOf({ first: null, second: "2026-08-18" })).toBeNull();
        expect(logger.log).toHaveBeenCalledWith(
          "Combination matched by its pair of roads",
          expect.objectContaining({ overStApplies: false, overStReason: "DATE_MISSING" }),
        );
      });

      it("does not apply when the Combination has no Over ST configured", async () => {
        expect(
          await overStOf({ first: "2026-08-17", second: "2026-08-18" }, NO_OVER_ST),
        ).toBeNull();
        expect(logger.log).toHaveBeenCalledWith(
          "Combination matched by its pair of roads",
          expect.objectContaining({ overStApplies: false, overStReason: "NOT_CONFIGURED" }),
        );
      });

      it("applies when every amount is configured as zero", async () => {
        expect(
          await overStOf(
            { first: "2026-08-17", second: "2026-08-18" },
            { tarief: "0.00", toll: "0.00", tunnel: "0.00" },
          ),
        ).toEqual({ tarief: "0.00", toll: "0.00", tunnel: "0.00" });
      });
    });

    /** A leg's road decides the pair both legs are priced on. */
    describe("the Trips a road change reprices", () => {
      it("names the Trip and its same-document group members", async () => {
        const [first] = pair();

        expect(await resolver.tripsPricedByRoadOf(first)).toEqual([TRIP_ID, OTHER_TRIP_ID]);
      });

      /** Even a pair a direction change just made malformed: its price moves too. */
      it("names them whether or not the pair is genuine now", async () => {
        const [first] = pair({}, { direction: TripDirection.DELIVERY });

        expect(await resolver.tripsPricedByRoadOf(first)).toEqual([TRIP_ID, OTHER_TRIP_ID]);
      });

      it("leaves out a member of another document", async () => {
        const [first] = pair({}, { pdfDocumentId: "another-document" });

        expect(await resolver.tripsPricedByRoadOf(first)).toEqual([TRIP_ID]);
      });

      it("names only the Trip itself outside any group, reading nothing", async () => {
        expect(await resolver.tripsPricedByRoadOf(buildTrip())).toEqual([TRIP_ID]);
        expect(trips.findByGroupId).not.toHaveBeenCalled();
      });
    });

    /** Found by the same pair match, so the Trips named are the ones whose price moves. */
    describe("the Trips a planningDate change reprices", () => {
      it("names the partner when the Trip is Leg 1", async () => {
        const [first] = pair();
        combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Gent")]);

        expect(await resolver.legsPricedByPlanningDate(first)).toEqual([OTHER_TRIP_ID]);
      });

      it("names the Trip itself when it is Leg 2", async () => {
        const [, second] = pair();
        combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Gent")]);

        expect(await resolver.legsPricedByPlanningDate(second)).toEqual([OTHER_TRIP_ID]);
      });

      it("names nobody when the pair is not configured", async () => {
        const [first] = pair();
        combinationPricing.findAll.mockResolvedValue([combination("combo-1", "Brugge")]);

        expect(await resolver.legsPricedByPlanningDate(first)).toEqual([]);
      });

      it("names nobody for a Trip in no group", async () => {
        expect(await resolver.legsPricedByPlanningDate(buildTrip())).toEqual([]);
      });
    });
  });

  describe("distance-based base source", () => {
    const distanceRules = buildRules({
      strategy: PricingStrategy.DISTANCE_BASED,
    });

    it("returns the Trip distance and the configured rate, unmultiplied", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "132.50" }),
        distanceRules,
        null,
      );

      // 132.50 x 1.85 is the calculation phase's job, not this resolver's.
      expect(source).toEqual({
        strategy: PricingStrategy.DISTANCE_BASED,
        distanceKm: "132.50",
        ratePerKm: "1.85",
      });
    });

    it("fails when the Trip has no distance", async () => {
      await expect(
        resolver.resolveBaseSource(buildTrip(), distanceRules, null),
      ).rejects.toBeInstanceOf(MissingTripPricingInputException);
    });

    it("accepts a zero distance, which is a value rather than an absence", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "0.00" }),
        distanceRules,
        null,
      );

      expect(source).toMatchObject({ distanceKm: "0.00" });
    });

    it("never reads route pricing", async () => {
      await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "10.00" }),
        distanceRules,
        null,
      );

      expect(routePricingService.findAllOrdinary).not.toHaveBeenCalled();
    });

    it("propagates a missing distance-rate setting", async () => {
      const failure = new Error("missing rate");
      ruleResolver.resolveDistanceRatePerKm.mockRejectedValue(failure);

      await expect(
        resolver.resolveBaseSource(
          buildTrip({ distanceKm: "10.00" }),
          distanceRules,
          null,
        ),
      ).rejects.toBe(failure);
    });
  });

  /**
   * The Engine prices what a Trip CARRIES, not what the catalog offers. Reading
   * the catalog would have charged every Trip for every configured property.
   */
  /**
   * ── WHICH PROPERTIES A TRIP IS PRICED AGAINST ─────────────────────────────
   * Two sources, combined here and nowhere else:
   *
   *   what somebody assigned to the Trip, and
   *   the one property the Engine applies on its own — TAR.
   *
   * The automatic one is applied to every Trip EXCEPT the delivery leg of a
   * genuine Combination, so a Combination is charged for it exactly once. The
   * operator never has to tick it, and a tick left on the wrong leg cannot
   * produce a second charge: the assignments are overruled, not trusted.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("the properties a Trip is priced against", () => {
    /** The automatic property as it comes back from the resolver. */
    const AUTOMATIC = {
      customPropertyId: AUTOMATIC_PROPERTY_ID,
      name: "TAR",
      pricingComponentId: null,
      defaultPrice: "20.00",
    };

    function resolve(trip: TripReadView = buildTrip()) {
      return resolver.resolveAssignedCustomProperties(trip, buildRules());
    }

    it("asks for this Trip's assignments", async () => {
      await resolve();

      expect(tripCustomProperties.findByTripId).toHaveBeenCalledWith(
        TRIP_ID,
      );
    });

    it("applies the automatic property to a Trip that carries nothing", async () => {
      expect(await resolve()).toEqual([AUTOMATIC]);
    });

    /**
     * ── THE TAR-NUMMER IS THE TRIGGER ───────────────────────────────────────
     * The charge used to follow from the Trip existing. It now follows from the
     * operator having written the number down, because that number is what the
     * charge refers to: a TAR line nobody recorded a number for is a line no
     * invoice can be checked against.
     *
     * Whitespace is absence — `hasTarNummer` owns that definition, shared with
     * the DTO, the group rule and the WhatsApp caption.
     */
    describe("only when the Trip states a TAR-nummer", () => {
      it.each([
        ["null", null],
        ["an empty string", ""],
        ["spaces", "   "],
        ["a tab", "\t"],
        ["a newline", "\n"],
        ["mixed whitespace", " \t "],
      ])("charges nothing for %s", async (_label, tarNummer) => {
        expect(await resolve(buildTrip({ tarNummer }))).toEqual([]);
      });

      it("charges when a number is stated", async () => {
        expect(await resolve(buildTrip({ tarNummer: "TAR123" }))).toEqual([
          AUTOMATIC,
        ]);
      });

      /** No format is enforced here either: any non-blank text is stated. */
      it.each(["TAR123", "12345", "tar/2026 nr 7", "  padded  "])(
        "accepts %p as stated",
        async (tarNummer) => {
          expect(await resolve(buildTrip({ tarNummer }))).toEqual([AUTOMATIC]);
        },
      );

      /**
       * A stale tick from before this rule existed must not resurrect the
       * charge: the assignments are overruled, not trusted.
       */
      /**
       * A manual TAR is an EXTRA charge and stands on its own. It used to be
       * stripped here — the automatic rule overruled every assignment of the
       * same property — and the business now wants the operator's deliberate
       * one kept, whether or not the Trip states a number.
       */
      it("keeps a manual assignment when no number is stated", async () => {
        tripCustomProperties.findByTripId.mockResolvedValue([
          {
            customPropertyId: AUTOMATIC_PROPERTY_ID,
            name: "TAR",
            pricingComponentId: null,
            defaultPrice: "20.00",
          },
        ]);

        const resolved = await resolve(buildTrip({ tarNummer: null }));

        expect(resolved).toHaveLength(1);
        expect(resolved[0].customPropertyId).toBe(AUTOMATIC_PROPERTY_ID);
      });

      /** Other properties are untouched by the TAR precondition. */
      it("still prices the Trip's own properties", async () => {
        tripCustomProperties.findByTripId.mockResolvedValue([
          {
            customPropertyId: "property-flat",
            name: "Flat",
            pricingComponentId: null,
            defaultPrice: "20.00",
          },
        ]);

        const resolved = await resolve(buildTrip({ tarNummer: null }));

        expect(resolved.map((property) => property.name)).toEqual(["Flat"]);
      });
    });

    it("takes its amount from the configured property, never from a literal", async () => {
      customPropertyService.findById.mockResolvedValue({
        id: AUTOMATIC_PROPERTY_ID,
        name: "TAR",
        pricingComponentId: null,
        defaultPrice: "24.50",
      });

      const resolved = await resolve();

      expect(resolved[0].defaultPrice).toBe("24.50");
      expect(customPropertyService.findById).toHaveBeenCalledWith(
        AUTOMATIC_PROPERTY_ID,
      );
    });

    it("carries everything a later calculator needs, so it never looks anything up", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([
        assignment("property-flat", "Flat", null, "35.00"),
        assignment("property-toll", "Toll", "component-toll", null),
      ]);

      expect(await resolve()).toEqual([
        {
          customPropertyId: "property-flat",
          name: "Flat",
          pricingComponentId: null,
          defaultPrice: "35.00",
        },
        {
          customPropertyId: "property-toll",
          name: "Toll",
          pricingComponentId: "component-toll",
          defaultPrice: null,
        },
        AUTOMATIC,
      ]);
    });

    /**
     * An automatically assigned Flat is priced like any other property.
     *
     * That is the point of storing it as an ordinary assignment rather than
     * applying it during the calculation the way TAR is applied: the Engine has
     * no idea a rule put it there, needs no rule of its own, and reads the
     * configured amount exactly as it does for a property somebody ticked.
     *
     * The amount below is a configured value the test supplies, never a literal
     * the code carries — change the configuration and the line changes with it.
     */
    it("carries an automatically assigned Flat at its configured price", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([
        assignment("property-flat", "Flat", null, "80.00"),
      ]);

      const resolved = await resolve();

      expect(resolved).toContainEqual({
        customPropertyId: "property-flat",
        name: "Flat",
        pricingComponentId: null,
        defaultPrice: "80.00",
      });
    });

    /*
     * A manual and an automatic Flat cost the same, and now they cannot differ
     * even by accident: WHERE an assignment came from does not reach pricing at
     * all. The read side returns four fields, `isAutomatic` is not one of them,
     * so there is no provenance for a calculator to branch on.
     */
    it("cannot see where an assignment came from", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([
        assignment("property-flat", "Flat", null, "80.00"),
      ]);

      const flat = (await resolve()).find(
        (property) => property.customPropertyId === "property-flat",
      );

      expect(Object.keys(flat as object).sort()).toEqual([
        "customPropertyId",
        "defaultPrice",
        "name",
        "pricingComponentId",
      ]);
    });

    it("charges an automatically assigned Flat exactly once", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([
        assignment("property-flat", "Flat", null, "80.00"),
      ]);

      const resolved = await resolve();

      expect(
        resolved.filter((property) => property.name === "Flat"),
      ).toHaveLength(1);
    });

    it("keeps a property that has since been deactivated", async () => {
      // The Trip carries it. Withdrawing a property from the catalog must not
      // silently change what an already-planned Trip is charged.
      tripCustomProperties.findByTripId.mockResolvedValue([assignment("property-flat", "Flat", null, "35.00")]);

      const resolved = await resolve();

      expect(resolved.map((property) => property.customPropertyId)).toEqual([
        "property-flat",
        AUTOMATIC_PROPERTY_ID,
      ]);
    });

    /**
     * TWICE when it was also assigned by hand: the automatic charge and the
     * operator's extra one are independent amounts for independent reasons.
     * €20 + €20 = €40, and neither suppresses the other.
     */
    it("charges it twice when it was also assigned by hand", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

      const resolved = await resolve();

      expect(
        resolved.filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ),
      ).toHaveLength(2);
    });

    /** Assigning it by hand changes nothing about the automatic decision. */
    it("still applies the automatic charge on its own", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([]);

      const resolved = await resolve();

      expect(
        resolved.filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ),
      ).toHaveLength(1);
    });

    it("never reads the catalog for the properties a Trip carries", async () => {
      await resolve();

      // Exactly one catalog read, and it is the automatic property by id.
      expect(customPropertyService.findById).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * ── CHANGING THE RULE CHANGES NO STORED SNAPSHOT ──────────────────────────
   * A snapshot is a record of what WAS charged. This resolver only ever answers
   * a question the Engine asks while calculating, and it holds nothing it could
   * write with: no snapshot repository, no pricing-item repository, no Prisma.
   *
   * So a Trip closed under the old rule keeps its TAR line until an
   * administrator asks for a reprocess, which is the one path that applies the
   * current rules. That is asserted structurally here, because the alternative
   * — a background job quietly restating finished work — is exactly what must
   * never exist.
   */
  describe("stored pricing", () => {
    it("has no way to write anything", () => {
      const collaborators = Object.keys(resolver as unknown as object);

      expect(collaborators).toEqual([
        "routePricingService",
        // Read-only: the Combination configured for a pair of roads.
        "combinationPricing",
        "tripCustomProperties",
        "customPropertyService",
        "trips",
        "ruleResolver",
        // The same-day TAR check. Read-only by construction — see
        // `tar-charge-read.repository.spec.ts`, which pins that it exposes no
        // create, update or delete, and that it selects an id and nothing else.
        "tarCharges",
        "logger",
      ]);
    });

    /** Resolving is a read: the same Trip resolved twice writes nothing. */
    it("only reads when it answers", async () => {
      const trip = buildTrip({ tarNummer: "TAR123" });

      await resolver.resolveAssignedCustomProperties(trip, buildRules());
      await resolver.resolveAssignedCustomProperties(trip, buildRules());

      expect(tripCustomProperties.findByTripId).toHaveBeenCalled();
      expect(customPropertyService.findById).toHaveBeenCalled();
    });
  });

  /**
   * ── A GENUINE COMBINATION PAYS IT ONCE, ON THE COLLECTION ─────────────────
   * The two legs of one transport order are one movement. The collection leg
   * carries the charge; the delivery leg does not.
   *
   * A Combination is recognised from persisted evidence only: the legs share a
   * group AND the document that created them. A manual group is not one.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("the automatic property on a Combination", () => {
    const GROUP_ID = "97777777-7777-4777-8777-777777777777";
    const DOCUMENT_ID = "pdf-combination";

    const DELIVERY_LEG = buildTrip({
      id: "trip-delivery",
      tripGroupId: GROUP_ID,
      pdfDocumentId: DOCUMENT_ID,
      direction: TripDirection.DELIVERY,
    });

    const COLLECTION_LEG = buildTrip({
      id: "trip-collection",
      tripGroupId: GROUP_ID,
      pdfDocumentId: DOCUMENT_ID,
      direction: TripDirection.COLLECTION,
    });

    function groupOf(...members: TripReadView[]) {
      trips.findByGroupId.mockResolvedValue(members);
    }

    function resolve(trip: TripReadView) {
      return resolver.resolveAssignedCustomProperties(trip, buildRules());
    }

    function hasAutomatic(properties: { customPropertyId: string }[]) {
      return properties.some(
        (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
      );
    }

    it("charges it on the delivery leg", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);

      expect(hasAutomatic(await resolve(DELIVERY_LEG))).toBe(true);
    });

    /**
     * ── THE PAIR MUST STATE A NUMBER TOO ────────────────────────────────────
     * The allocation rule is untouched — the delivery leg is still the one that
     * owes it, and still only once. What changed is that there has to be
     * something to allocate.
     *
     * The group rule copies one TAR-nummer onto both legs, so in practice they
     * agree; these assert the outcome for each leg independently rather than
     * relying on that.
     */
    describe("and the group states a TAR-nummer", () => {
      const withNumber = (trip: TripReadView, tarNummer: string | null) => ({
        ...trip,
        tarNummer,
      });

      it("charges the pair exactly once when both legs carry it", async () => {
        const delivery = withNumber(DELIVERY_LEG, "TAR123");
        const collection = withNumber(COLLECTION_LEG, "TAR123");

        groupOf(delivery, collection);

        const charges = [
          ...(await resolve(delivery)),
          ...(await resolve(collection)),
        ].filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        );

        expect(charges).toHaveLength(1);
      });

      it("charges neither leg when the group states none", async () => {
        const delivery = withNumber(DELIVERY_LEG, null);
        const collection = withNumber(COLLECTION_LEG, null);

        groupOf(delivery, collection);

        expect(hasAutomatic(await resolve(delivery))).toBe(false);
        expect(hasAutomatic(await resolve(collection))).toBe(false);
      });

      it.each([
        ["an empty string", ""],
        ["spaces", "   "],
        ["a tab", "\t"],
      ])("charges neither leg for %s", async (_label, tarNummer) => {
        const delivery = withNumber(DELIVERY_LEG, tarNummer);
        const collection = withNumber(COLLECTION_LEG, tarNummer);

        groupOf(delivery, collection);

        expect(hasAutomatic(await resolve(delivery))).toBe(false);
        expect(hasAutomatic(await resolve(collection))).toBe(false);
      });

      /* The collection leg is refused by allocation, not by the number. */
      it("still refuses the collection leg even when it states one", async () => {
        const delivery = withNumber(DELIVERY_LEG, "TAR123");
        const collection = withNumber(COLLECTION_LEG, "TAR123");

        groupOf(delivery, collection);

        expect(hasAutomatic(await resolve(collection))).toBe(false);
      });
    });

    it("does not charge it on the collection leg", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);

      expect(hasAutomatic(await resolve(COLLECTION_LEG))).toBe(false);
    });

    /* Exactly one charge for the pair, whichever leg is priced first. */
    it("charges the pair exactly once", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);

      const delivery = await resolve(DELIVERY_LEG);
      const collection = await resolve(COLLECTION_LEG);

      expect(
        [...delivery, ...collection].filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ),
      ).toHaveLength(1);
    });

    /**
     * The ALLOCATION is unchanged: the collection leg never owes the automatic
     * charge. What it may now carry is an operator's own extra TAR, which is a
     * decision about that leg and not a second automatic charge — so the
     * property is present, but only once, and the delivery leg still owes its
     * automatic one independently.
     */
    it("gives the collection leg only what was assigned to it", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

      const collection = await resolve(COLLECTION_LEG);

      expect(
        collection.filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ),
      ).toHaveLength(1);
    });

    /** With nothing assigned, the collection leg owes nothing at all. */
    it("charges the collection leg nothing when it was assigned nothing", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([]);

      expect(hasAutomatic(await resolve(COLLECTION_LEG))).toBe(false);
    });

    /**
     * Both legs assigned it by hand: each keeps its own extra, and only the
     * DELIVERY leg additionally owes the automatic one. So the pair carries
     * three contributions, not two automatic ones — a manual assignment can
     * never create a second automatic charge.
     */
    it("adds the automatic charge only to the delivery leg", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

      const delivery = await resolve(DELIVERY_LEG);
      const collection = await resolve(COLLECTION_LEG);

      const countOn = (resolved: { customPropertyId: string }[]) =>
        resolved.filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ).length;

      expect(countOn(delivery)).toBe(2);
      expect(countOn(collection)).toBe(1);
    });

    it("charges once when neither leg was assigned it", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([]);

      expect(hasAutomatic(await resolve(DELIVERY_LEG))).toBe(true);
      expect(hasAutomatic(await resolve(COLLECTION_LEG))).toBe(false);
    });

    it("uses the configured price on the leg that pays", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      customPropertyService.findById.mockResolvedValue({
        id: AUTOMATIC_PROPERTY_ID,
        name: "TAR",
        pricingComponentId: null,
        defaultPrice: "24.50",
      });

      const [property] = await resolve(DELIVERY_LEG);

      expect(property.defaultPrice).toBe("24.50");
    });

    /*
     * A manual group is not a Combination. Its Trips came from different
     * documents — or none — and each is an ordinary transport that owes the
     * charge on its own.
     */
    it("treats a manual group as ordinary Trips", async () => {
      const first = buildTrip({
        id: "trip-a",
        tripGroupId: GROUP_ID,
        pdfDocumentId: "pdf-a",
        direction: TripDirection.COLLECTION,
      });
      const second = buildTrip({
        id: "trip-b",
        tripGroupId: GROUP_ID,
        pdfDocumentId: "pdf-b",
        direction: TripDirection.COLLECTION,
      });
      groupOf(first, second);

      expect(hasAutomatic(await resolve(first))).toBe(true);
      expect(hasAutomatic(await resolve(second))).toBe(true);
    });

    it("treats a grouped Trip with no document as an ordinary Trip", async () => {
      const manual = buildTrip({
        id: "trip-manual",
        tripGroupId: GROUP_ID,
        pdfDocumentId: null,
        direction: null,
      });
      groupOf(manual, COLLECTION_LEG);

      expect(hasAutomatic(await resolve(manual))).toBe(true);
    });

    it("reads no group at all for a Trip that is in none", async () => {
      await resolve(buildTrip());

      expect(trips.findByGroupId).not.toHaveBeenCalled();
    });

    /*
     * One document, grouped, and yet not one delivery and one collection. The
     * Engine used to refuse the whole calculation here, which since the Backload
     * follows plain membership took a charge off the Trip that was never in
     * doubt. The group is not a genuine pair, so each Trip owes TAR on its own
     * exactly as a member of a manual group does.
     */
    it("prices a pair from one document that is not one of each", async () => {
      const twinA = buildTrip({
        id: "trip-twin-a",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.COLLECTION,
      });
      const twinB = buildTrip({
        id: "trip-twin-b",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.COLLECTION,
      });
      groupOf(twinA, twinB);

      expect(hasAutomatic(await resolve(twinA))).toBe(true);
      expect(hasAutomatic(await resolve(twinB))).toBe(true);
    });

    it("prices a pair from one document that states no direction", async () => {
      const first = buildTrip({
        id: "trip-none-a",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: null,
      });
      const second = buildTrip({
        id: "trip-none-b",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: null,
      });
      groupOf(first, second);

      expect(hasAutomatic(await resolve(first))).toBe(true);
      expect(hasAutomatic(await resolve(second))).toBe(true);
    });

    /** Whatever shape the group has, the answer is a list — never a refusal. */
    it("refuses no malformed group at all", async () => {
      const twinA = buildTrip({
        id: "trip-twin-a",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.COLLECTION,
      });
      groupOf(twinA, twinA);

      await expect(resolve(twinA)).resolves.toBeInstanceOf(Array);
    });
  });
});
