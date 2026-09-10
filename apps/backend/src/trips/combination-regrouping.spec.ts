import { Prisma, Trip, TripDirection, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  combinationLegOf,
  isGenuineCombination,
} from "../pricing-engine/combination-leg";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import type { PricingRecalculationOutcome } from "../pricing-engine/pricing-recalculation.service";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * Grouping and ungrouping reprice the legs whose Combination they changed.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * A Trip's leg is decided by its group, and the leg decides the Backload and
 * which leg owes TAR. Grouping and ungrouping used to write `tripGroupId` and
 * nothing else, which left two stale prices behind, both reproduced on a real
 * stack before this was written:
 *
 *   a leg CLOSED before it joined a genuine Combination kept a price with no
 *   Backload, while its partner — closed afterwards — carried €50;
 *
 *   a leg taken OUT of a Combination kept its €50, as did the leg left behind.
 *
 * ── HOW THE ENGINE IS FAKED HERE, AND WHY ────────────────────────────────────
 * The recalculation answers with the REAL Combination rule applied to the
 * group as it is stored AT THE MOMENT it is called. So a recalculation that ran
 * before the membership was written would answer with the old group, and the
 * Backload assertions below would fail — the tests prove the ordering, not
 * just that a call happened.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "97777777-7777-4777-8777-777777777777";
const DOCUMENT = "pdf-combination";
const NO_ROUTE_PRICE = "PRICING_MISSING_ROUTE_PRICING";

