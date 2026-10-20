import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { TripPricingRepository } from "../trip-pricing/trip-pricing.repository";
import {
  TripPricingService,
  type ReplacePricingSnapshotCommand,
} from "../trip-pricing/trip-pricing.service";
import { TripReadService } from "../trips/trip-read.service";
import { AutomaticTarAlreadyChargedException, TarChargeGuard } from "./tar-charge-guard";
import { TarChargeReadRepository, type TarDay } from "./tar-charge-read.repository";

/**
 * At most one automatic TAR per number and day — with TWO REAL DATABASE
 * SESSIONS writing at the same time.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set, and needs a
 * real PostgreSQL server (one session per connection; PGlite is a single
 * session and cannot show a lock being waited on). Every test uses its own
 * number, so tests never see each other's rows.
 *
 * Each session decides "the number is free" from what is committed, exactly as
 * a calculation does, and then writes through the real `TripPricingService`
 * with the real `TarChargeGuard` — the controlled timing makes both decisions
 * happen before either write commits, the race the guard exists for.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const DAY = new Date("2026-09-07T00:00:00.000Z");
const quiet = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;

/** One database session and the services a pricing write uses in it. */
function session() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
  });
  const prisma = client as unknown as PrismaService;

  return {
    client,
    tarCharges: new TarChargeReadRepository(prisma),
    pricing: new TripPricingService(
      new TripPricingRepository(prisma),
      { findById: (id: string) => Promise.resolve({ id }) } as unknown as TripReadService,
      quiet,
    ),
  };
}

