import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Prisma } from "@prisma/client";

import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing, type EngineAmount } from "../trip-pricing/effective-pricing";

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

const remarksOf = (
  labelled: LabelledTrip,
  snapshot: LabelledSnapshot | null,
  confirmationNumbers: readonly string[] = [],
) => toPricingRemarks(labelled, snapshot, TAR_ID, confirmationNumbers);

/**
 * ── THE REFERENCES COME FROM THE RECORDS, NOT FROM THE PRICE ────────────────
 * Which documents Eucon sent is a fact about the Trip. It used to be read off
 * the stored EK line, so a Trip whose price is not shown — an OPEN one, whose
 * snapshot is history — kept only its latest reference.
 */
describe("the Cost Confirmation references", () => {
  const WITH_PROPERTY = trip({ customProperties: [{ id: "prop-1", name: "Aan/Afkoppelen" }] });

  it("says nothing when the Trip has no confirmation", () => {
    expect(remarksOf(WITH_PROPERTY, snapshotOf({ code: "BASE_PRICE" }))).toBe(
      "Aan/Afkoppelen",
    );
  });

  it("adds the reference of the one confirmation, keeping the remarks", () => {
    expect(remarksOf(WITH_PROPERTY, snapshotOf({ code: "BASE_PRICE" }), ["4139505"])).toBe(
      "Aan/Afkoppelen | CC4139505",
    );
  });

  it("names every confirmation, newest first, as the records come", () => {
    expect(
      remarksOf(WITH_PROPERTY, null, ["4161980", "4156173", "4139505"]),
    ).toBe("Aan/Afkoppelen | CC4161980 | CC4156173 | CC4139505");
  });

  it("never repeats a reference", () => {
    expect(remarksOf(trip(), null, ["4139505", "4139505"])).toBe("CC4139505");
  });

  /* An OPEN Trip has no current snapshot; its documents are still its own. */
  it("names every confirmation of a Trip with no current price", () => {
    const labels = toTripExportLabels(trip(), null, TAR_ID, ["4156173", "4139505"]);

    expect(labels.costConfirmations).toEqual(["CC4156173", "CC4139505"]);
    expect(labels.remarks).toBe("CC4156173 | CC4139505");
    expect(labels.tarCharged).toBe(false);
  });

  /* The stored line is not a source: a Trip without records names none. */
  it("does not read references off the stored EK line", () => {
    expect(
      remarksOf(
        trip(),
        snapshotOf({ code: "COST_CONFIRMATION", description: confirmedBy("4139505") }),
      ),
    ).toBe("");
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
        ["4139505"],
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
    readonly trips: (LabelledTrip & {
      readonly id: string;
      readonly costConfirmation: { readonly ccNumber: string } | null;
    })[];
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
        toTripExportLabels(
          each,
          byTrip.get(each.id) ?? null,
          automaticPropertyId,
          recordsOf(each, byTrip.get(each.id) ?? null),
        ),
      ]),
    );
  }

  /**
   * The Trip's confirmation records, as far as a capture holds them.
   *
   * A capture stores the API's answers, not the confirmation table: the
   * numbers it does hold are those the Engine wrote on the EK line, and the
   * Trip's latest confirmation. Every captured Trip was CLOSED when captured,
   * so that line names exactly the records it was priced from.
   */
  function recordsOf(
    each: Capture["trips"][number],
    snapshot: LabelledSnapshot | null,
  ): string[] {
    const line = snapshot?.items.find((item) => item.pricingComponentCode === "COST_CONFIRMATION");
    const stated = line ? /^Cost confirmations?\s+(.+)$/i.exec(line.description) : null;

    if (stated) {
      return stated[1].split(",").map((number) => number.trim());
    }

    return each.costConfirmation ? [each.costConfirmation.ccNumber] : [];
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

  /*
   * ── THE CAPTURES' PRICING IS THE BACKEND'S CURRENT READ ───────────────────
   * Each captured Trip carries the `pricing` the API answered with when it was
   * captured. The read rule has moved since — the waiting time left Others and
   * became an EK source — and nothing checked the captures, so they kept the
   * old answer beside a snapshot whose current answer differs. A browser test
   * reading `trip.pricing` then tested a state the running system can no
   * longer produce. This holds them to `resolveEffectivePricing`, and
   * `UPDATE_LABEL_FIXTURES=1` rewrites the `pricing` of the Trips that drifted.
   */
  it.each(captures)("%s carries the pricing the backend reads today", (file) => {
    const path = join(CAPTURES, file);
    const text = readFileSync(path, "utf8");
    const capture = JSON.parse(text) as PricedCapture;
    const byTrip = new Map(capture.snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]));
    const current = (tripId: string) => {
      const snapshot = byTrip.get(tripId);

      return snapshot
        ? amountsOnly(
            toEffectivePricingDto(resolveEffectivePricing(snapshot.items.map(toEngineAmount), [])),
          )
        : null;
    };

    if (process.env.UPDATE_LABEL_FIXTURES === "1") {
      const drifted = capture.trips.filter(
        (trip) => JSON.stringify(trip.pricing) !== JSON.stringify(current(trip.id)),
      );

      if (drifted.length > 0) {
        for (const trip of drifted) {
          trip.pricing = current(trip.id);
        }
        writeFileSync(path, reformatLike(text, capture));
      }
    }

    const reread = JSON.parse(readFileSync(path, "utf8")) as typeof capture;

    for (const trip of reread.trips) {
      expect({ tripId: trip.id, pricing: trip.pricing }).toEqual({
        tripId: trip.id,
        pricing: current(trip.id),
      });
    }
  });
});

/**
 * The amounts of a breakdown, without its route record: the captures predate
 * `routeMatch`, and what they pin is the money. Writing `routeMatch: null` into
 * them would claim the captured API said so; it said nothing.
 */
function amountsOnly(pricing: ReturnType<typeof toEffectivePricingDto>) {
  const { routeMatch, ...amounts } = pricing;
  void routeMatch;

  return amounts;
}

/** A capture, as far as its Trips' pricing is concerned. */
interface PricedCapture {
  readonly trips: { readonly id: string; pricing: unknown }[];
  readonly snapshots: {
    readonly pricing: { readonly tripId: string };
    readonly items: readonly CapturedItem[];
  }[];
}

interface CapturedItem {
  readonly pricingComponentCode: string;
  readonly amount: string;
  readonly customPropertyId: string | null;
  readonly description: string;
  readonly unitPrice: string | null;
}

/** A captured line as the backend's own effective read takes it. */
function toEngineAmount(item: CapturedItem): EngineAmount {
  return {
    componentCode: item.pricingComponentCode,
    amount: new Prisma.Decimal(item.amount),
    customPropertyId: item.customPropertyId,
    description: item.description,
    unitPrice: item.unitPrice === null ? null : new Prisma.Decimal(item.unitPrice),
  };
}

/** Rewritten in the file's own indentation, line endings and final newline. */
function reformatLike(original: string, value: unknown): string {
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^\{\r?\n( +)"/.exec(original)?.[1].length ?? 1;
  const body = JSON.stringify(value, null, indent).replace(/\n/g, lineEnding);

  return /\r?\n$/.test(original) ? body + lineEnding : body;
}
