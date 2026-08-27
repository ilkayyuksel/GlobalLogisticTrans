import { CurrentAssignmentService } from "./current-assignment.service";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

/**
 * Who is driving what, today — in both directions, from ONE source.
 *
 * ── WHAT THESE TESTS DEFEND ─────────────────────────────────────────────────
 * Three screens ask this question: the Voertuigen list, the Chauffeurs list and
 * the Ritten vehicle picker. They must agree, so they all come through here.
 *
 * Two properties matter most. The first is that the answer comes from
 * `VehicleAssignment` and its date semantics — an assignment that ended
 * yesterday is not today's answer, and nothing here ever looks at a Trip. The
 * second is that a page costs ONE query: the previous shape of this problem
 * would have been a driver lookup per vehicle row.
 */
const TODAY = new Date("2026-08-27T00:00:00.000Z");

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function driver(id: string, name: string, isActive = true) {
  return { id, name, isActive };
}

function vehicle(id: string, licensePlate: string, isActive = true) {
  return { id, licensePlate, displayColor: "#2563eb", isActive };
}

/** An assignment row as the repository returns it, with its relation loaded. */
function assignment(overrides: Record<string, unknown>) {
  return {
    id: "assignment-1",
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    validFrom: day("2026-01-01"),
    validTo: null,
    driver: driver("driver-1", "Jan Janssens"),
    vehicle: vehicle("vehicle-1", "1-ABC-123"),
    ...overrides,
  };
}

