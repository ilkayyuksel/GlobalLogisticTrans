import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripPricingRepository } from "./trip-pricing.repository";

/**
 * Only a CLOSED Trip's snapshot is its current price — against a REAL database.
 *
 * The rule is a relation filter on the Trip's status inside the snapshot
 * query. Its shape is pinned in `trip-pricing.repository.spec.ts`; this runs it
 * through the real Prisma client and Postgres, so a filter Prisma would accept
 * but answer differently cannot pass unnoticed.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. See `cost-confirmation.concurrency.db.spec.ts`.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("current pricing against a real database", () => {
  let client: PrismaClient;
  let repository: TripPricingRepository;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    repository = new TripPricingRepository(client as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  /** A Trip with a stored snapshot, in the given status. */
  async function pricedTrip(status: string): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status)
      VALUES (${`ANRDUB-${Date.now()}-${Math.random()}`}, ${status}::"trip_status")
      RETURNING id`;
    await client.tripPricing.create({
      data: {
        tripId: id,
        totalPrice: "230.00",
        calculatedAt: new Date(),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "test",
        calculationStatus: "CALCULATED",
      },
    });

    return id;
  }

  it("finds the snapshot of a CLOSED Trip", async () => {
    const tripId = await pricedTrip("CLOSED");

    expect((await repository.findCurrentByTripId(tripId))?.tripId).toBe(tripId);
    expect((await repository.findCurrentByTripIds([tripId])).map((row) => row.tripId)).toEqual([
      tripId,
    ]);
  });

  it.each(["OPEN", "CANCELLED", "DELETED"])(
    "does not offer a %s Trip's stored snapshot as its price",
    async (status) => {
      const tripId = await pricedTrip(status);

      expect(await repository.findCurrentByTripId(tripId)).toBeNull();
      expect(await repository.findCurrentByTripIds([tripId])).toEqual([]);
      // Kept as history, and still found by the Engine's own read.
      expect((await repository.findByTripId(tripId))?.tripId).toBe(tripId);
    },
  );

  it("follows the status the moment it changes", async () => {
    const tripId = await pricedTrip("CLOSED");

    await client.trip.update({ where: { id: tripId }, data: { status: "OPEN" } });
    expect(await repository.findCurrentByTripId(tripId)).toBeNull();

    await client.trip.update({ where: { id: tripId }, data: { status: "CLOSED" } });
    expect((await repository.findCurrentByTripId(tripId))?.tripId).toBe(tripId);
  });
});
