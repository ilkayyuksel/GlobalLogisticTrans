import type { PricingSnapshot, Trip, TripPricingItem } from "@/lib/api/types";
import {
  toBasicRow,
  toCostsLabel,
  toFixedPropertyIds,
  toPricingRow,
  toRemarks,
  toRouteLabel,
} from "./export-rows";
import { toPricedTripLines } from "./pricing-lines";

/**
 * What a Trip becomes in each export.
 *
 * The rule running through all of it: every amount comes from a STORED pricing
 * line. Nothing here derives a price, and an unpriced Trip leaves its pricing
 * cells empty rather than showing a zero it never had.
 */
function line(code: string, amount: string, customPropertyId: string | null = null) {
  return {
    id: `item-${code}`,
    tripPricingId: "pricing-1",
    pricingComponentId: `component-${code}`,
    pricingComponentCode: code,
    customPropertyId,
    description: code,
    amount,
    currency: "EUR",
    calculationOrder: 1,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  } as TripPricingItem;
}

function snapshotOf(...items: TripPricingItem[]): PricingSnapshot {
  return {
    pricing: {
      id: "pricing-1",
      tripId: "trip-1",
      totalPrice: "0.00",
      currency: "EUR",
      calculatedAt: "2026-08-17T00:00:00.000Z",
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "2026.1",
      calculationStatus: "CALCULATED",
      notes: null,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    items,
  };
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: "OPEN",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Gent",
    destinationCountry: "Belgium",
    planningDate: "2026-06-29",
    startTime: "07:00:00",
    endTime: "15:00:00",
    waitingTimeMinutes: null,
    direction: null,
    tripGroupId: null,
    vehicle: null,
    customProperties: [],
    ...overrides,
  } as Trip;
}

describe("the Trip column", () => {
  it("reads as start -> end", () => {
    expect(toRouteLabel(buildTrip())).toBe("Quay 869 -> Gent");
  });

  it("uses the stored terminal and city, never an id", () => {
    const label = toRouteLabel(
      buildTrip({ terminal: "PSA Quay 869", destinationCity: "Dourges" }),
    );

    expect(label).toBe("PSA Quay 869 -> Dourges");
    expect(label).not.toMatch(/trip-1|[0-9a-f]{8}-/);
  });

  it("shows the one end it has rather than inventing the other", () => {
    expect(toRouteLabel(buildTrip({ terminal: null }))).toBe("Gent");
    expect(toRouteLabel(buildTrip({ destinationCity: null }))).toBe("Quay 869");
  });

  it("is empty when the Trip has neither", () => {
    expect(
      toRouteLabel(buildTrip({ terminal: null, destinationCity: null })),
    ).toBe("");
  });
});

describe("Remarks", () => {
  it("names the assigned Custom Properties, as configured", () => {
    const trip = buildTrip({
      customProperties: [
        { id: "a", name: "TAR", isActive: true },
        { id: "b", name: "Flat", isActive: true },
      ],
    });

    expect(toRemarks(trip)).toBe("TAR, Flat");
  });

  it("is empty when none is assigned", () => {
    expect(toRemarks(buildTrip())).toBe("");
  });
});

