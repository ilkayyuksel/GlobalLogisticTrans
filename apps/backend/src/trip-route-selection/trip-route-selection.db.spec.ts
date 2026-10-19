import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripReadRepository } from "../trips/trip-read.repository";
import { TripRepository } from "../trips/trip.repository";
import { TripRouteSelectionRepository } from "./trip-route-selection.repository";

/**
 * The operators' route choices against a real database — the migration's
 * table, its foreign keys and cascades, and clearing inside a Trip's own
 * transaction.
 *
 * Opt-in, like every `*.db.spec.ts`: set TEST_DATABASE_URL to a disposable
 * Postgres with every migration applied (see the PGlite note in the project
 * memory). Skipped otherwise. PGlite is one session behind a socket, so a
 * fresh client per test.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("route choices, against a real database", () => {
  let client: PrismaClient;
  let choices: TripRouteSelectionRepository;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    choices = new TripRouteSelectionRepository(client as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = () => `${Date.now()}-${Math.random()}`;

  async function trip(status: TripStatus = TripStatus.CLOSED, tripGroupId: string | null = null): Promise<string> {
    const created = await client.trip.create({
      data: { bookingNumber: `ANRDUB-${unique()}`, status, tripGroupId },
    });

    return created.id;
  }

  async function ordinaryRoute(): Promise<string> {
    const route = await client.routePricing.create({
      data: { routeName: `Quay 869 → ${unique()}`, departure: "Quay 869", destination: unique(), basePrice: "100.00" },
    });

    return route.id;
  }

  /** A configured Combination: its two leg rows, outbound first. */
  async function combination(): Promise<[string, string]> {
    const group = await client.combinationRouteGroup.create({ data: {} });
    const legs = await Promise.all(
      [1, 2].map((position) =>
        client.routePricing.create({
          data: {
            routeName: `leg ${position} ${unique()}`,
            departure: position === 1 ? "Quay 869" : `back-${unique()}`,
            destination: position === 1 ? `out-${unique()}` : "Quay 869",
            basePrice: "100.00",
            combinationGroupId: group.id,
            combinationLegPosition: position,
          },
        }),
      ),
    );

    return [legs[0].id, legs[1].id];
  }

  async function groupedPair(): Promise<[string, string]> {
    const group = await client.tripGroup.create({ data: {} });

    return [await trip(TripStatus.CLOSED, group.id), await trip(TripStatus.CLOSED, group.id)];
  }

  const chosen = async (tripId: string) =>
    (await client.tripRouteSelection.findUnique({ where: { tripId } }))?.routePricingId ?? null;

  it("stores a choice and replaces it, one row per Trip", async () => {
    const tripId = await trip();
    const [first, second] = [await ordinaryRoute(), await ordinaryRoute()];

    await choices.replace([{ tripId, routePricingId: first }]);
    await choices.replace([{ tripId, routePricingId: second }]);

    expect(await chosen(tripId)).toBe(second);
    expect(await client.tripRouteSelection.count({ where: { tripId } })).toBe(1);
  });

  it("removes a pair's choice with either leg, and nobody else's", async () => {
    const [legOne, legTwo] = await groupedPair();
    const [outbound, back] = await combination();
    const alone = await trip();
    const route = await ordinaryRoute();
    await choices.replace([
      { tripId: legOne, routePricingId: outbound },
      { tripId: legTwo, routePricingId: back },
    ]);
    await choices.replace([{ tripId: alone, routePricingId: route }]);

    expect(await choices.clearForTrips([legTwo])).toBe(2);

    expect(await chosen(legOne)).toBeNull();
    expect(await chosen(legTwo)).toBeNull();
    expect(await chosen(alone)).toBe(route);
  });

  it("takes the choice with a removed route configuration", async () => {
    const tripId = await trip();
    const route = await ordinaryRoute();
    await choices.replace([{ tripId, routePricingId: route }]);

    await client.routePricing.delete({ where: { id: route } });

    expect(await chosen(tripId)).toBeNull();
  });

  it("refuses a route that does not exist", async () => {
    const tripId = await trip();

    await expect(
      choices.replace([{ tripId, routePricingId: "00000000-0000-4000-8000-000000000000" }]),
    ).rejects.toThrow();
  });

  /** Reopening removes the choice in the status write's own transaction. */
  it("removes the pair's choice when a leg is reopened, atomically with the status", async () => {
    const [legOne, legTwo] = await groupedPair();
    const [outbound, back] = await combination();
    await choices.replace([
      { tripId: legOne, routePricingId: outbound },
      { tripId: legTwo, routePricingId: back },
    ]);

    await new TripRepository(client as unknown as PrismaService).runInTransaction((repository) =>
      repository.setStatus(legOne, TripStatus.OPEN),
    );

    expect(await chosen(legOne)).toBeNull();
    expect(await chosen(legTwo)).toBeNull();
  });

  it("keeps the choice when the status write is rolled back", async () => {
    const tripId = await trip();
    const route = await ordinaryRoute();
    await choices.replace([{ tripId, routePricingId: route }]);

    await expect(
      new TripRepository(client as unknown as PrismaService).runInTransaction(async (repository) => {
        await repository.setStatus(tripId, TripStatus.OPEN);
        throw new Error("the transition failed after the write");
      }),
    ).rejects.toThrow("the transition failed after the write");

    // A fresh client: the session saw an aborted transaction.
    await client.$disconnect();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }) });

    expect(await chosen(tripId)).toBe(route);
    expect((await client.trip.findUnique({ where: { id: tripId } }))?.status).toBe(TripStatus.CLOSED);
  });

  it("is read by the Engine's narrow Trip read", async () => {
    const tripId = await trip();
    const route = await ordinaryRoute();
    await choices.replace([{ tripId, routePricingId: route }]);

    const row = await new TripReadRepository(client as unknown as PrismaService).findById(tripId);

    expect(row?.routeSelection).toEqual({ routePricingId: route });
  });

  it("records every snapshot as AUTOMATIC unless it says otherwise", async () => {
    const tripId = await trip();

    const snapshot = await client.tripPricing.create({
      data: {
        tripId,
        totalPrice: "0.00",
        calculatedAt: new Date(),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.1",
        calculationStatus: "CALCULATED",
      },
    });

    expect(snapshot.routeSelection).toBe("AUTOMATIC");
  });
});
