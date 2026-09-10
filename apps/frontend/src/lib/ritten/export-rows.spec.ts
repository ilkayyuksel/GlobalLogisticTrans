import type { PricingSnapshot, Trip, TripPricingItem } from "@/lib/api/types";
import {
  toBasicRow,
  toCostsLabel,
  toManualPropertyIds,
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

/**
 * The canonical route the backend would derive, so this fixture answers the way
 * the API answers: TERMINAL to CITY on a delivery, CITY to TERMINAL on a
 * collection, with the PSA prefix off the terminal.
 */
function routeFor(trip: Partial<Trip>): Trip["route"] {
  const terminal = (trip.terminal ?? "").replace(/^PSA\s+(?=Quay\b)/i, "");
  const city = trip.destinationCity ?? "";

  if (terminal === "" && city === "") {
    return null;
  }

  return trip.direction === "COLLECTION"
    ? { from: city, to: terminal }
    : { from: terminal, to: city };
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  const trip = {
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

  return {
    ...trip,
    route: "route" in overrides ? (overrides.route ?? null) : routeFor(trip),
  };
}

describe("the Trip column", () => {
  it("reads as start to end", () => {
    expect(toRouteLabel(buildTrip())).toBe("Quay 869 → Gent");
  });

  /**
   * The CANONICAL terminal, which is the one change this column made: the
   * documents spell the same quay two ways, and the export must not describe
   * them as two places.
   */
  it("writes the canonical terminal, never an id", () => {
    const label = toRouteLabel(
      buildTrip({ terminal: "PSA Quay 869", destinationCity: "Dourges" }),
    );

    expect(label).toBe("Quay 869 → Dourges");
    expect(label).not.toMatch(/trip-1|[0-9a-f]{8}-/);
  });

  /** A collection runs the other way: the customer first, the quay second. */
  it("follows the direction rather than the field order", () => {
    expect(
      toRouteLabel(
        buildTrip({
          direction: "COLLECTION",
          terminal: "PSA Quay 869",
          destinationCity: "Dourges",
        }),
      ),
    ).toBe("Dourges → Quay 869");
  });

  it("shows the one end it has rather than inventing the other", () => {
    expect(toRouteLabel(buildTrip({ terminal: null }))).toBe(" → Gent");
    expect(toRouteLabel(buildTrip({ destinationCity: null }))).toBe(
      "Quay 869 → ",
    );
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
        trip: "Quay 869 → Gent",
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
  /**
   * The catalog as the export reads it: two ordinary properties an operator
   * chooses, one route-priced component and one the SYSTEM manages. Only the
   * first two may be named in Info.
   */
  const FIXED = toManualPropertyIds([
    { id: "prop-1", pricingComponentId: null, isSystemManaged: false },
    { id: "prop-2", pricingComponentId: null, isSystemManaged: false },
    { id: "toll", pricingComponentId: "component-toll", isSystemManaged: true },
    { id: "flat", pricingComponentId: null, isSystemManaged: true },
  ] as never);

  /**
   * The row carries the GROUP, not the status. `AFGEWERKT` was TRANO's own
   * tenth column and has been removed; the sheet is the reference's nine again.
   * The group id decides the row's background colour — see `combinationFillArgb`.
   */
  it("carries the Trip's group so the row can be coloured", () => {
    expect(
      toBasicRow(
        buildTrip({ tripGroupId: "group-1" }),
        null,
        FIXED,
        "Wachttijd",
      ).tripGroupId,
    ).toBe("group-1");
  });

  it("carries null for a Trip in no group", () => {
    expect(
      toBasicRow(buildTrip({ tripGroupId: null }), null, FIXED, "Wachttijd")
        .tripGroupId,
    ).toBeNull();
  });

  /** The status is not a column any more, in any form. */
  it.each(["OPEN", "CLOSED", "CANCELLED", "DELETED"] as const)(
    "exposes no completed flag for a %s Trip",
    (status) => {
      expect(
        toBasicRow(buildTrip({ status }), null, FIXED, "Wachttijd"),
      ).not.toHaveProperty("isCompleted");
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
          { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
          { id: "prop-2", name: "Over/EX", isActive: true },
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

    expect(row.info).toBe("Aan/Afkoppelen, Over/EX, Wachttijd 1 u 30 min");
  });

  /**
   * ── SYSTEM-MANAGED PROPERTIES ARE NOT NAMED ──────────────────────────────
   * Flat is written by the container-type rule and TAR by the Engine itself.
   * Neither is a choice an operator made, so listing them among the properties
   * somebody chose would misrepresent who decided what. Their amounts stay in
   * Kosten; this column is about choices.
   */
  it("does not name a system-managed property in Info", () => {
    const row = toBasicRow(
      buildTrip({
        customProperties: [
          { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
          { id: "flat", name: "Flat", isActive: true },
        ],
      }),
      snapshotOf(
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("CUSTOM_PROPERTY", "20.00", "flat"),
      ),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Aan/Afkoppelen");
    // Its amount is still charged — only the NAME is withheld. Kosten lists
    // the amounts as the sheet has always done, one per property.
    expect(row.costs).toBe("35.00 + 20.00");
  });

  /** Several manual properties are listed in the order the Trip carries them. */
  it("names every manual property that is assigned", () => {
    const row = toBasicRow(
      buildTrip({
        customProperties: [
          { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
          { id: "prop-2", name: "Over/EX", isActive: true },
        ],
      }),
      snapshotOf(
        line("CUSTOM_PROPERTY", "20.00", "prop-1"),
        line("CUSTOM_PROPERTY", "15.00", "prop-2"),
      ),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Aan/Afkoppelen, Over/EX");
    expect(row.costs).toBe("20.00 + 15.00");
  });

  /**
   * The row is built from whatever it is HANDED. A property assigned after the
   * Trip was closed appears because the export re-reads the Trip and its
   * recalculated snapshot at export time — and a removed one disappears for
   * the same reason. Nothing here caches anything.
   */
  it("names a property added after the Trip was closed", () => {
    const closed = buildTrip({
      status: "CLOSED",
      customProperties: [
        { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
      ],
    });

    const row = toBasicRow(
      closed,
      snapshotOf(line("CUSTOM_PROPERTY", "20.00", "prop-1")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Aan/Afkoppelen");
    expect(row.costs).toBe("20.00");
  });

  it("drops it again once it is removed", () => {
    const row = toBasicRow(
      buildTrip({ status: "CLOSED", customProperties: [] }),
      snapshotOf(),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("");
    expect(row.costs).toBe("");
  });

  /**
   * ── TAR: THE WORD, NEVER THE NUMBER ──────────────────────────────────────
   * Whether TAR applied is the Engine's answer, read back out of the stored
   * snapshot — so the stated number, the Combination leg and the same-day rule
   * that withholds a number already charged that day are all honoured without
   * this file knowing any of them.
   */
  describe("TAR in Info", () => {
    const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

    function withTarCharged() {
      return snapshotOf(line("CUSTOM_PROPERTY", "50.00", TAR_ID));
    }

    it("says TAR when the Engine charged it", () => {
      expect(
        toBasicRow(buildTrip({ tarNummer: "TAR123" }), withTarCharged(), FIXED, "Wachttijd", TAR_ID).info,
      ).toBe("TAR");
    });

    /** The whole point: the number is business data and never leaves here. */
    it("never prints the number itself", () => {
      const row = toBasicRow(buildTrip({ tarNummer: "TAR123" }), withTarCharged(), FIXED, "Wachttijd", TAR_ID);

      expect(row.info).not.toContain("TAR123");
      expect(JSON.stringify(row)).not.toContain("TAR123");
    });

    /**
     * The same-day rule: Trip B states the number but the Engine withheld the
     * charge, so no line exists and Info says nothing.
     */
    it("says nothing when the charge was withheld, even with a number stated", () => {
      expect(
        toBasicRow(buildTrip({ tarNummer: "TAR123" }), snapshotOf(line("BASE_PRICE", "300.00")), FIXED, "Wachttijd", TAR_ID).info,
      ).toBe("");
    });

    it.each([
      ["null", null],
      ["an empty string", ""],
      ["whitespace only", "   "],
    ])("says nothing when the number is %s", (_label, tarNummer) => {
      expect(
        toBasicRow(buildTrip({ tarNummer }), snapshotOf(line("BASE_PRICE", "300.00")), FIXED, "Wachttijd", TAR_ID).info,
      ).toBe("");
    });

    /** The AMOUNT stays where amounts live. */
    it("leaves the amount in the pricing columns", () => {
      const row = toBasicRow(buildTrip({ tarNummer: "TAR123" }), withTarCharged(), FIXED, "Wachttijd", TAR_ID);

      expect(row.costs).toBe("50.00");
      expect(row.info).toBe("TAR");
    });

    it("says nothing when the automatic property is not configured", () => {
      expect(
        toBasicRow(buildTrip({ tarNummer: "TAR123" }), withTarCharged(), FIXED, "Wachttijd", null).info,
      ).toBe("");
    });
  });

  /**
   * ── INTERNAL NOTES ────────────────────────────────────────────────────────
   * Verbatim, last, with no label. The sheet has no convention for one, and
   * inventing "Notitie: " would be a format nobody asked for.
   */
  describe("internal notes in Info", () => {
    function infoFor(internalNotes: string | null): string {
      return toBasicRow(buildTrip({ internalNotes }), snapshotOf(), FIXED, "Wachttijd").info;
    }

    it("includes the text as it was written", () => {
      expect(infoFor("Chauffeur bellen bij aankomst")).toBe("Chauffeur bellen bij aankomst");
    });

    it.each([
      ["null", null],
      ["an empty string", ""],
      ["whitespace only", "   "],
      ["a tab", "	"],
    ])("includes nothing for %s", (_label, notes) => {
      expect(infoFor(notes)).toBe("");
    });

    /** A note's own commas are part of what somebody wrote. */
    it("keeps a note's commas intact", () => {
      expect(infoFor("Bellen, dan poort 4, papieren mee")).toBe("Bellen, dan poort 4, papieren mee");
    });

    it("trims the edges but not the middle", () => {
      expect(infoFor("  Poort 4  gebruiken  ")).toBe("Poort 4  gebruiken");
    });
  });

  /** Everything at once, in the order the file assembles it. */
  it("assembles every source in one cell, in order", () => {
    const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

    const row = toBasicRow(
      buildTrip({
        isLooseTrip: true,
        tarNummer: "TAR123",
        waitingTimeMinutes: 90,
        internalNotes: "Chauffeur bellen bij aankomst",
        customProperties: [
          { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
          { id: "flat", name: "Flat", isActive: true },
        ],
      }),
      snapshotOf(
        line("CUSTOM_PROPERTY", "20.00", "prop-1"),
        line("CUSTOM_PROPERTY", "20.00", "flat"),
        line("CUSTOM_PROPERTY", "50.00", TAR_ID),
        line("WAITING_TIME", "25.00"),
      ),
      FIXED,
      "Wachttijd",
      TAR_ID,
    );

    expect(row.info).toBe(
      "LOSRIT, Aan/Afkoppelen, TAR, Wachttijd 1 u 30 min, Chauffeur bellen bij aankomst",
    );
    expect(row.info).not.toContain("Flat");
    expect(row.info).not.toContain("TAR123");
  });

  /** A route-priced property is not part of Kosten, so it is not named here. */
  it("does not name a route-priced property in Info", () => {
    const row = toBasicRow(
      buildTrip({
        customProperties: [
          { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
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

    expect(row.info).toBe("Aan/Afkoppelen");
    expect(row.costs).toBe("35.00");
  });


  /**
   * The window an operator actually read off a clock, in the printed sheet's
   * own compact form. It is a DISPLAY of the stored times — the minutes stay
   * what pricing bills from, and nothing here recomputes them.
   */
  it("shows the stored waiting window rather than a duration", () => {
    const row = toBasicRow(
      buildTrip({
        waitingTimeStart: "07:00:00",
        waitingTimeEnd: "10:00:00",
        waitingTimeMinutes: 180,
      }),
      snapshotOf(line("WAITING_TIME", "25.00")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Wachttijd 07:00-10:00");
  });

  /**
   * A Trip whose waiting time was entered before the two times were recorded
   * has no window to show, so it shows the duration it does have. Inventing a
   * window would put hours on the page that nobody ever read.
   */
  it("falls back to the duration when no window was stored", () => {
    const row = toBasicRow(
      buildTrip({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeMinutes: 90,
      }),
      snapshotOf(line("WAITING_TIME", "25.00")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Wachttijd 1 u 30 min");
  });

  /** A half-filled window is not a window; an end with no beginning is not one. */
  it("falls back to the duration when only one side was stored", () => {
    const row = toBasicRow(
      buildTrip({
        waitingTimeStart: "07:00:00",
        waitingTimeEnd: null,
        waitingTimeMinutes: 45,
      }),
      snapshotOf(line("WAITING_TIME", "25.00")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("Wachttijd 45 min");
  });

  /**
   * LOSRIT is an operational note about the work, so it goes in INFO with the
   * other notes — never into a status column and never into a column of its own.
   */
  it("names a loose trip first in Info", () => {
    const row = toBasicRow(
      buildTrip({
        isLooseTrip: true,
        customProperties: [{ id: "prop-1", name: "TAR", isActive: true }],
      }),
      snapshotOf(line("CUSTOM_PROPERTY", "35.00", "prop-1")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).toBe("LOSRIT, TAR");
  });

  it("says nothing about a Trip that is not a loose trip", () => {
    const row = toBasicRow(
      buildTrip({ isLooseTrip: false }),
      snapshotOf(line("CUSTOM_PROPERTY", "35.00", "prop-1")),
      FIXED,
      "Wachttijd",
    );

    expect(row.info).not.toContain("LOSRIT");
  });

  /** LOSRIT is a note, not a price: it never appears in the Kosten column. */
  it("keeps a loose trip out of the costs column", () => {
    const row = toBasicRow(
      buildTrip({ isLooseTrip: true }),
      null,
      FIXED,
      "Wachttijd",
    );

    expect(row.costs).toBe("");
    expect(row.info).toBe("LOSRIT");
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

/**
 * ── COMBI EN KOST CARRIES THE COMBINATION SURCHARGE ─────────────────────────
 * The office sheet prints each Combination leg with its surcharge in this
 * column — `50.00`, or `50.00+137.50` when the leg also waited — and the export
 * used to leave it out. The amount is the Engine's own COMBINATION line, per
 * Trip; the export never decides whether a Trip is part of a Combination.
 */
describe("the Combination surcharge in COMBI EN KOST", () => {
  const MANUAL = toManualPropertyIds([
    { id: "prop-1", pricingComponentId: null, isSystemManaged: false },
  ] as never);

  function costsOf(...lines: ReturnType<typeof line>[]): string {
    return toBasicRow(buildTrip(), snapshotOf(...lines), MANUAL, "Wachttijd")
      .costs;
  }

  it("prints a leg's surcharge", () => {
    expect(costsOf(line("BASE_PRICE", "300.00"), line("COMBINATION", "50.00"))).toBe(
      "50.00",
    );
  });

  it("puts it before the properties and the waiting time", () => {
    expect(
      costsOf(
        line("COMBINATION", "50.00"),
        line("CUSTOM_PROPERTY", "35.00", "prop-1"),
        line("WAITING_TIME", "137.50"),
      ),
    ).toBe("50.00 + 35.00 + 137.50");
  });

  /** A standalone Trip has no COMBINATION line, so nothing is added. */
  it("adds nothing to a Trip with no surcharge line", () => {
    expect(costsOf(line("BASE_PRICE", "300.00"), line("WAITING_TIME", "25.00"))).toBe(
      "25.00",
    );
  });

  /** A configured zero is a real line, and the sheet says so. */
  it("prints a zero surcharge the Engine stored", () => {
    expect(costsOf(line("COMBINATION", "0.00"))).toBe("0.00");
  });

  it("leaves the cell empty for an unpriced Trip", () => {
    expect(
      toBasicRow(buildTrip(), null, MANUAL, "Wachttijd").costs,
    ).toBe("");
  });
});
