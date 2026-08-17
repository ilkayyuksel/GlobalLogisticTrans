import type { Trip } from "@/lib/api/types";
import { toVehicleGroups } from "./vehicle-groups";

/**
 * Splitting a day's Trips into the trucks they run on.
 *
 * The rule this pins down is that grouping FOLLOWS the order the backend sent
 * and never imposes one: the database has already ordered by date, vehicle,
 * time and id, and re-sorting here would order the page in view while claiming
 * to describe the whole period.
 */
function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: overrides.id ?? "trip-1",
    vehicle: null,
    ...overrides,
  } as Trip;
}

function onVehicle(id: string, licensePlate: string, displayColor = "#2563eb"): Trip {
  return buildTrip({
    id,
    vehicle: { id: licensePlate, licensePlate, displayColor, isActive: true },
  } as Partial<Trip>);
}

describe("toVehicleGroups", () => {
  it("has nothing to group when there are no Trips", () => {
    expect(toVehicleGroups([])).toEqual([]);
  });

  it("puts one truck's Trips in a single group", () => {
    const groups = toVehicleGroups([
      onVehicle("a", "1-ABC-123"),
      onVehicle("b", "1-ABC-123"),
      onVehicle("c", "1-ABC-123"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].licensePlate).toBe("1-ABC-123");
    expect(groups[0].trips.map((trip) => trip.id)).toEqual(["a", "b", "c"]);
  });

  it("separates different trucks", () => {
    const groups = toVehicleGroups([
      onVehicle("a", "1-ABC-123"),
      onVehicle("b", "2-GUR-425"),
    ]);

    expect(groups.map((group) => group.licensePlate)).toEqual([
      "1-ABC-123",
      "2-GUR-425",
    ]);
  });

  it("carries the truck's own colour for the heading", () => {
    const [group] = toVehicleGroups([onVehicle("a", "1-ABC-123", "#059669")]);

    expect(group.displayColor).toBe("#059669");
  });

  /** The backend sorts unassigned Trips last; the grouping simply follows. */
  it("keeps the Trips with no truck together, in the order given", () => {
    const groups = toVehicleGroups([
      onVehicle("a", "1-ABC-123"),
      buildTrip({ id: "b" }),
      buildTrip({ id: "c" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1].licensePlate).toBeNull();
    expect(groups[1].displayColor).toBeNull();
    expect(groups[1].trips.map((trip) => trip.id)).toEqual(["b", "c"]);
  });

  /**
   * A map keyed by plate would silently merge these two blocks and hide the
   * fact that the order was not what it claimed. Consecutive runs report what
   * actually arrived.
   */
  it("does not merge two separated blocks of the same truck", () => {
    const groups = toVehicleGroups([
      onVehicle("a", "1-ABC-123"),
      onVehicle("b", "2-GUR-425"),
      onVehicle("c", "1-ABC-123"),
    ]);

    expect(groups.map((group) => group.licensePlate)).toEqual([
      "1-ABC-123",
      "2-GUR-425",
      "1-ABC-123",
    ]);
  });

  it("never reorders the Trips it was given", () => {
    const groups = toVehicleGroups([
      onVehicle("late", "1-ABC-123"),
      onVehicle("early", "1-ABC-123"),
    ]);

    expect(groups[0].trips.map((trip) => trip.id)).toEqual(["late", "early"]);
  });
});
