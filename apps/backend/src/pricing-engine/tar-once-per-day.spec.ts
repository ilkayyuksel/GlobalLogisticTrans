import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingStrategy } from "./pricing-settings";
import { TarChargeReadRepository } from "./tar-charge-read.repository";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const GROUP_ID = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";

/**
 * ONE TAR NUMBER IS CHARGED ONCE PER OPERATIONAL DAY.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A TAR-nummer is not globally unique. Several Trips legitimately carry the
 * same one, and the €50 belongs to the FIRST of them that was actually priced;
 * the rest state the number without paying for it again.
 *
 * ── WHAT "ALREADY CHARGED" MEANS, AND WHAT IT DOES NOT ──────────────────────
 * A CHARGE — a pricing item naming the automatic property on another Trip of
 * that day. Deliberately NOT "another Trip carries the same string": a number
 * typed on a Trip nobody ever closed has been charged to nobody, and letting it
 * block a real Trip would lose the charge entirely. The distinction lives in
 * `TarChargeReadRepository`; what this file pins is that the resolver asks that
 * question, asks it with the right arguments, and obeys the answer.
 *
 * ── WHAT IS DELIBERATELY UNCHANGED ──────────────────────────────────────────
 * Eligibility and ALLOCATION. A Trip must still state a meaningful number, and
 * a genuine Combination still charges at most once, on the delivery leg. The
 * new rule only decides whether that one charge is due again today.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<TripReadView> = {}): TripReadView {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    status: "CLOSED",
    direction: null,
    bookingNumber: "ANRDUB2602247",
    terminal: "Quay 869",
    destinationCity: "Lokeren",
    planningDate: "2026-09-07",
    tarNummer: "TAR123",
    waitingTimeMinutes: null,
    distanceKm: null,
    ...overrides,
  } as TripReadView;
}

const RULES = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "50.00",
  automaticCustomPropertyId: TAR_ID,
  waitingTimeFreeMinutes: 120,
  waitingTimeThresholdMinutes: 150,
  waitingTimeBlockMinutes: 15,
  waitingTimeBlockPrice: "13.75",
  ruleVersion: "2026.1",
};

describe("TAR is charged once per day per number", () => {
  let tarCharges: { hasBeenChargedToday: jest.Mock };
  let groupMembers: jest.Mock;
  let resolver: PricingComponentResolver;

  beforeEach(() => {
    tarCharges = { hasBeenChargedToday: jest.fn().mockResolvedValue(false) };
    groupMembers = jest.fn().mockResolvedValue([]);

    resolver = new PricingComponentResolver(
      { findActiveRoute: jest.fn().mockResolvedValue(null) } as unknown as RoutePricingService,
      { findByTripId: jest.fn().mockResolvedValue([]) } as unknown as TripCustomPropertyReadService,
      {
        findById: jest.fn().mockResolvedValue({
          id: TAR_ID,
          name: "TAR",
          pricingComponentId: null,
          // Read from configuration, never a literal in the rule itself.
          defaultPrice: "50.00",
        }),
      } as unknown as CustomPropertyService,
      { findByGroupId: groupMembers } as unknown as TripReadService,
      { resolveDistanceRatePerKm: jest.fn() } as unknown as PricingRuleResolver,
      tarCharges as unknown as TarChargeReadRepository,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  /** Whether the resolved inputs contain the TAR property. */
  async function chargesTar(trip: TripReadView): Promise<boolean> {
    const resolved = await resolver.resolveAssignedCustomProperties(trip, RULES);

    return resolved.some((property) => property.customPropertyId === TAR_ID);
  }

  /**
   * ── RULE 1: eligibility, unchanged ──────────────────────────────────────
   * Pinned here beside the new rule so a change to one cannot quietly move the
   * other.
   */
  describe("stating a number at all", () => {
    it("charges TAR for a meaningful number", async () => {
      expect(await chargesTar(buildTrip({ tarNummer: "TAR123" }))).toBe(true);
    });

    it.each([
      ["null", null],
      ["an empty string", ""],
      ["whitespace only", "   "],
      ["a tab", "\t"],
    ])("charges nothing for %s", async (_label, tarNummer) => {
      expect(await chargesTar(buildTrip({ tarNummer }))).toBe(false);
    });

    /** No number, no question to ask: the day is never consulted. */
    it("does not even ask about the day when no number is stated", async () => {
      await chargesTar(buildTrip({ tarNummer: null }));

      expect(tarCharges.hasBeenChargedToday).not.toHaveBeenCalled();
    });

    it("charges the configured amount, whatever it is", async () => {
      const resolved = await resolver.resolveAssignedCustomProperties(
        buildTrip(),
        RULES,
      );

      expect(
        resolved.find((property) => property.customPropertyId === TAR_ID)
          ?.defaultPrice,
      ).toBe("50.00");
    });
  });

  describe("the same number, the same day", () => {
    it("charges the first Trip of the day", async () => {
      tarCharges.hasBeenChargedToday.mockResolvedValue(false);

      expect(await chargesTar(buildTrip())).toBe(true);
    });

    it("charges nothing once the number has been charged that day", async () => {
      tarCharges.hasBeenChargedToday.mockResolvedValue(true);

      expect(await chargesTar(buildTrip())).toBe(false);
    });

    /** Every other component is untouched: only TAR is withheld. */
    it("withholds only TAR", async () => {
      tarCharges.hasBeenChargedToday.mockResolvedValue(true);
      const other = {
        customPropertyId: "other-property",
        name: "Aan/Afkoppelen",
        pricingComponentId: null,
        defaultPrice: "25.00",
      };

      const resolver2 = resolver as unknown as {
        tripCustomProperties: { findByTripId: jest.Mock };
      };
      resolver2.tripCustomProperties.findByTripId.mockResolvedValue([other]);

      const resolved = await resolver.resolveAssignedCustomProperties(
        buildTrip(),
        RULES,
      );

      expect(resolved).toEqual([other]);
    });
  });

  /** The arguments the question is asked with are the rule's whole substance. */
  describe("how the day is asked about", () => {
    it("asks with this Trip's own planning date, excluded from itself", async () => {
      await chargesTar(buildTrip());

      expect(tarCharges.hasBeenChargedToday).toHaveBeenCalledWith({
        tripId: TRIP_ID,
        planningDate: new Date("2026-09-07T00:00:00.000Z"),
        tarNummer: "TAR123",
        automaticCustomPropertyId: TAR_ID,
      });
    });

    /** Trimmed, the same way `meaningfulTarNummer` defines a stated number. */
    it("asks about the trimmed number", async () => {
      await chargesTar(buildTrip({ tarNummer: "  TAR123  " }));

      expect(tarCharges.hasBeenChargedToday).toHaveBeenCalledWith(
        expect.objectContaining({ tarNummer: "TAR123" }),
      );
    });

    it("asks about a different day for a Trip planned on one", async () => {
      await chargesTar(buildTrip({ planningDate: "2026-09-08" }));

      expect(tarCharges.hasBeenChargedToday).toHaveBeenCalledWith(
        expect.objectContaining({
          planningDate: new Date("2026-09-08T00:00:00.000Z"),
        }),
      );
    });

    /**
     * A Trip nobody has scheduled is on no day, so there is no day to compare
     * against and the charge applies as it always did.
     */
    it("charges without asking when the Trip has no planning date", async () => {
      expect(await chargesTar(buildTrip({ planningDate: null }))).toBe(true);
      expect(tarCharges.hasBeenChargedToday).not.toHaveBeenCalled();
    });

    /** One question per pricing operation — never one per candidate Trip. */
    it("asks exactly once", async () => {
      await chargesTar(buildTrip());

      expect(tarCharges.hasBeenChargedToday).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * ── REPROCESS ───────────────────────────────────────────────────────────
   * A Trip's own historical charge must never be what stops it being charged
   * again. The exclusion is by Trip id and is passed on every call, so a
   * reprocess of the Trip that holds the charge still charges it.
   */
  describe("reprocessing", () => {
    it("excludes the Trip being priced from the search", async () => {
      await chargesTar(buildTrip());

      expect(tarCharges.hasBeenChargedToday).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_ID }),
      );
    });

    /**
     * Trip A holds the day's charge. Reprocessing A finds no OTHER Trip with
     * it, so A keeps its TAR.
     */
    it("keeps a Trip's own TAR when it is reprocessed", async () => {
      tarCharges.hasBeenChargedToday.mockImplementation(
        ({ tripId }: { tripId: string }) =>
          // Only the OTHER Trip holds a charge, and here we are pricing it.
          Promise.resolve(tripId !== OTHER_TRIP),
      );

      expect(await chargesTar(buildTrip({ id: OTHER_TRIP }))).toBe(true);
    });

    /**
     * Trip B never had TAR. Reprocessing B must still find A's charge and still
     * withhold it — the rule is re-evaluated, not remembered.
     */
    it("still withholds TAR when the other Trip's charge stands", async () => {
      tarCharges.hasBeenChargedToday.mockResolvedValue(true);

      expect(await chargesTar(buildTrip())).toBe(false);
    });
  });

  /**
   * ── COMBINATIONS ────────────────────────────────────────────────────────
   * Allocation is untouched. The COLLECTION leg of a genuine Combination owes
   * no TAR and never asks about the day; the DELIVERY leg owes it and is
   * subject to the same-day rule like any other Trip.
   */
  describe("a genuine Combination", () => {
    function genuinePair(): void {
      groupMembers.mockResolvedValue([
        { id: TRIP_ID, direction: "DELIVERY", pdfDocumentId: "pdf-1", tripGroupId: GROUP_ID },
        { id: OTHER_TRIP, direction: "COLLECTION", pdfDocumentId: "pdf-1", tripGroupId: GROUP_ID },
      ]);
    }

    it("charges the DELIVERY leg when the number is free that day", async () => {
      genuinePair();

      expect(
        await chargesTar(
          buildTrip({ tripGroupId: GROUP_ID, direction: "DELIVERY" }),
        ),
      ).toBe(true);
    });

    it("charges the COLLECTION leg nothing, as before", async () => {
      genuinePair();

      expect(
        await chargesTar(
          buildTrip({
            id: OTHER_TRIP,
            tripGroupId: GROUP_ID,
            direction: "COLLECTION",
          }),
        ),
      ).toBe(false);
    });

    /** The collection leg is excluded before the day is ever considered. */
    it("does not ask about the day for the COLLECTION leg", async () => {
      genuinePair();

      await chargesTar(
        buildTrip({
          id: OTHER_TRIP,
          tripGroupId: GROUP_ID,
          direction: "COLLECTION",
        }),
      );

      expect(tarCharges.hasBeenChargedToday).not.toHaveBeenCalled();
    });

    it("withholds the DELIVERY leg's TAR when the number is already charged", async () => {
      genuinePair();
      tarCharges.hasBeenChargedToday.mockResolvedValue(true);

      expect(
        await chargesTar(
          buildTrip({ tripGroupId: GROUP_ID, direction: "DELIVERY" }),
        ),
      ).toBe(false);
    });
  });
});
