import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TarChargeReadRepository } from "./tar-charge-read.repository";

/**
 * Who holds a TAR-nummer's charge for the day — against a REAL database.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. See `cost-confirmation.concurrency.db.spec.ts`. Every test uses its own
 * number, so tests never see each other's rows.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const DAY = new Date("2026-09-07T00:00:00.000Z");

describeWithDatabase("the TAR charge reads against a real database", () => {
  let client: PrismaClient;
  let repository: TarChargeReadRepository;
  let tarPropertyId: string;
  let componentId: string;

  beforeEach(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    repository = new TarChargeReadRepository(client as unknown as PrismaService);

    tarPropertyId = (
      await client.customProperty.create({
        data: { name: `TAR ${aNumber()}`, defaultPrice: "20.00", displayOrder: 0 },
      })
    ).id;
    componentId =
      (await client.pricingComponent.findFirst({ where: { code: "CUSTOM_PROPERTY" } }))?.id ??
      (
        await client.pricingComponent.create({
          data: { code: "CUSTOM_PROPERTY", name: "Custom", description: "Custom", displayOrder: 7 },
        })
      ).id;
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  function aNumber() {
    return `TAR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  async function aTrip(tarNummer: string, status = "CLOSED"): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status, planning_date, tar_nummer)
      VALUES (${`BK-${aNumber()}`}, ${status}::"trip_status", ${DAY}::date, ${tarNummer})
      RETURNING id`;

    return id;
  }

  /** A snapshot with these TAR lines: true for an automatic one, false for a manual one. */
  async function priced(
    tripId: string,
    lines: readonly boolean[],
    { calculationStatus = "CALCULATED", calculatedAt = new Date() } = {},
  ): Promise<void> {
    await client.tripPricing.create({
      data: {
        tripId,
        totalPrice: (20 * lines.length).toFixed(2),
        calculatedAt,
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "test",
        calculationStatus: calculationStatus as "CALCULATED" | "FAILED",
        items: {
          create: lines.map((isAutomatic, index) => ({
            pricingComponentId: componentId,
            customPropertyId: tarPropertyId,
            description: "TAR",
            amount: "20.00",
            calculationOrder: 7 + index,
            isAutomatic,
          })),
        },
      },
    });
  }

  const ask = (tripId: string, tarNummer: string) =>
    repository.hasBeenChargedToday({ tripId, planningDate: DAY, tarNummer: tarNummer.toLowerCase() });

  it("finds another Trip's automatic charge of the number that day, whatever its case", async () => {
    const number = aNumber();
    const holder = await aTrip(number);
    await priced(holder, [true]);

    expect(await ask(await aTrip(number), number)).toBe(true);
    // Never itself.
    expect(await ask(holder, number)).toBe(false);
  });

  it("does not take a manual TAR for the day's automatic charge", async () => {
    const number = aNumber();
    await priced(await aTrip(number), [false]);

    expect(await ask(await aTrip(number), number)).toBe(false);
  });

  it("finds the automatic charge beside a manual one", async () => {
    const number = aNumber();
    await priced(await aTrip(number), [false, true]);

    expect(await ask(await aTrip(number), number)).toBe(true);
  });

  it("disregards a FAILED snapshot and a CANCELLED Trip", async () => {
    const number = aNumber();
    await priced(await aTrip(number), [true], { calculationStatus: "FAILED" });
    await priced(await aTrip(number, "CANCELLED"), [true]);

    expect(await ask(await aTrip(number), number)).toBe(false);
  });

  it("lets a later CLOSED charge replace a reopened Trip's older one", async () => {
    const number = aNumber();
    const reopened = await aTrip(number, "OPEN");
    const closed = await aTrip(number);
    await priced(reopened, [true], { calculatedAt: new Date(Date.now() - 60_000) });
    await priced(closed, [true]);

    expect(await ask(closed, number)).toBe(false);
    expect(await ask(reopened, number)).toBe(true);
    expect((await repository.findHolders({ tarNummer: number, planningDate: DAY })).map((h) => h.status).sort()).toEqual([
      "CLOSED",
      "OPEN",
    ]);
  });

  it("names the Trips holding an automatic TAR, and the CLOSED Trips stating a number", async () => {
    const number = aNumber();
    const automatic = await aTrip(number);
    const manual = await aTrip(number.toLowerCase());
    await aTrip(number, "OPEN");
    await priced(automatic, [true]);
    await priced(manual, [false]);

    expect(await repository.findTripsHoldingAutomaticTar([automatic, manual])).toEqual(new Set([automatic]));
    expect(
      await repository.findClosedTripsStating({ tarNummer: number, planningDate: DAY }, automatic),
    ).toEqual([manual]);
  });
});
