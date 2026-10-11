import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, VehicleAssignment } from "@prisma/client";

import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { ConcurrentAssignmentChangeException } from "./active-assignment-race";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { VehicleDriverLinkService } from "./vehicle-driver-link.service";

/**
 * Linking against a REAL database: one transaction, and the active-assignment
 * indexes as the last line against a concurrent link.
 *
 * ── HOW A RACE IS STAGED ────────────────────────────────────────────────────
 * The loser of a race is the request whose reads ran before the winner
 * committed. `StaleRepository` gives exactly those reads — it does not see the
 * driver's current truck — while every write is the real one. The database
 * must then refuse the insert and roll back what the loser already did.
 *
 * ── OPT-IN, AND DISPOSABLE ONLY ─────────────────────────────────────────────
 * Runs only when TEST_DATABASE_URL is set, and it WRITES rows: point it at a
 * throw-away database with the migrations applied, never at a real one.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/** Reads as a request that started before the other one committed. */
class StaleRepository extends VehicleAssignmentRepository {
  constructor(
    prisma: PrismaService,
    private readonly hiddenDriverId: string,
  ) {
    super(prisma);
  }

  override runInTransaction<TResult>(
    work: (repository: VehicleAssignmentRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return super.runInTransaction((transactional) =>
      work(this.staleView(transactional)),
    );
  }

  private staleView(real: VehicleAssignmentRepository): VehicleAssignmentRepository {
    const hidden = this.hiddenDriverId;

    return Object.assign(Object.create(real) as VehicleAssignmentRepository, {
      findOverlapping: async (query: Parameters<VehicleAssignmentRepository["findOverlapping"]>[0]) =>
        query.driverId === hidden ? [] : real.findOverlapping(query),
    });
  }
}

describeWithDatabase("linking a driver against a real database", () => {
  let client: PrismaClient;
  let prisma: PrismaService;
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;
  const exists = { findById: jest.fn().mockResolvedValue({}) };

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    prisma = client as unknown as PrismaService;
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  function service(repository: VehicleAssignmentRepository): VehicleDriverLinkService {
    return new VehicleDriverLinkService(
      repository,
      exists as unknown as VehicleService,
      exists as unknown as DriverService,
      logger,
    );
  }

  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function seedVehicle(): Promise<string> {
    const vehicle = await client.vehicle.create({
      data: { licensePlate: `T-${unique()}`, displayColor: "#000000" },
    });
    return vehicle.id;
  }

  async function seedDriver(): Promise<string> {
    const driver = await client.driver.create({ data: { name: `Driver ${unique()}` } });
    return driver.id;
  }

  async function seedAssignment(vehicleId: string, driverId: string): Promise<VehicleAssignment> {
    return client.vehicleAssignment.create({
      data: { vehicleId, driverId, validFrom: new Date("2026-01-01T00:00:00Z") },
    });
  }

  async function seedFutureTrip(vehicleId: string): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status, vehicle_id, planning_date)
      VALUES (${`LINK-${unique()}`}, 'OPEN'::"trip_status", ${vehicleId}::uuid, '2099-01-01')
      RETURNING id`;
    return id;
  }

  it("ends both conflicts, pins the Trip and links, in one go", async () => {
    const [truckA, truckB, driver, other] = [
      await seedVehicle(),
      await seedVehicle(),
      await seedDriver(),
      await seedDriver(),
    ];
    await seedAssignment(truckA, driver);
    await seedAssignment(truckB, other);
    const tripOnB = await seedFutureTrip(truckB);

    const result = await service(new VehicleAssignmentRepository(prisma)).link({
      vehicleId: truckB,
      driverId: driver,
    });

    expect(result.outcome).toBe("LINKED");
    expect(result.endedAssignments).toHaveLength(2);
    const open = await client.vehicleAssignment.findMany({
      where: { validTo: null, vehicleId: { in: [truckA, truckB] } },
    });
    expect(open.map((row) => [row.vehicleId, row.driverId])).toEqual([[truckB, driver]]);
    expect((await client.trip.findUnique({ where: { id: tripOnB } }))?.driverId).toBe(other);
  });

  it("13/14. a link that loses a race is refused and leaves NOTHING changed", async () => {
    const [truckA, truckB, driver, other] = [
      await seedVehicle(),
      await seedVehicle(),
      await seedDriver(),
      await seedDriver(),
    ];
    // The winner already gave the driver truck A; the loser does not see it.
    const winner = await seedAssignment(truckA, driver);
    const replaced = await seedAssignment(truckB, other);
    const tripOnB = await seedFutureTrip(truckB);

    await expect(
      service(new StaleRepository(prisma, driver)).link({ vehicleId: truckB, driverId: driver }),
    ).rejects.toBeInstanceOf(ConcurrentAssignmentChangeException);

    // The loser had already ended truck B's driver and pinned its Trip:
    // all of it rolled back with the refused insert. Read on a fresh
    // connection — PGlite garbles reads on one that has just seen an error.
    await client.$disconnect();
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    const rows = await client.vehicleAssignment.findMany({
      where: { vehicleId: { in: [truckA, truckB] } },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => [row.id, row.validTo])).toEqual([
      [winner.id, null],
      [replaced.id, null],
    ]);
    expect((await client.trip.findUnique({ where: { id: tripOnB } }))?.driverId).toBeNull();
  });

  it("the database keeps an ended-before-it-began row as history", async () => {
    const [truck, driver] = [await seedVehicle(), await seedDriver()];
    const today = new Date(new Date().toISOString().slice(0, 10));
    const sameDay = await client.vehicleAssignment.create({
      data: { vehicleId: truck, driverId: driver, validFrom: today },
    });

    const other = await seedDriver();
    await service(new VehicleAssignmentRepository(prisma)).link({ vehicleId: truck, driverId: other });

    const kept = await client.vehicleAssignment.findUnique({ where: { id: sameDay.id } });
    expect(kept?.validTo?.getTime()).toBe(today.getTime() - 24 * 60 * 60 * 1000);
  });
});
