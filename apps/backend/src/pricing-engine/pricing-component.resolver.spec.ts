import { TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import {
  InvalidCombinationForPricingException,
  MissingTripPricingInputException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingRuleConfiguration } from "./pricing-calculation-context";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** The Custom Property the Engine applies on its own — TAR in this system. */
const AUTOMATIC_PROPERTY_ID = "property-tar";
const ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

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
  notes: null,
  isActive: true,
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
  let routePricingService: { findActiveRoute: jest.Mock };
  let tripCustomProperties: { findByTripId: jest.Mock };
  let ruleResolver: { resolveDistanceRatePerKm: jest.Mock };
  let customPropertyService: { findById: jest.Mock };
  let trips: { findByGroupId: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let tarCharges: { hasBeenChargedToday: jest.Mock };
  let resolver: PricingComponentResolver;

  beforeEach(() => {
    routePricingService = {
      findActiveRoute: jest.fn().mockResolvedValue(ROUTE_PRICING),
    };
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
      tripCustomProperties as unknown as TripCustomPropertyReadService,
      customPropertyService as unknown as CustomPropertyService,
      trips as unknown as TripReadService,
      ruleResolver as unknown as PricingRuleResolver,
      tarCharges as never,
      logger as unknown as AppLoggerService,
    );
  });

  describe("route-based base source", () => {
    it("looks the route up by terminal and destination city", async () => {
      await resolver.resolveBaseSource(buildTrip(), buildRules());

      expect(routePricingService.findActiveRoute).toHaveBeenCalledWith(
        "Antwerp",
        "Rotterdam",
      );
    });

    it("returns the configured base price as an exact string", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip(),
        buildRules(),
      );

      expect(source).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        routePricingId: ROUTE_ID,
        basePrice: "380.00",
      });
    });

    it("carries no route, which belongs to the Trip rather than the strategy", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip(),
        buildRules(),
      );

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
      routePricingService.findActiveRoute.mockResolvedValue(null);

      const source = await resolver.resolveBaseSource(
        buildTrip(),
        buildRules(),
      );

      expect(source).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        routePricingId: null,
        basePrice: "0.00",
      });
    });

    /** Half a route matches no configuration, so it takes the same answer. */
    it("prices at zero when the Trip has no terminal", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ terminal: null }),
        buildRules(),
      );

      expect(source).toMatchObject({ basePrice: "0.00", routePricingId: null });
      expect(routePricingService.findActiveRoute).not.toHaveBeenCalled();
    });

    it("prices at zero when the Trip has no destination", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ destinationCity: null }),
        buildRules(),
      );

      expect(source).toMatchObject({ basePrice: "0.00", routePricingId: null });
      expect(routePricingService.findActiveRoute).not.toHaveBeenCalled();
    });

    /** The gap is still reported, so an administrator can close it. */
    it("says so in the log rather than passing over it", async () => {
      routePricingService.findActiveRoute.mockResolvedValue(null);

      await resolver.resolveBaseSource(buildTrip(), buildRules());

      expect(logger.warn).toHaveBeenCalledWith(
        "No active route pricing; the Trip prices at zero",
        { tripId: TRIP_ID },
      );
    });

    it("never reads the distance rate", async () => {
      await resolver.resolveBaseSource(buildTrip(), buildRules());

      expect(ruleResolver.resolveDistanceRatePerKm).not.toHaveBeenCalled();
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
        resolver.resolveBaseSource(buildTrip(), distanceRules),
      ).rejects.toBeInstanceOf(MissingTripPricingInputException);
    });

    it("accepts a zero distance, which is a value rather than an absence", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "0.00" }),
        distanceRules,
      );

      expect(source).toMatchObject({ distanceKm: "0.00" });
    });

    it("never reads route pricing", async () => {
      await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "10.00" }),
        distanceRules,
      );

      expect(routePricingService.findActiveRoute).not.toHaveBeenCalled();
    });

    it("propagates a missing distance-rate setting", async () => {
      const failure = new Error("missing rate");
      ruleResolver.resolveDistanceRatePerKm.mockRejectedValue(failure);

      await expect(
        resolver.resolveBaseSource(
          buildTrip({ distanceKm: "10.00" }),
          distanceRules,
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
      it("ignores a manual assignment when no number is stated", async () => {
        tripCustomProperties.findByTripId.mockResolvedValue([
          {
            customPropertyId: AUTOMATIC_PROPERTY_ID,
            name: "TAR",
            pricingComponentId: null,
            defaultPrice: "20.00",
          },
        ]);

        expect(await resolve(buildTrip({ tarNummer: null }))).toEqual([]);
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

    it("charges it once when it was also assigned by hand", async () => {
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

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

    it("ignores a stale assignment left on the collection leg", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

      expect(hasAutomatic(await resolve(COLLECTION_LEG))).toBe(false);
    });

    it("charges once when both legs were assigned it by hand", async () => {
      groupOf(DELIVERY_LEG, COLLECTION_LEG);
      tripCustomProperties.findByTripId.mockResolvedValue([assignment(AUTOMATIC_PROPERTY_ID, "TAR", null, "20.00")]);

      const delivery = await resolve(DELIVERY_LEG);
      const collection = await resolve(COLLECTION_LEG);

      expect(hasAutomatic(collection)).toBe(false);
      expect(
        delivery.filter(
          (property) => property.customPropertyId === AUTOMATIC_PROPERTY_ID,
        ),
      ).toHaveLength(1);
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
     * One document, grouped, and yet not one delivery and one collection. No
     * real order produces this, so it is refused rather than priced on a guess
     * about which leg should carry the charge.
     */
    it("refuses a pair from one document that is not one of each", async () => {
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

      await expect(resolve(twinA)).rejects.toBeInstanceOf(
        InvalidCombinationForPricingException,
      );
    });

    it("refuses a pair from one document that states no direction", async () => {
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

      await expect(resolve(first)).rejects.toBeInstanceOf(
        InvalidCombinationForPricingException,
      );
    });

    it("names the group and what it found when it refuses", async () => {
      const twinA = buildTrip({
        id: "trip-twin-a",
        tripGroupId: GROUP_ID,
        pdfDocumentId: DOCUMENT_ID,
        direction: TripDirection.COLLECTION,
      });
      groupOf(twinA, twinA);

      await expect(resolve(twinA)).rejects.toThrow(GROUP_ID);
    });
  });
});
