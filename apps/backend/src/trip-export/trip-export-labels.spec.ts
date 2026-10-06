import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  toPricingRemarks,
  toTripExportLabels,
  toWaitingLabel,
  wasTarChargedIn,
  type LabelledSnapshot,
  type LabelledTrip,
} from "./trip-export-labels";

/**
 * The words the exports print about a Trip.
 *
 * ── PORTED, NOT REWRITTEN ───────────────────────────────────────────────────
 * Every expectation below is the one the browser's own export tests held
 * before this vocabulary moved to the server (`pricing-detail.xlsx.spec.ts`
 * and `export-rows.spec.ts`): the same inputs, the same words. They pin that
 * the move changed WHERE the words are composed, and nothing about what they
 * say.
 */

/** The Custom Property the Engine applies on its own, as Settings names it. */
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

function trip(overrides: Partial<LabelledTrip> = {}): LabelledTrip {
  return {
    customProperties: [],
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    costConfirmation: null,
    ...overrides,
  };
}

function snapshotOf(
  ...lines: { code: string; customPropertyId?: string; description?: string }[]
): LabelledSnapshot {
  return {
    items: lines.map((line) => ({
      pricingComponentCode: line.code,
      customPropertyId: line.customPropertyId ?? null,
      description: line.description ?? line.code,
    })),
  };
}

/** The Engine's own wording for the EK line. See `cost-confirmation.calculator.ts`. */
function confirmedBy(...ccNumbers: string[]): string {
  return ccNumbers.length === 1
    ? `Cost confirmation ${ccNumbers[0]}`
    : `Cost confirmations ${ccNumbers.join(", ")}`;
}

const remarksOf = (labelled: LabelledTrip, snapshot: LabelledSnapshot | null) =>
  toPricingRemarks(labelled, snapshot, TAR_ID);

describe("the Cost Confirmation references in Remarks", () => {
  const WITH_PROPERTY = trip({ customProperties: [{ id: "prop-1", name: "Aan/Afkoppelen" }] });

  it("says nothing when the Trip has no confirmation", () => {
    expect(remarksOf(WITH_PROPERTY, snapshotOf({ code: "BASE_PRICE" }))).toBe(
      "Aan/Afkoppelen",
    );
  });

  it("adds the reference of the one confirmation, keeping the remarks", () => {
    expect(
      remarksOf(
        WITH_PROPERTY,
        snapshotOf({ code: "BASE_PRICE" }, { code: "COST_CONFIRMATION", description: confirmedBy("4139505") }),
      ),
    ).toBe("Aan/Afkoppelen | CC4139505");
  });

  it("names every confirmation of a Trip confirmed in instalments", () => {
    expect(
      remarksOf(
        WITH_PROPERTY,
        snapshotOf({ code: "COST_CONFIRMATION", description: confirmedBy("4139505", "4156173", "4161980") }),
      ),
    ).toBe("Aan/Afkoppelen | CC4139505 | CC4156173 | CC4161980");
  });

  it("never repeats a reference", () => {
    expect(
      remarksOf(trip(), snapshotOf({ code: "COST_CONFIRMATION", description: confirmedBy("4139505", "4139505") })),
    ).toBe("CC4139505");
  });

  /** A snapshot older than the confirmation: the Trip's latest one answers. */
  it("falls back to the Trip's own latest confirmation", () => {
    expect(
      remarksOf(trip({ costConfirmation: { ccNumber: "4208847" } }), snapshotOf({ code: "BASE_PRICE" })),
    ).toBe("CC4208847");
  });

  it("prefers the references on the stored EK line over the fallback", () => {
    expect(
      remarksOf(
        trip({ costConfirmation: { ccNumber: "4208847" } }),
        snapshotOf({ code: "COST_CONFIRMATION", description: confirmedBy("4139505") }),
      ),
    ).toBe("CC4139505");
  });
});