describe("the pricing row", () => {
  it("takes every amount from a stored line", () => {
    const row = toPricingRow(
      buildTrip(),
      snapshotOf(
        line("BASE_PRICE", "250.00"),
        line("FUEL_SURCHARGE", "37.50"),
        line("TOLL", "9.75"),
        line("TUNNEL", "6.20"),
        line("WAITING_TIME", "25.00"),
      ),
      15,
    );

    expect(row).toMatchObject({
      basePrice: 250,
      fuelAmount: 37.5,
      toll: 9.75,
      tunnel: 6.2,
      waitingTime: 25,
    });
  });

  /** Configuration labels the stored amount; it never produces one. */
  it("shows the configured fuel percentage beside the stored surcharge", () => {
    const row = toPricingRow(
      buildTrip(),
      snapshotOf(line("FUEL_SURCHARGE", "37.50")),
      22,
    );

    expect(row.fuelPercentage).toBe(22);
    expect(row.fuelAmount).toBe(37.5);
  });

  it("shows no percentage when no surcharge was charged", () => {
    const row = toPricingRow(buildTrip(), snapshotOf(line("BASE_PRICE", "250.00")), 15);

    expect(row.fuelPercentage).toBeNull();
    expect(row.fuelAmount).toBeNull();
  });

  it("puts the Combination surcharge in Backload", () => {
    const row = toPricingRow(
      buildTrip(),
      snapshotOf(line("COMBINATION", "75.00")),
      15,
    );

    expect(row.backload).toBe(75);
  });

  it("leaves Backload empty for a Trip that is not a Combination", () => {
    const row = toPricingRow(buildTrip(), snapshotOf(line("BASE_PRICE", "250.00")), 15);

    expect(row.backload).toBeNull();
  });

  /** Several fixed properties become one Others cell. */
  it("sums the fixed Custom Property lines into Others", () => {
    const row = toPricingRow(
      buildTrip(),
      snapshotOf(
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("CUSTOM_PROPERTY", "50.00", "prop-2"),
      ),
      15,
    );

    expect(row.others).toBe(85);
  });

  /**
   * A route-priced property is charged through its own component, so it has its
   * own column. Counting it in Others as well would double it.
   */
  it("keeps Toll and Tunnel out of Others", () => {
    const row = toPricingRow(
      buildTrip(),
      snapshotOf(
        line("TOLL", "9.75"),
        line("TUNNEL", "6.20"),
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
      ),
      15,
    );

    expect(row.others).toBe(35);
    expect(row.toll).toBe(9.75);
    expect(row.tunnel).toBe(6.2);
  });

  describe("a Trip that was never priced", () => {
    it("still exports its operational fields", () => {
      const row = toPricingRow(buildTrip(), null, 15);

      expect(row).toMatchObject({
        planningDate: "2026-06-29",
        bookingNumber: "ANRDUB2602247",
        containerType: "45PH",
        trip: "Quay 869 -> Gent",
      });
    });

    /** Empty, never 0.00: not priced and priced at zero are different facts. */
    it("leaves every pricing cell empty", () => {
      const row = toPricingRow(buildTrip(), null, 15);

      expect(row.basePrice).toBeNull();
      expect(row.fuelAmount).toBeNull();
      expect(row.fuelPercentage).toBeNull();
      expect(row.backload).toBeNull();
      expect(row.toll).toBeNull();
      expect(row.tunnel).toBeNull();
      expect(row.others).toBeNull();
      expect(row.waitingTime).toBeNull();
    });
  });

  it("writes an empty cell for every absent value, never a placeholder", () => {
    const row = toPricingRow(
      buildTrip({
        bookingNumber: null,
        containerNumber: null,
        containerType: null,
        terminal: null,
        destinationCity: null,
      }),
      null,
      15,
    );

    for (const value of [
      row.bookingNumber,
      row.containerNumber,
      row.containerType,
      row.startPoint,
      row.endPoint,
    ]) {
      expect(value).toBe("");
    }

    expect(JSON.stringify(row)).not.toMatch(/null"|N\/A|undefined/i);
  });
});

describe("the basic row", () => {
  const FIXED = toFixedPropertyIds([
    { id: "prop-1", pricingComponentId: null },
    { id: "prop-2", pricingComponentId: null },
    { id: "toll", pricingComponentId: "component-toll" },
  ] as never);

  it("marks a CLOSED Trip as completed", () => {
    expect(toBasicRow(buildTrip({ status: "CLOSED" }), null, FIXED, "Wachttijd"))
      .toMatchObject({ isCompleted: true });
  });

  it.each(["OPEN", "CANCELLED", "DELETED"] as const)(
    "leaves a %s Trip unmarked",
    (status) => {
      expect(
        toBasicRow(buildTrip({ status }), null, FIXED, "Wachttijd").isCompleted,
      ).toBe(false);
    },
  );

  it("shows the plate, never the vehicle id", () => {
    const row = toBasicRow(
      buildTrip({
        vehicle: {
          id: "vehicle-1",
          licensePlate: "1-ABC-123",
          displayColor: "#2563eb",
          isActive: true,
        },
      }),
      null,
      FIXED,
      "Wachttijd",
    );

    expect(row.licensePlate).toBe("1-ABC-123");
    expect(row.licensePlate).not.toContain("vehicle-1");
  });

  it("leaves the plate blank when no truck is assigned", () => {
    expect(toBasicRow(buildTrip(), null, FIXED, "Wachttijd").licensePlate).toBe("");
  });

  /** Fixed properties and waiting time — not base price, fuel, toll, tunnel. */
  it("lists the fixed property and waiting-time amounts", () => {
    const row = toBasicRow(
      buildTrip({ waitingTimeMinutes: 90 }),
      snapshotOf(
        line("BASE_PRICE", "250.00"),
        line("FUEL_SURCHARGE", "37.50"),
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("CUSTOM_PROPERTY", "50.00", "prop-2"),
        line("WAITING_TIME", "25.00"),
      ),
      FIXED,
      "Wachttijd",
    );

    expect(row.costs).toBe("35.00 + 50.00 + 25.00");
  });

  it("shows a single cost without a separator", () => {
    const row = toBasicRow(
      buildTrip(),
      snapshotOf(line("CUSTOM_PROPERTY", "35.00", "prop-1")),
      FIXED,
      "Wachttijd",
    );

    expect(row.costs).toBe("35.00");
  });

  it("explains those costs in the same order", () => {
    const row = toBasicRow(
      buildTrip({
        waitingTimeMinutes: 90,
        customProperties: [
          { id: "prop-1", name: "TAR", isActive: true },
          { id: "prop-2", name: "Flat", isActive: true },
        ],
      }),
      snapshotOf(
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("CUSTOM_PROPERTY", "50.00", "prop-2"),
        line("WAITING_TIME", "25.00"),
      ),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("TAR, Flat, Wachttijd 1 u 30 min");
  });

  /** A route-priced property is not part of Kosten, so it is not named here. */
  it("does not name a route-priced property in Info", () => {
    const row = toBasicRow(
      buildTrip({
        customProperties: [
          { id: "prop-1", name: "TAR", isActive: true },
          { id: "toll", name: "Toll", isActive: true },
        ],
      }),
      snapshotOf(
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("TOLL", "9.75", "toll"),
      ),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("TAR");
    expect(row.costs).toBe("35.00");
  });

  it("leaves costs and info empty for an unpriced Trip", () => {
    const row = toBasicRow(buildTrip(), null, FIXED, "Wachttijd");

    expect(row.costs).toBe("");
    expect(row.info).toBe("");
  });
});

describe("toCostsLabel", () => {
  it("formats every amount to two decimals", () => {
    const lines = toPricedTripLines(
      snapshotOf(
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("WAITING_TIME", "7.50"),
      ),
    );

    expect(toCostsLabel(lines)).toBe("35.00 + 7.50");
  });
});