/** Resolves once `released` is called — a gate one session waits at. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));

  return { opened, release };
}

describeWithDatabase("the automatic TAR under real concurrency", () => {
  const guard = new TarChargeGuard();
  let first: ReturnType<typeof session>;
  let second: ReturnType<typeof session>;
  let observer: ReturnType<typeof session>;
  let componentId: string;
  let tarPropertyId: string;

  beforeEach(async () => {
    first = session();
    second = session();
    observer = session();

    componentId =
      (await observer.client.pricingComponent.findFirst({ where: { code: "CUSTOM_PROPERTY" } }))?.id ??
      (
        await observer.client.pricingComponent.create({
          data: { code: "CUSTOM_PROPERTY", name: "Custom", description: "Custom", displayOrder: 7 },
        })
      ).id;
    tarPropertyId = (
      await observer.client.customProperty.create({
        data: { name: `TAR ${aNumber()}`, defaultPrice: "20.00", displayOrder: 0 },
      })
    ).id;
  });

  afterEach(async () => {
    await Promise.all([first.client.$disconnect(), second.client.$disconnect(), observer.client.$disconnect()]);
  });

  function aNumber() {
    return `TAR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  async function closedTrip(tarNummer: string): Promise<string> {
    const [{ id }] = await observer.client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status, planning_date, tar_nummer)
      VALUES (${`BK-${aNumber()}`}, 'CLOSED'::"trip_status", ${DAY}::date, ${tarNummer})
      RETURNING id`;

    return id;
  }

  /** A snapshot charging TAR: `automatic` for the Engine's own line, false for a manual one. */
  function snapshot(
    tripId: string,
    { automatic, calculatedAt = new Date(), beforeWrite }: {
      automatic: boolean | null;
      calculatedAt?: Date;
      beforeWrite?: ReplacePricingSnapshotCommand["beforeWrite"];
    },
  ): ReplacePricingSnapshotCommand {
    return {
      tripId,
      totalPrice: new Prisma.Decimal(automatic === null ? "0.00" : "20.00"),
      calculatedAt,
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "test",
      calculationStatus: "CALCULATED",
      routePricingId: null,
      routeMatch: "NOT_FOUND",
      combinationRouteGroupId: null,
      combinationMatch: null,
      routeSelection: "AUTOMATIC",
      routeLegs: [],
      items:
        automatic === null
          ? []
          : [
              {
                pricingComponentId: componentId,
                customPropertyId: tarPropertyId,
                description: "TAR",
                amount: new Prisma.Decimal("20.00"),
                calculationOrder: 7,
                quantity: null,
                unitPrice: null,
                isAutomatic: automatic,
              },
            ],
      ...(beforeWrite ? { beforeWrite } : {}),
    };
  }

  const holdersOf = async (day: TarDay) =>
    (await observer.tarCharges.findHolders(day)).map((holder) => holder.tripId).sort();

  /** Waits until another session is blocked on an advisory lock. */
  async function untilSomeoneWaitsForTheLock(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [{ waiting }] = await observer.client.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;

      if (waiting > 0n) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error("No session ever waited for the TAR lock");
  }

  /**
   * Both sessions decide the number is free from what is committed, then both
   * write an automatic TAR. The first session's write is held open INSIDE its
   * transaction until the second is waiting on the lock.
   */
  async function race(day: TarDay, firstTrip: string, secondTrip: string, guarded: boolean) {
    expect(await first.tarCharges.hasBeenChargedToday({ ...day, tripId: firstTrip })).toBe(false);
    expect(await second.tarCharges.hasBeenChargedToday({ ...day, tripId: secondTrip })).toBe(false);

    const firstInside = gate();
    const secondWaiting = gate();
    const claim = (tripId: string) => (transaction: PrismaService) => guard.assertStillFree(transaction, day, tripId);

    const firstWrite = first.pricing.replaceSnapshot(
      snapshot(firstTrip, {
        automatic: true,
        beforeWrite: async (transaction) => {
          if (guarded) {
            await claim(firstTrip)(transaction);
          }
          firstInside.release();
          await secondWaiting.opened;
        },
      }),
    );
    await firstInside.opened;

    const secondWrite = second.pricing
      .replaceSnapshot(snapshot(secondTrip, { automatic: true, ...(guarded ? { beforeWrite: claim(secondTrip) } : {}) }))
      .then(
        () => "stored" as const,
        (error: unknown) => error,
      );

    if (guarded) {
      await untilSomeoneWaitsForTheLock();
    } else {
      await secondWrite;
    }
    secondWaiting.release();
    await firstWrite;

    return secondWrite;
  }

  it("shows the race: without the guard, both sessions commit the automatic TAR", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const a = await closedTrip(day.tarNummer);
    const b = await closedTrip(day.tarNummer);

    expect(await race(day, a, b, false)).toBe("stored");

    expect(await holdersOf(day)).toEqual([a, b].sort());
  });

  it("1/2. with the guard, the second session waits, is refused, and the first keeps the charge", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const a = await closedTrip(day.tarNummer);
    const b = await closedTrip(day.tarNummer);

    const outcome = await race(day, a, b, true);

    expect(outcome).toBeInstanceOf(AutomaticTarAlreadyChargedException);
    expect(await holdersOf(day)).toEqual([a]);
    // Priced again, the second Trip finds the charge taken and stores without it.
    expect(await second.tarCharges.hasBeenChargedToday({ ...day, tripId: b })).toBe(true);
    await second.pricing.replaceSnapshot(snapshot(b, { automatic: null }));
    expect(await holdersOf(day)).toEqual([a]);
  });

  it("2. decides by who writes first, whichever Trip it is", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const a = await closedTrip(day.tarNummer);
    const b = await closedTrip(day.tarNummer);

    // The same race with the sessions' Trips swapped.
    expect(await race(day, b, a, true)).toBeInstanceOf(AutomaticTarAlreadyChargedException);

    expect(await holdersOf(day)).toEqual([b]);
  });

  it("4. never takes a manual TAR for the automatic charge", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const manual = await closedTrip(day.tarNummer);
    const automatic = await closedTrip(day.tarNummer);
    await first.pricing.replaceSnapshot(snapshot(manual, { automatic: false }));

    await second.pricing.replaceSnapshot(
      snapshot(automatic, {
        automatic: true,
        beforeWrite: (transaction) => guard.assertStillFree(transaction, day, automatic),
      }),
    );

    expect(await holdersOf(day)).toEqual([automatic]);
  });

  it("5. a refused write leaves the Trip's previous snapshot exactly as it was", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const a = await closedTrip(day.tarNummer);
    const b = await closedTrip(day.tarNummer);
    await second.pricing.replaceSnapshot(snapshot(b, { automatic: null, calculatedAt: new Date(Date.now() - 60_000) }));
    const before = await observer.client.tripPricing.findUnique({ where: { tripId: b }, include: { items: true } });

    await race(day, a, b, true);

    const after = await observer.client.tripPricing.findUnique({ where: { tripId: b }, include: { items: true } });
    expect(after).toEqual(before);
  });

  /** 3. Two writes of one Trip at once: the older calculation never replaces the newer. */
  it("3. never lets an older calculation overwrite a newer one written at the same time", async () => {
    const day = { tarNummer: aNumber(), planningDate: DAY };
    const b = await closedTrip(day.tarNummer);
    const older = new Date(Date.now() - 1000);
    const newer = new Date();

    await Promise.all([
      first.pricing.replaceSnapshot(snapshot(b, { automatic: null, calculatedAt: newer })),
      second.pricing.replaceSnapshot(snapshot(b, { automatic: true, calculatedAt: older })),
    ]);

    const stored = await observer.client.tripPricing.findUnique({ where: { tripId: b }, include: { items: true } });
    expect(stored?.calculatedAt.getTime()).toBe(newer.getTime());
    expect(stored?.items).toEqual([]);
  });
});