describe("TAR and the waiting time in Remarks", () => {
  it("names a TAR the Engine charged, never the number", () => {
    expect(
      remarksOf(trip(), snapshotOf({ code: "BASE_PRICE" }, { code: "CUSTOM_PROPERTY", customPropertyId: TAR_ID })),
    ).toBe("TAR");
  });

  it("says nothing when the charge was withheld", () => {
    expect(remarksOf(trip(), snapshotOf({ code: "BASE_PRICE" }))).toBe("");
  });

  it("does not repeat a TAR the Trip already carries as a property", () => {
    expect(
      remarksOf(
        trip({ customProperties: [{ id: TAR_ID, name: "TAR" }] }),
        snapshotOf({ code: "CUSTOM_PROPERTY", customPropertyId: TAR_ID }),
      ),
    ).toBe("TAR");
  });

  it("prints the waiting window", () => {
    expect(
      remarksOf(
        trip({ waitingTimeStart: "07:00:00", waitingTimeEnd: "10:00:00", waitingTimeMinutes: 180 }),
        snapshotOf({ code: "WAITING_TIME" }),
      ),
    ).toBe("Wachttijd 07:00-10:00");
  });

  it("falls back to the duration", () => {
    expect(remarksOf(trip({ waitingTimeMinutes: 90 }), snapshotOf({ code: "WAITING_TIME" }))).toBe(
      "Wachttijd 1 u 30 min",
    );
  });

  it("puts the properties, TAR, the waiting time and the confirmations in order", () => {
    expect(
      remarksOf(
        trip({
          waitingTimeStart: "07:00:00",
          waitingTimeEnd: "10:00:00",
          waitingTimeMinutes: 180,
          customProperties: [{ id: "prop-1", name: "Aan/Afkoppelen" }],
        }),
        snapshotOf(
          { code: "BASE_PRICE" },
          { code: "CUSTOM_PROPERTY", customPropertyId: TAR_ID },
          { code: "WAITING_TIME" },
          { code: "COST_CONFIRMATION", description: confirmedBy("4139505") },
        ),
      ),
    ).toBe("Aan/Afkoppelen | TAR | Wachttijd 07:00-10:00 | CC4139505");
  });

  /** An unpriced Trip still has its own properties and waiting time to state. */
  it("states what the Trip itself holds when it has no snapshot", () => {
    expect(
      remarksOf(
        trip({ customProperties: [{ id: "p", name: "Flat" }], waitingTimeMinutes: 45 }),
        null,
      ),
    ).toBe("Flat | Wachttijd 45 min");
  });
});

describe("the waiting-time label", () => {
  it("shows the stored window rather than a duration", () => {
    expect(
      toWaitingLabel(trip({ waitingTimeStart: "07:00:00", waitingTimeEnd: "10:00:00", waitingTimeMinutes: 180 })),
    ).toBe("Wachttijd 07:00-10:00");
  });

  /** Without it, a sheet would show a two-hour window billed as sixteen hours. */
  it("says when the window ends the next day", () => {
    const nextDay = trip({
      waitingTimeStart: "10:00:00",
      waitingTimeEnd: "12:00:00",
      waitingTimeEndsNextDay: true,
      waitingTimeMinutes: 960,
    });

    expect(toWaitingLabel(nextDay)).toBe("Wachttijd 10:00-12:00 (volgende dag)");
    expect(toWaitingLabel(nextDay, "Bekleme", "ertesi gün")).toBe(
      "Bekleme 10:00-12:00 (ertesi gün)",
    );
  });

  it("carries the next-day words into Remarks", () => {
    expect(
      remarksOf(
        trip({
          waitingTimeStart: "10:00:00",
          waitingTimeEnd: "08:00:00",
          waitingTimeEndsNextDay: true,
          waitingTimeMinutes: 720,
        }),
        snapshotOf({ code: "WAITING_TIME" }),
      ),
    ).toBe("Wachttijd 10:00-08:00 (volgende dag)");
  });

  it("falls back to the duration when only one side was stored", () => {
    expect(toWaitingLabel(trip({ waitingTimeStart: "07:00:00", waitingTimeMinutes: 90 }))).toBe(
      "Wachttijd 1 u 30 min",
    );
  });

  it.each([
    [60, "Wachttijd 1 u"],
    [45, "Wachttijd 45 min"],
    [0, "Wachttijd 0 min"],
  ])("writes %i minutes as %s", (minutes, label) => {
    expect(toWaitingLabel(trip({ waitingTimeMinutes: minutes }))).toBe(label);
  });

  it("is absent when nothing was recorded", () => {
    expect(toWaitingLabel(trip())).toBeNull();
  });

  /** The client owns translation; the server only places its word. */
  it("uses the word it is given", () => {
    expect(toWaitingLabel(trip({ waitingTimeMinutes: 30 }), "Bekleme")).toBe("Bekleme 30 min");
  });
});