function row(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    pdfDocumentId: DOCUMENT,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    isLooseTrip: false,
    isPaid: false,
    direction: null,
    bookingNumber: id,
    containerNumber: "PVDU3013260",
    containerType: "45RH",
    terminal: "Quay 869",
    destinationCity: "Kallo",
    destinationCountry: "Belgium",
    originalPlanningDate: new Date("2026-09-10T00:00:00.000Z"),
    planningDate: new Date("2026-09-10T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** The two legs of one transport order. */
const DELIVERY = row("leg-delivery", { direction: TripDirection.DELIVERY });
const COLLECTION = row("leg-collection", {
  direction: TripDirection.COLLECTION,
});
/** A Trip from ANOTHER order: grouping it makes a manual group. */
const STRANGER = row("other-order", {
  pdfDocumentId: "pdf-other",
  direction: TripDirection.COLLECTION,
});
/** Priced, CLOSED and in no group this spec touches. */
const UNRELATED = row("unrelated");

/** A breakdown as the effective read produces one, with or without Backload. */
function pricing(backload: string | null) {
  return toEffectivePricingDto(
    resolveEffectivePricing(
      [
        {
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("0.00"),
          customPropertyId: null,
          description: "Base",
          unitPrice: null,
        },
        ...(backload === null
          ? []
          : [
              {
                componentCode: "COMBINATION",
                amount: new Prisma.Decimal(backload),
                customPropertyId: null,
                description: "Combination surcharge",
                unitPrice: null,
              },
            ]),
      ],
      [],
    ),
  );
}

interface Harness {
  readonly service: TripService;
  readonly stored: Trip[];
  /** "begin", "commit" and "recalculate <id>", in the order they happened. */
  readonly journal: string[];
  /** The group each Trip was in at the moment it was recalculated. */
  readonly groupAtRecalculation: Map<string, string | null>;
  /** What each recalculation answered, by Trip id. */
  readonly answers: Map<string, PricingRecalculationOutcome>;
  readonly recalculated: () => string[];
}

function harness(
  initial: readonly Trip[],
  failWith: string | null = null,
): Harness {
  const stored = initial.map((trip) => ({ ...trip }));
  const journal: string[] = [];
  const groupAtRecalculation = new Map<string, string | null>();
  const answers = new Map<string, PricingRecalculationOutcome>();
  const find = (id: string) => stored.find((trip) => trip.id === id) as Trip;
  const copies = (trips: Trip[]) => trips.map((trip) => ({ ...trip }));

  const repository = {
    findById: jest.fn((id: string) =>
      Promise.resolve(
        stored.some((trip) => trip.id === id) ? { ...find(id) } : null,
      ),
    ),
    findManyByIds: jest.fn((ids: readonly string[]) =>
      Promise.resolve(copies(stored.filter((trip) => ids.includes(trip.id)))),
    ),
    findManyByGroupId: jest.fn((tripGroupId: string) =>
      Promise.resolve(
        copies(stored.filter((trip) => trip.tripGroupId === tripGroupId)),
      ),
    ),
    createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
    assignToGroup: jest.fn((ids: readonly string[], tripGroupId: string) => {
      for (const trip of stored) {
        if (ids.includes(trip.id)) {
          trip.tripGroupId = tripGroupId;
        }
      }

      return Promise.resolve(ids.length);
    }),
    update: jest.fn((id: string, data: Partial<Trip>) => {
      Object.assign(find(id), data);

      return Promise.resolve({ ...find(id) });
    }),
    runInTransaction: jest.fn(
      async (work: (scoped: unknown) => Promise<unknown>) => {
        journal.push("begin");
        const result = await work(repository);
        journal.push("commit");

        return result;
      },
    ),
  };

  const recalculation = stubPricingRecalculation();

  recalculation.recalculate.mockImplementation(
    (id: string): Promise<PricingRecalculationOutcome> => {
      journal.push(`recalculate ${id}`);
      groupAtRecalculation.set(id, find(id).tripGroupId);

      // The real rule, over the group exactly as it is stored right now.
      const leg = combinationLegOf(find(id), stored);
      const answer: PricingRecalculationOutcome =
        failWith === null
          ? {
              pricing: pricing(isGenuineCombination(leg) ? "50.00" : null),
              reasonCode: null,
            }
          : { pricing: null, reasonCode: failWith };

      answers.set(id, answer);

      return Promise.resolve(answer);
    },
  );

  // What the read returns before anything is repriced: no Backload.
  const planningOf = (trip: Trip) => ({
    vehicle: null,
    effectiveDriver: null,
    customProperties: [],
    latestUpdate: null,
    costConfirmation: null,
    pricing: trip.status === TripStatus.CLOSED ? pricing(null) : null,
  });

  const service = new TripService(
    repository as unknown as TripRepository,
    {} as unknown as VehicleService,
    {} as unknown as DriverService,
    {
      resolveOne: (trip: Trip) => Promise.resolve(planningOf(trip)),
      resolveMany: (trips: readonly Trip[]) =>
        Promise.resolve(
          new Map(trips.map((trip) => [trip.id, planningOf(trip)])),
        ),
    } as unknown as TripPlanningDataService,
    { synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
    recalculation,
    { publish: jest.fn() } as unknown as DomainEventBus,
    {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService,
  );

  return {
    service,
    stored,
    journal,
    groupAtRecalculation,
    answers,
    recalculated: () =>
      recalculation.recalculate.mock.calls.map(([id]) => id as string),
  };
}

function backloadOf(
  responses: readonly { id: string; pricing: { backload: string } | null }[],
  id: string,
): string | null {
  return (
    responses.find((response) => response.id === id)?.pricing?.backload ?? null
  );
}

describe("grouping reprices the legs it turns into a Combination", () => {
  describe("two CLOSED legs of one order", () => {
    it("reprices both, so each carries its €50 Backload", async () => {
      const { service, recalculated } = harness([
        DELIVERY,
        COLLECTION,
        UNRELATED,
      ]);

      const grouped = await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(recalculated().sort()).toEqual([COLLECTION.id, DELIVERY.id]);
      expect(backloadOf(grouped, DELIVERY.id)).toBe("50.00");
      expect(backloadOf(grouped, COLLECTION.id)).toBe("50.00");
    });

    /** Each leg is priced on its own — the Engine prices one Trip per call. */
    it("recalculates each leg exactly once", async () => {
      const { service, recalculated } = harness([DELIVERY, COLLECTION]);

      await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(recalculated()).toHaveLength(2);
      expect(new Set(recalculated()).size).toBe(2);
    });

    it("prices only after the group has committed", async () => {
      const { service, journal } = harness([DELIVERY, COLLECTION]);

      await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(journal.slice(0, 2)).toEqual(["begin", "commit"]);
      expect(journal.slice(2).sort()).toEqual([
        `recalculate ${COLLECTION.id}`,
        `recalculate ${DELIVERY.id}`,
      ]);
    });

    it("prices each leg with the NEW group, never the old membership", async () => {
      const { service, groupAtRecalculation } = harness([DELIVERY, COLLECTION]);

      await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(groupAtRecalculation.get(DELIVERY.id)).toBe(GROUP_ID);
      expect(groupAtRecalculation.get(COLLECTION.id)).toBe(GROUP_ID);
    });

    it("reprices nothing outside the group", async () => {
      const { service, recalculated } = harness([
        DELIVERY,
        COLLECTION,
        UNRELATED,
      ]);

      await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(recalculated()).not.toContain(UNRELATED.id);
    });
  });

  describe("legs on different days", () => {
    it("reprices both, and both carry €50", async () => {
      const dayTwo = {
        ...COLLECTION,
        planningDate: new Date("2026-09-11T00:00:00.000Z"),
      };
      const { service } = harness([DELIVERY, dayTwo]);

      const grouped = await service.createGroup([DELIVERY.id, dayTwo.id]);

      expect(backloadOf(grouped, DELIVERY.id)).toBe("50.00");
      expect(backloadOf(grouped, dayTwo.id)).toBe("50.00");
    });
  });

  describe("a CLOSED leg grouped with an OPEN one", () => {
    /*
     * The OPEN leg is priced when it closes, from the group it is in by then —
     * the existing lifecycle. Only the finished leg has a price to keep current.
     */
    it("reprices the CLOSED leg and leaves the OPEN one to its own close", async () => {
      const open = { ...COLLECTION, status: TripStatus.OPEN };
      const { service, recalculated } = harness([DELIVERY, open]);

      const grouped = await service.createGroup([DELIVERY.id, open.id]);

      expect(recalculated()).toEqual([DELIVERY.id]);
      expect(backloadOf(grouped, DELIVERY.id)).toBe("50.00");
      expect(grouped.find((trip) => trip.id === open.id)?.pricing).toBeNull();
    });
  });

  describe("a manual group", () => {
    it("reprices nobody: Trips of different orders are no Combination", async () => {
      const { service, recalculated } = harness([DELIVERY, STRANGER]);

      const grouped = await service.createGroup([DELIVERY.id, STRANGER.id]);

      expect(recalculated()).toEqual([]);
      expect(backloadOf(grouped, DELIVERY.id)).toBe("0.00");
    });

    it("reprices only the pair when a genuine pair joins a larger manual group", async () => {
      const { service, recalculated } = harness([
        DELIVERY,
        COLLECTION,
        STRANGER,
      ]);

      await service.createGroup([DELIVERY.id, COLLECTION.id, STRANGER.id]);

      expect(recalculated().sort()).toEqual([COLLECTION.id, DELIVERY.id]);
    });
  });

  describe("when a leg cannot be priced", () => {
    it("keeps the group and answers with the reason, never a stale price", async () => {
      const { service, stored } = harness([DELIVERY, COLLECTION], NO_ROUTE_PRICE);

      const grouped = await service.createGroup([DELIVERY.id, COLLECTION.id]);

      expect(stored.every((trip) => trip.tripGroupId === GROUP_ID)).toBe(true);
      expect(grouped.map((trip) => trip.pricing)).toEqual([null, null]);
      expect(grouped.map((trip) => trip.reasonCode)).toEqual([
        NO_ROUTE_PRICE,
        NO_ROUTE_PRICE,
      ]);
    });
  });
});

describe("ungrouping reprices the legs it takes out of a Combination", () => {
  const PAIR = [
    { ...DELIVERY, tripGroupId: GROUP_ID },
    { ...COLLECTION, tripGroupId: GROUP_ID },
  ];

  it("reprices the removed leg AND the leg left behind", async () => {
    const { service, recalculated } = harness([...PAIR, UNRELATED]);

    await service.removeFromGroup(DELIVERY.id);

    expect(recalculated().sort()).toEqual([COLLECTION.id, DELIVERY.id]);
  });

  it("takes the €50 off the removed leg", async () => {
    const { service, groupAtRecalculation } = harness(PAIR);

    const removed = await service.removeFromGroup(DELIVERY.id);

    expect(removed.tripGroupId).toBeNull();
    expect(groupAtRecalculation.get(DELIVERY.id)).toBeNull();
    expect(removed.pricing?.backload).toBe("0.00");
  });

  /** A lone leg is not a Combination, so its partner's €50 goes too. */
  it("takes the €50 off the leg left behind", async () => {
    const { service, groupAtRecalculation, answers } = harness(PAIR);

    await service.removeFromGroup(DELIVERY.id);

    // Still in the group — but alone in it, which is no Combination.
    expect(groupAtRecalculation.get(COLLECTION.id)).toBe(GROUP_ID);
    expect(answers.get(COLLECTION.id)?.pricing?.backload).toBe("0.00");
  });

  it("prices only after the removal has committed", async () => {
    const { service, journal } = harness(PAIR);

    await service.removeFromGroup(DELIVERY.id);

    expect(journal.slice(0, 2)).toEqual(["begin", "commit"]);
    expect(journal.slice(2)).toHaveLength(2);
  });

  it("reprices nobody when a stranger leaves a group that still holds the pair", async () => {
    const withStranger = [...PAIR, { ...STRANGER, tripGroupId: GROUP_ID }];
    const { service, recalculated } = harness(withStranger);

    await service.removeFromGroup(STRANGER.id);

    expect(recalculated()).toEqual([]);
  });

  it("reprices the pair, not the stranger, when a leg leaves a three-Trip group", async () => {
    const withStranger = [...PAIR, { ...STRANGER, tripGroupId: GROUP_ID }];
    const { service, recalculated } = harness(withStranger);

    await service.removeFromGroup(COLLECTION.id);

    expect(recalculated().sort()).toEqual([COLLECTION.id, DELIVERY.id]);
  });

  it("leaves an OPEN partner to its own close", async () => {
    const openPartner = [PAIR[0], { ...PAIR[1], status: TripStatus.OPEN }];
    const { service, recalculated } = harness(openPartner);

    await service.removeFromGroup(DELIVERY.id);

    expect(recalculated()).toEqual([DELIVERY.id]);
  });

  it("reprices nobody when leaving a manual group", async () => {
    const manual = [
      { ...DELIVERY, tripGroupId: GROUP_ID },
      { ...STRANGER, tripGroupId: GROUP_ID },
    ];
    const { service, recalculated } = harness(manual);

    await service.removeFromGroup(DELIVERY.id);

    expect(recalculated()).toEqual([]);
  });

  it("keeps the removal and reports the reason when a leg cannot be priced", async () => {
    const { service, stored } = harness(PAIR, NO_ROUTE_PRICE);

    const removed = await service.removeFromGroup(DELIVERY.id);

    expect(stored.find((trip) => trip.id === DELIVERY.id)?.tripGroupId).toBeNull();
    expect(removed.pricing).toBeNull();
    expect(removed.reasonCode).toBe(NO_ROUTE_PRICE);
  });
});
