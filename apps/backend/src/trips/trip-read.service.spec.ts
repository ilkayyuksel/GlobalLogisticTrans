import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripReadRepository } from "./trip-read.repository";
import { TripReadService } from "./trip-read.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GROUP_ID = "97777777-7777-4777-8777-777777777777";

/**
 * The narrow Trip read side.
 *
 * ── WHY IT IS TESTED AT ALL ─────────────────────────────────────────────────
 * It exists to break a cycle: the Pricing Engine has to read Trips, and the
 * Trip domain has to call the Engine after a waiting-time change. Two things
 * about it are therefore load-bearing, and both are asserted here.
 *
 *   1. it reads the ELEVEN engine columns and no others. A `select` that grew
 *      would let pricing quietly start depending on a field nobody decided it
 *      should — the whole point of a narrow read is that widening it is a
 *      deliberate act;
 *   2. it converts to the exact decimal text the calculation context is defined
 *      in. Money and distances never travel as floats in this system, and doing
 *      the conversion once here is what stops every caller repeating it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Exactly the columns the Engine is allowed to depend on. */
const ENGINE_COLUMNS = [
  "bookingNumber",
  "destinationCity",
  "direction",
  "distanceKm",
  "id",
  "pdfDocumentId",
  "planningDate",
  "status",
  "terminal",
  "tripGroupId",
  "waitingTimeMinutes",
];

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    bookingNumber: "ANRDUB2602247",
    status: TripStatus.CLOSED,
    direction: TripDirection.DELIVERY,
    terminal: "Quay 869",
    destinationCity: "Dourges",
    planningDate: new Date("2026-08-17T00:00:00Z"),
    distanceKm: new Prisma.Decimal("132.50"),
    waitingTimeMinutes: 135,
    tripGroupId: null,
    pdfDocumentId: "pdf-1",
    ...overrides,
  };
}

describe("TripReadRepository", () => {
  let prisma: { trip: { findUnique: jest.Mock; findMany: jest.Mock } };
  let repository: TripReadRepository;

  beforeEach(() => {
    prisma = {
      trip: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    repository = new TripReadRepository(prisma as unknown as PrismaService);
  });

  it("selects exactly the engine columns when reading one Trip", async () => {
    await repository.findById(TRIP_ID);

    const [{ select }] = prisma.trip.findUnique.mock.calls[0];

    expect(Object.keys(select).sort()).toEqual(ENGINE_COLUMNS);
    expect(Object.values(select).every((included) => included === true)).toBe(
      true,
    );
  });

  it("reads one Trip by primary key", async () => {
    await repository.findById(TRIP_ID);

    expect(prisma.trip.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TRIP_ID } }),
    );
  });

  it("selects the same columns when reading a group", async () => {
    await repository.findByGroupId(GROUP_ID);

    const [{ select, where }] = prisma.trip.findMany.mock.calls[0];

    expect(where).toEqual({ tripGroupId: GROUP_ID });
    expect(Object.keys(select).sort()).toEqual(ENGINE_COLUMNS);
  });

  /*
   * No vehicle, no driver, no assignments, no snapshot. Each of those would be
   * a join the Engine never asked for, and one of them — the pricing snapshot —
   * would make the read circular in spirit if not in imports.
   */
  it("joins nothing", async () => {
    await repository.findById(TRIP_ID);
    await repository.findByGroupId(GROUP_ID);

    for (const [{ include }] of [
      ...prisma.trip.findUnique.mock.calls,
      ...prisma.trip.findMany.mock.calls,
    ]) {
      expect(include).toBeUndefined();
    }
  });
});

describe("TripReadService", () => {
  let repository: { findById: jest.Mock; findByGroupId: jest.Mock };
  let service: TripReadService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(buildRow()),
      findByGroupId: jest.fn().mockResolvedValue([buildRow()]),
    };

    service = new TripReadService(repository as unknown as TripReadRepository);
  });

  it("returns the engine shape and nothing else", async () => {
    const trip = await service.findById(TRIP_ID);

    expect(Object.keys(trip as object).sort()).toEqual(ENGINE_COLUMNS);
  });

  /** A DATE column has no time and no timezone; it leaves as the day it holds. */
  it("renders the planning date as a calendar day", async () => {
    expect((await service.findById(TRIP_ID))?.planningDate).toBe("2026-08-17");
  });

  /** NUMERIC(8,2), so it leaves as exact decimal text rather than as a float. */
  it("renders the distance as a fixed-2 string", async () => {
    expect((await service.findById(TRIP_ID))?.distanceKm).toBe("132.50");
  });

  /*
   * Explicit null checks, not truthiness: a distance of exactly zero is a
   * value an operator entered, and a Trip with no date is a Trip nobody has
   * scheduled yet. Reading either as "absent" would change what is priced.
   */
  it("keeps a zero distance as a value rather than as an absence", async () => {
    repository.findById.mockResolvedValue(
      buildRow({ distanceKm: new Prisma.Decimal("0.00") }),
    );

    expect((await service.findById(TRIP_ID))?.distanceKm).toBe("0.00");
  });

  it("reports absent scalars as null", async () => {
    repository.findById.mockResolvedValue(
      buildRow({
        planningDate: null,
        distanceKm: null,
        waitingTimeMinutes: null,
        bookingNumber: null,
        terminal: null,
        destinationCity: null,
        direction: null,
      }),
    );

    const trip = await service.findById(TRIP_ID);

    expect(trip).toEqual({
      id: TRIP_ID,
      bookingNumber: null,
      status: TripStatus.CLOSED,
      direction: null,
      terminal: null,
      destinationCity: null,
      planningDate: null,
      distanceKm: null,
      waitingTimeMinutes: null,
      tripGroupId: null,
      pdfDocumentId: "pdf-1",
    });
  });

  /**
   * Null rather than a 404: this service has no transport. The Engine reports
   * absence as a pricing-domain failure and the pricing API as a Trip that does
   * not exist — two different answers, from one honest null.
   */
  it("answers null for a Trip that does not exist", async () => {
    repository.findById.mockResolvedValue(null);

    expect(await service.findById(TRIP_ID)).toBeNull();
  });

  it("maps every member of a group through the same shape", async () => {
    repository.findByGroupId.mockResolvedValue([
      buildRow({ id: "trip-delivery", direction: TripDirection.DELIVERY }),
      buildRow({ id: "trip-collection", direction: TripDirection.COLLECTION }),
    ]);

    const members = await service.findByGroupId(GROUP_ID);

    expect(members.map((member) => member.direction)).toEqual([
      TripDirection.DELIVERY,
      TripDirection.COLLECTION,
    ]);
    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual(ENGINE_COLUMNS);
    }
  });

  it("answers an empty list for a group with no members", async () => {
    repository.findByGroupId.mockResolvedValue([]);

    expect(await service.findByGroupId(GROUP_ID)).toEqual([]);
  });
});