describe("whether TAR was charged", () => {
  it("reads the charge off the stored snapshot", () => {
    expect(wasTarChargedIn(snapshotOf({ code: "CUSTOM_PROPERTY", customPropertyId: TAR_ID }), TAR_ID)).toBe(true);
  });

  it("is false without a snapshot, or without the TAR setting", () => {
    expect(wasTarChargedIn(null, TAR_ID)).toBe(false);
    expect(wasTarChargedIn(snapshotOf({ code: "CUSTOM_PROPERTY", customPropertyId: TAR_ID }), null)).toBe(false);
  });
});

/**
 * ── THE LIVE CAPTURES: ONE VOCABULARY, CHECKED AGAINST REAL DATA ────────────
 * The browser's export tests read JSON captured from the running backend:
 * real Trips, closed through the real endpoint, priced by the real Engine. The
 * words for those Trips are now composed here, so this suite composes them
 * from the very same captures and keeps the result beside each one as a
 * `.labels.json` contract the browser's tests read.
 *
 * The contract cannot drift: this test fails the moment what is computed and
 * what is committed differ. `UPDATE_LABEL_FIXTURES=1` rewrites them.
 */
describe("the live captures the browser's export tests read", () => {
  const CAPTURES = resolve(__dirname, "../../../frontend/src/lib/ritten/__fixtures__");
  const captures = existsSync(CAPTURES)
    ? readdirSync(CAPTURES).filter((file) => /^basis-live-.*(?<!\.labels)\.json$/.test(file))
    : [];

  interface Capture {
    readonly trips: (LabelledTrip & { readonly id: string })[];
    readonly snapshots: (LabelledSnapshot & { readonly pricing: { readonly tripId: string } })[];
    readonly settings: { readonly key: string; readonly category: string; readonly value: string }[];
  }

  function labelsFor(capture: Capture) {
    const automatic = capture.settings.find(
      (setting) => setting.key === "AUTOMATIC_CUSTOM_PROPERTY_ID" && setting.category === "PRICING",
    );
    const automaticPropertyId = automatic?.value.trim() ? automatic.value.trim() : null;
    const byTrip = new Map(capture.snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]));

    return Object.fromEntries(
      capture.trips.map((each) => [
        each.id,
        toTripExportLabels(each, byTrip.get(each.id) ?? null, automaticPropertyId),
      ]),
    );
  }

  it("finds the captures", () => {
    expect(captures.length).toBeGreaterThan(0);
  });

  it.each(captures)("%s matches its committed labels", (file) => {
    const capture = JSON.parse(readFileSync(join(CAPTURES, file), "utf8")) as Capture;
    const computed = labelsFor(capture);
    const contract = join(CAPTURES, file.replace(/\.json$/, ".labels.json"));

    if (process.env.UPDATE_LABEL_FIXTURES === "1") {
      writeFileSync(contract, `${JSON.stringify(computed, null, 2)}\n`);
    }

    expect(JSON.parse(readFileSync(contract, "utf8"))).toEqual(computed);
  });
});
