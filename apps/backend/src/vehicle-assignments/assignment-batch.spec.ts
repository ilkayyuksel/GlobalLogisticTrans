import { AppLoggerService } from "../logger/app-logger.service";
import { DriverService } from "../drivers/driver.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { VehicleAssignmentService, assignmentKey } from "./vehicle-assignment.service";

/**
 * The batch driver lookup.
 *
 * This is the method that keeps a page of Trips off the N+1 path, so the tests
 * assert the QUERY COUNT as firmly as they assert the answers.
 */

const VEHICLE_A = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const VEHICLE_B = "3d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function assignment(
  vehicleId: string,
  driverId: string,
  validFrom: string,
  validTo: string | null,
) {
  return {
    id: `${vehicleId}-${validFrom}`,
    vehicleId,
    driverId,
    validFrom: day(validFrom),
    validTo: validTo === null ? null : day(validTo),
    driver: { id: driverId, name: `Driver ${driverId}`, isActive: true },
  };
}

describe("VehicleAssignmentService.findDriversForVehiclesOnDates", () => {
  let repository: { findCoveringVehicles: jest.Mock };
  let service: VehicleAssignmentService;

  beforeEach(() => {
    repository = { findCoveringVehicles: jest.fn().mockResolvedValue([]) };

    service = new VehicleAssignmentService(
      repository as unknown as VehicleAssignmentRepository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    );
  });

  describe("query count", () => {
    it("issues ONE query for many vehicles and dates", async () => {
      const requests = Array.from({ length: 40 }, (_, index) => ({
        vehicleId: index % 2 === 0 ? VEHICLE_A : VEHICLE_B,
        onDate: day(`2026-03-${String((index % 28) + 1).padStart(2, "0")}`),
      }));

      await service.findDriversForVehiclesOnDates(requests);

      expect(repository.findCoveringVehicles).toHaveBeenCalledTimes(1);
    });

    it("issues no query at all for an empty request set", async () => {
      const resolved = await service.findDriversForVehiclesOnDates([]);

      expect(resolved.size).toBe(0);
      expect(repository.findCoveringVehicles).not.toHaveBeenCalled();
    });

    it("asks for each distinct vehicle once", async () => {
      await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-03-01") },
        { vehicleId: VEHICLE_A, onDate: day("2026-03-02") },
        { vehicleId: VEHICLE_B, onDate: day("2026-03-03") },
      ]);

      const [vehicleIds] = repository.findCoveringVehicles.mock.calls[0];

      expect([...vehicleIds].sort()).toEqual([VEHICLE_A, VEHICLE_B].sort());
    });

    /** The span bounds the fetch; it must cover every date being asked about. */
    it("bounds the fetch by the span of the requested dates", async () => {
      await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-03-15") },
        { vehicleId: VEHICLE_A, onDate: day("2026-01-02") },
        { vehicleId: VEHICLE_A, onDate: day("2026-06-30") },
      ]);

      const [, from, to] = repository.findCoveringVehicles.mock.calls[0];

      expect(from).toEqual(day("2026-01-02"));
      expect(to).toEqual(day("2026-06-30"));
    });
  });

  describe("resolution", () => {
    it("answers each vehicle-and-date pair from one fetch", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment(VEHICLE_A, "driver-a", "2026-01-01", null),
        assignment(VEHICLE_B, "driver-b", "2026-01-01", null),
      ]);

      const resolved = await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-03-15") },
        { vehicleId: VEHICLE_B, onDate: day("2026-03-15") },
      ]);

      expect(resolved.get(assignmentKey(VEHICLE_A, day("2026-03-15")))?.id).toBe(
        "driver-a",
      );
      expect(resolved.get(assignmentKey(VEHICLE_B, day("2026-03-15")))?.id).toBe(
        "driver-b",
      );
    });

    /** The same vehicle can have different drivers on different Trips. */
    it("gives one vehicle different drivers on different dates", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment(VEHICLE_A, "winter", "2026-01-01", "2026-02-28"),
        assignment(VEHICLE_A, "spring", "2026-03-01", null),
      ]);

      const resolved = await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-02-10") },
        { vehicleId: VEHICLE_A, onDate: day("2026-03-10") },
      ]);

      expect(resolved.get(assignmentKey(VEHICLE_A, day("2026-02-10")))?.id).toBe(
        "winter",
      );
      expect(resolved.get(assignmentKey(VEHICLE_A, day("2026-03-10")))?.id).toBe(
        "spring",
      );
    });

    /**
     * A row inside the fetch span that does not cover the specific date must be
     * ignored — the span is a fetch bound, not the rule.
     */
    it("omits a pair no assignment covers", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment(VEHICLE_A, "driver-a", "2026-01-01", "2026-01-31"),
      ]);

      const resolved = await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-03-15") },
      ]);

      expect(resolved.has(assignmentKey(VEHICLE_A, day("2026-03-15")))).toBe(
        false,
      );
    });

    it("does not attribute one vehicle's assignment to another", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment(VEHICLE_A, "driver-a", "2026-01-01", null),
      ]);

      const resolved = await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_B, onDate: day("2026-03-15") },
      ]);

      expect(resolved.size).toBe(0);
    });

    it("includes the boundary days of a period", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment(VEHICLE_A, "driver-a", "2026-03-10", "2026-03-20"),
      ]);

      const resolved = await service.findDriversForVehiclesOnDates([
        { vehicleId: VEHICLE_A, onDate: day("2026-03-10") },
        { vehicleId: VEHICLE_A, onDate: day("2026-03-20") },
        { vehicleId: VEHICLE_A, onDate: day("2026-03-21") },
      ]);

      expect(resolved.has(assignmentKey(VEHICLE_A, day("2026-03-10")))).toBe(true);
      expect(resolved.has(assignmentKey(VEHICLE_A, day("2026-03-20")))).toBe(true);
      expect(resolved.has(assignmentKey(VEHICLE_A, day("2026-03-21")))).toBe(false);
    });
  });
});
