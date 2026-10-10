import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { TripReadService } from "../trips/trip-read.service";
import { toRouteMatchView } from "./route-match-view";
import {
  TripPricingService,
  type ReplacePricingSnapshotCommand,
} from "./trip-pricing.service";
import { TripPricingRepository } from "./trip-pricing.repository";

/**
 * The route a snapshot was priced against, stored and read against a REAL
 * database: the migration's table, the cascade, the replace inside the
 * snapshot's own transaction, and the REPEATABLE READ read through the
 * driver adapter.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. See `cost-confirmation.concurrency.db.spec.ts`.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("the matched route of a snapshot, against a real database", () => {
  let client: PrismaClient;
  let repository: TripPricingRepository;
  let service: TripPricingService;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    repository = new TripPricingRepository(client as unknown as PrismaService);
    service = new TripPricingService(
      repository,
      { findById: (id: string) => Promise.resolve({ id }) } as unknown as TripReadService,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    );
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  async function closedTrip(): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status)
      VALUES (${`ANRDUB-${Date.now()}-${Math.random()}`}, 'CLOSED'::"trip_status")
      RETURNING id`;

    return id;
  }

  const leg = (position: number, isPricedLeg: boolean) => ({
    legPosition: position,
    isPricedLeg,
    routePricingId: position === 1 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
    departure: position === 1 ? "Quay 869" : "Mons",
    destination: position === 1 ? "Ghlin" : "Quay 869",
    matchMethod: "EXACT" as const,
  });

  function command(
    tripId: string,
    calculatedAt: Date,
    overrides: Partial<ReplacePricingSnapshotCommand> = {},
  ): ReplacePricingSnapshotCommand {
    return {
      tripId,
      totalPrice: new Prisma.Decimal("0.00"),
      calculatedAt,
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "test",
      calculationStatus: "CALCULATED",
      routePricingId: "22222222-2222-4222-8222-222222222222",
      routeMatch: "EXACT",
      combinationRouteGroupId: "33333333-3333-4333-8333-333333333333",
      routeLegs: [leg(1, false), leg(2, true)],
      items: [],
      ...overrides,
    };
  }

  it("stores both legs with the snapshot and reads them back in one read", async () => {
    const tripId = await closedTrip();

    await service.replaceSnapshot(command(tripId, new Date("2026-10-10T10:00:00Z")));
    const [snapshot] = await repository.findCurrentByTripIds([tripId]);

    expect(snapshot.combinationRouteGroupId).toBe("33333333-3333-4333-8333-333333333333");
    expect(toRouteMatchView(snapshot).legs.map((each) => [each.legPosition, each.isPricedLeg])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("replaces the legs with a newer calculation, leaving no stale leg", async () => {
    const tripId = await closedTrip();
    await service.replaceSnapshot(command(tripId, new Date("2026-10-10T10:00:00Z")));

    await service.replaceSnapshot(
      command(tripId, new Date("2026-10-10T11:00:00Z"), {
        routePricingId: null,
        routeMatch: "NOT_FOUND",
        combinationRouteGroupId: null,
        routeLegs: [],
      }),
    );
    const [snapshot] = await repository.findCurrentByTripIds([tripId]);

    expect(snapshot).toMatchObject({ routeMatch: "NOT_FOUND", routePricingId: null, routeLegs: [] });
  });

  it("keeps the newer legs when an older calculation stores last", async () => {
    const tripId = await closedTrip();
    await service.replaceSnapshot(command(tripId, new Date("2026-10-10T11:00:00Z")));

    await service.replaceSnapshot(
      command(tripId, new Date("2026-10-10T10:00:00Z"), {
        routeMatch: "FUZZY",
        routeLegs: [{ ...leg(1, true), legPosition: null, matchMethod: "FUZZY" }],
      }),
    );
    const [snapshot] = await repository.findCurrentByTripIds([tripId]);

    expect(snapshot.routeMatch).toBe("EXACT");
    expect(snapshot.routeLegs).toHaveLength(2);
  });

  it("refuses a leg position other than 1, 2 or none", async () => {
    const tripId = await closedTrip();

    await expect(
      service.replaceSnapshot(
        command(tripId, new Date(), { routeLegs: [{ ...leg(1, true), legPosition: 3 }] }),
      ),
    ).rejects.toBeDefined();
  });
});
