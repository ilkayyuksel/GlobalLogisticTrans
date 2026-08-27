import type { Vehicle } from "@/lib/api/types";
import { toVehicleLabel } from "./vehicle-label";

/**
 * How a vehicle is named in the Ritten picker.
 *
 * The rule is shared with the Voertuigen list on purpose: both read
 * `currentDriver`, which the backend resolves from VehicleAssignment, so a
 * truck cannot be shown with one driver in the picker and another in the fleet
 * list. These tests pin the formatting; the backend's own suite pins who the
 * driver actually is.
 */
function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "vehicle-1",
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: null,
    brand: null,
    model: null,
    year: null,
    notes: null,
    isActive: true,
    currentDriver: null,
    ...overrides,
  };
}

describe("naming a vehicle for the picker", () => {
  it("writes the plate and the current driver", () => {
    const label = toVehicleLabel(
      buildVehicle({
        currentDriver: { id: "driver-1", name: "Jan Janssens", isActive: true },
      }),
    );

    expect(label).toBe("1-ABC-123 (Jan Janssens)");
  });

  /** `1-DEF-789 ()` reads as a missing name, not as an unassigned truck. */
  it("writes the plate alone when nobody is assigned", () => {
    expect(toVehicleLabel(buildVehicle())).toBe("1-ABC-123");
    expect(toVehicleLabel(buildVehicle())).not.toContain("(");
  });

  it("writes the plate alone when the name is only whitespace", () => {
    const label = toVehicleLabel(
      buildVehicle({
        currentDriver: { id: "driver-1", name: "   ", isActive: true },
      }),
    );

    expect(label).toBe("1-ABC-123");
  });

  /**
   * A driver deactivated while still assigned is still on the truck. Hiding
   * the name would make the option look unassigned, which it is not.
   */
  it("still names a driver who has since been deactivated", () => {
    const label = toVehicleLabel(
      buildVehicle({
        currentDriver: { id: "driver-1", name: "Piet Janssens", isActive: false },
      }),
    );

    expect(label).toBe("1-ABC-123 (Piet Janssens)");
  });

  it("trims a name padded by the data", () => {
    const label = toVehicleLabel(
      buildVehicle({
        currentDriver: { id: "driver-1", name: " Mehmet Yilmaz ", isActive: true },
      }),
    );

    expect(label).toBe("1-ABC-123 (Mehmet Yilmaz)");
  });
});
