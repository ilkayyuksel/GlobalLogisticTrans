import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { PrismaService } from "../prisma/prisma.service";
import { VehicleAssignmentRepository } from "../vehicle-assignments/vehicle-assignment.repository";
import { VehicleAssignmentService } from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripDriverPinningService } from "./trip-driver-pinning.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * Changing a Trip's truck against a REAL database: the truck and the driver as
 * stored, and the API answer, through the real update, repository and
 * assignment lookup.
 *
 * Opt-in: runs only when TEST_DATABASE_URL points at a throw-away database.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("changing a Trip's truck against a real database", () => {
  let client: PrismaClient;
  let trips: TripService;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;
  const active = { findById: jest.fn().mockResolvedValue({ isActive: true }) };

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 4 }),
    });
    const prisma = client as unknown as PrismaService;
    const assignments = new VehicleAssignmentService(
      new VehicleAssignmentRepository(prisma),
      active as unknown as VehicleService,
      active as unknown as DriverService,
      logger,
    );

    trips = new TripService(
      new TripRepository(prisma),
      active as unknown as VehicleService,
      active as unknown as DriverService,
      {
        resolveOne: jest.fn().mockResolvedValue({ vehicle: null, effectiveDriver: null }),
      } as unknown as TripPlanningDataService,
      new TripDriverPinningService(assignments, logger),
      { applyToNewTrip: jest.fn(), synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
      stubPricingRecalculation(),
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger,
    );
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vehicle = async () =>
    (await client.vehicle.create({ data: { licensePlate: `T-${unique()}`, displayColor: "#000000" } })).id;
  const driver = async (name: string) => (await client.driver.create({ data: { name } })).id;
  const assign = (vehicleId: string, driverId: string, validFrom: string, validTo: string | null = null) =>
    client.vehicleAssignment.create({
      data: {
        vehicleId,
        driverId,
        validFrom: new Date(`${validFrom}T00:00:00Z`),
        validTo: validTo ? new Date(`${validTo}T00:00:00Z`) : null,
      },
    });
  const tripOn = async (vehicleId: string, driverId: string | null, planningDate: string) =>
    (
      await client.trip.create({
        data: {
          bookingNumber: `TRUCK-${unique()}`,
          vehicleId,
          driverId,
          planningDate: new Date(`${planningDate}T00:00:00Z`),
        },
      })
    ).id;
  const stored = (id: string) =>
    client.trip.findUnique({ where: { id }, select: { vehicleId: true, driverId: true } });

  it("1/2/8. truck 1 with Ahmed → truck 2: Fatih is stored and answered", async () => {
    const [truck1, truck2] = [await vehicle(), await vehicle()];
    const [ahmed, fatih] = [await driver("Ahmed"), await driver("Fatih")];
    await assign(truck1, ahmed, "2026-01-01");
    await assign(truck2, fatih, "2026-01-01");
    const tripId = await tripOn(truck1, ahmed, "2026-11-02");

    const response = await trips.update(tripId, { vehicleId: truck2 });

    expect(await stored(tripId)).toEqual({ vehicleId: truck2, driverId: fatih });
    expect(response).toMatchObject({ vehicleId: truck2, driverId: fatih });
  });

  it("3. a new truck with nobody on the date leaves no driver", async () => {
    const [truck1, truck2] = [await vehicle(), await vehicle()];
    const ahmed = await driver("Ahmed");
    await assign(truck1, ahmed, "2026-01-01");
    const tripId = await tripOn(truck1, ahmed, "2026-11-02");

    await trips.update(tripId, { vehicleId: truck2 });

    expect(await stored(tripId)).toEqual({ vehicleId: truck2, driverId: null });
  });

  it("4. takes the driver valid on the Trip's own date", async () => {
    const [truck1, truck2] = [await vehicle(), await vehicle()];
    const [ahmed, fatih, marc] = [await driver("Ahmed"), await driver("Fatih"), await driver("Marc")];
    await assign(truck1, ahmed, "2026-01-01");
    await assign(truck2, marc, "2026-01-01", "2026-11-30");
    await assign(truck2, fatih, "2026-12-01");
    const early = await tripOn(truck1, ahmed, "2026-11-15");
    const late = await tripOn(truck1, ahmed, "2026-12-15");

    await trips.update(early, { vehicleId: truck2 });
    await trips.update(late, { vehicleId: truck2 });

    expect((await stored(early))?.driverId).toBe(marc);
    expect((await stored(late))?.driverId).toBe(fatih);
  });

  it("5. a date change alone keeps the stored driver", async () => {
    const truck1 = await vehicle();
    const [ahmed, fatih] = [await driver("Ahmed"), await driver("Fatih")];
    await assign(truck1, ahmed, "2026-01-01", "2026-11-30");
    await assign(truck1, fatih, "2026-12-01");
    const tripId = await tripOn(truck1, ahmed, "2026-11-15");

    await trips.update(tripId, { planningDate: "2026-12-15" });

    expect(await stored(tripId)).toEqual({ vehicleId: truck1, driverId: ahmed });
  });

  it("11. a driver chosen in the same request wins", async () => {
    const [truck1, truck2] = [await vehicle(), await vehicle()];
    const [ahmed, fatih, marc] = [await driver("Ahmed"), await driver("Fatih"), await driver("Marc")];
    await assign(truck1, ahmed, "2026-01-01");
    await assign(truck2, fatih, "2026-01-01");
    const tripId = await tripOn(truck1, ahmed, "2026-11-02");

    await trips.update(tripId, { vehicleId: truck2, driverId: marc });

    expect(await stored(tripId)).toEqual({ vehicleId: truck2, driverId: marc });
  });
});