describe("resolving today's vehicle and driver", () => {
  let repository: {
    findCoveringVehicles: jest.Mock;
    findCoveringDrivers: jest.Mock;
  };
  let service: CurrentAssignmentService;

  beforeEach(() => {
    repository = {
      findCoveringVehicles: jest.fn().mockResolvedValue([]),
      findCoveringDrivers: jest.fn().mockResolvedValue([]),
    };

    service = new CurrentAssignmentService(
      repository as unknown as VehicleAssignmentRepository,
    );
  });

  describe("a vehicle's current driver", () => {
    it("names the driver of an open-ended assignment", async () => {
      repository.findCoveringVehicles.mockResolvedValue([assignment({})]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.get("vehicle-1")).toMatchObject({ name: "Jan Janssens" });
    });

    /** No assignment is expressed by absence, not by a null the caller unwraps. */
    it("leaves an unassigned vehicle out of the map", async () => {
      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.has("vehicle-1")).toBe(false);
    });

    /**
     * The requirement in §12, in one test: an assignment that ended is not
     * today's answer, and one that starts tomorrow is not either.
     */
    it("ignores an assignment that has already ended", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment({
          driver: driver("driver-old", "Piet Janssens"),
          validFrom: day("2026-01-01"),
          validTo: day("2026-08-26"),
        }),
      ]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.has("vehicle-1")).toBe(false);
    });

    it("ignores an assignment that has not started", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment({ validFrom: day("2026-09-01") }),
      ]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.has("vehicle-1")).toBe(false);
    });

    /** Both ends are inclusive — the shared rule, not a second opinion. */
    it.each([
      ["its first day", day("2026-08-27"), day("2026-08-31")],
      ["its last day", day("2026-08-01"), day("2026-08-27")],
    ])("counts an assignment on %s", async (_name, validFrom, validTo) => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment({ validFrom, validTo }),
      ]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.get("vehicle-1")).toMatchObject({ name: "Jan Janssens" });
    });

    /** The handover in §12: vehicle 1 until the 31st, vehicle 2 from the 1st. */
    it("follows a handover from one driver to the next", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment({
          id: "old",
          driver: driver("driver-old", "Piet Janssens"),
          validFrom: day("2026-08-01"),
          validTo: day("2026-08-26"),
        }),
        assignment({
          id: "new",
          driver: driver("driver-new", "Mehmet Yilmaz"),
          validFrom: day("2026-08-27"),
          validTo: null,
        }),
      ]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.get("vehicle-1")).toMatchObject({ name: "Mehmet Yilmaz" });
    });

    /**
     * Deactivating somebody does not silently unassign the truck they are still
     * down as driving. The flag travels so a caller can say so.
     */
    it("still names a driver who has since been deactivated", async () => {
      repository.findCoveringVehicles.mockResolvedValue([
        assignment({ driver: driver("driver-1", "Jan Janssens", false) }),
      ]);

      const resolved = await service.findCurrentDriversForVehicles(
        ["vehicle-1"],
        TODAY,
      );

      expect(resolved.get("vehicle-1")).toMatchObject({ isActive: false });
    });
  });

  describe("a driver's current vehicle", () => {
    it("names the vehicle of an open-ended assignment", async () => {
      repository.findCoveringDrivers.mockResolvedValue([assignment({})]);

      const resolved = await service.findCurrentVehiclesForDrivers(
        ["driver-1"],
        TODAY,
      );

      expect(resolved.get("driver-1")).toMatchObject({
        licensePlate: "1-ABC-123",
      });
    });

    it("leaves a driver with no vehicle out of the map", async () => {
      const resolved = await service.findCurrentVehiclesForDrivers(
        ["driver-1"],
        TODAY,
      );

      expect(resolved.has("driver-1")).toBe(false);
    });

    it("ignores an assignment that has already ended", async () => {
      repository.findCoveringDrivers.mockResolvedValue([
        assignment({ validFrom: day("2026-01-01"), validTo: day("2026-08-26") }),
      ]);

      const resolved = await service.findCurrentVehiclesForDrivers(
        ["driver-1"],
        TODAY,
      );

      expect(resolved.has("driver-1")).toBe(false);
    });

    /** The §12 example, from the driver's side. */
    it("follows a driver moving from one vehicle to another", async () => {
      repository.findCoveringDrivers.mockResolvedValue([
        assignment({
          id: "old",
          vehicle: vehicle("vehicle-1", "1-ABC-123"),
          validFrom: day("2026-08-01"),
          validTo: day("2026-08-26"),
        }),
        assignment({
          id: "new",
          vehicle: vehicle("vehicle-2", "1-XYZ-456"),
          validFrom: day("2026-08-27"),
          validTo: null,
        }),
      ]);

      const resolved = await service.findCurrentVehiclesForDrivers(
        ["driver-1"],
        TODAY,
      );

      expect(resolved.get("driver-1")).toMatchObject({
        licensePlate: "1-XYZ-456",
      });
    });
  });

  describe("the cost of a page", () => {
    /** The whole point: 20 vehicles must not become 20 lookups. */
    it("asks one query for a whole page of vehicles", async () => {
      const ids = Array.from({ length: 20 }, (_, index) => `vehicle-${index}`);

      await service.findCurrentDriversForVehicles(ids, TODAY);

      expect(repository.findCoveringVehicles).toHaveBeenCalledTimes(1);
      expect(repository.findCoveringVehicles.mock.calls[0][0]).toHaveLength(20);
    });

    it("asks one query for a whole page of drivers", async () => {
      const ids = Array.from({ length: 20 }, (_, index) => `driver-${index}`);

      await service.findCurrentVehiclesForDrivers(ids, TODAY);

      expect(repository.findCoveringDrivers).toHaveBeenCalledTimes(1);
      expect(repository.findCoveringDrivers.mock.calls[0][0]).toHaveLength(20);
    });

    it("asks the database nothing for an empty page", async () => {
      await service.findCurrentDriversForVehicles([], TODAY);
      await service.findCurrentVehiclesForDrivers([], TODAY);

      expect(repository.findCoveringVehicles).not.toHaveBeenCalled();
      expect(repository.findCoveringDrivers).not.toHaveBeenCalled();
    });

    /** A list showing the same truck twice still costs one row in the query. */
    it("asks about each id once", async () => {
      await service.findCurrentDriversForVehicles(
        ["vehicle-1", "vehicle-1", "vehicle-2"],
        TODAY,
      );

      expect(repository.findCoveringVehicles.mock.calls[0][0]).toEqual([
        "vehicle-1",
        "vehicle-2",
      ]);
    });
  });

  /**
   * A Trip records who drove on a DAY. "The current driver" is a fact about an
   * assignment. Reading one to answer the other is the mistake this whole
   * feature was specified to avoid, and the repository handed to this service
   * has no way to reach a Trip at all.
   */
  it("never consults a Trip", async () => {
    repository.findCoveringVehicles.mockResolvedValue([assignment({})]);

    await service.findCurrentDriversForVehicles(["vehicle-1"], TODAY);

    expect(Object.keys(repository)).toEqual([
      "findCoveringVehicles",
      "findCoveringDrivers",
    ]);
  });
});
