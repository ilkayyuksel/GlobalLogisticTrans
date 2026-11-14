import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TripDirection, TripStatus } from "@prisma/client";
import { parseCostConfirmation, type ParsedCostConfirmation } from "@tms/parser";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * CC 4261545 (STOP, €70.00) and CC 4261544 (WAIT, €68.75) for booking
 * ANRDUB2821379, a COLLECTION: both print a loading window of 27/10/2026. Only
 * the STOP's Remarks name `dd 26/10` — the day the transport ran and Trano holds
 * it on; the WAIT's read "calculation after 0.5 hrs" and name no day, so it is
 * found on a nearby day (`matchOnNearbyDays`).
 *
 * Their PARSED content is given here exactly as the parser reads the real
 * documents in `docs/06-pdf/Cost-Combination` (`remarksDate` is the parser's own
 * reading of `dd 26/10`, proven in the parser's `remarks-date.spec.ts`), so each
 * case can vary one field. Everything after — matching, recording, the stored
 * confirmation — is the real importer through the real harness.
 */

jest.mock("@tms/parser", () => ({
  ...jest.requireActual("@tms/parser"),
  parseCostConfirmation: jest.fn(),
}));

const parseMock = parseCostConfirmation as jest.MockedFunction<typeof parseCostConfirmation>;

const BOOKING = "ANRDUB2821379";
const LOADING_DATE = "2026-10-27";
const COST_DAY = "2026-10-26";

function confirmation(overrides: Partial<ParsedCostConfirmation> = {}): ParsedCostConfirmation {
  return {
    ccNumber: "4261545",
    bookingNumber: BOOKING,
    amount: "70.00",
    currency: "EUR",
    costCode: "STOP",
    costDescription: "Extra stop",
    containerReference: null,
    transportDate: LOADING_DATE,
    remarksDate: COST_DAY,
    remarks: "dd 26/10",
    raw: "COST CONFIRMATION NR 4261545",
    ...overrides,
  };
}

const STOP = confirmation();
const WAIT = confirmation({
  ccNumber: "4261544",
  amount: "68.75",
  costCode: "WAIT",
  costDescription: "Waiting Time",
  remarks: "calculation after 0.5 hrs",
  remarksDate: null,
});

describe("a confirmation whose Remarks name the day of the cost (dd 26/10)", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-cc-remarks-date-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  function aTrip(
    id: string,
    isoDate: string,
    containerNumber: string | null = null,
    direction: TripDirection | null = null,
  ) {
    const trip = {
      id,
      bookingNumber: BOOKING,
      status: TripStatus.CLOSED,
      direction,
      containerNumber,
      planningDate: new Date(`${isoDate}T00:00:00.000Z`),
      originalPlanningDate: new Date(`${isoDate}T00:00:00.000Z`),
      waitingTimeMinutes: null,
      pdfDocumentId: null,
      tripGroupId: null,
    };

    harness.trips.push(trip);

    return trip;
  }

  /** One import of `parsed`, as the IMAP import or an upload makes it. */
  async function importIt(parsed: ParsedCostConfirmation, file = `COST_CONFIRMATION_NR_${parsed.ccNumber}__${BOOKING}__XXXXXXXXXXXX.pdf`) {
    parseMock.mockResolvedValueOnce({ ok: true, parserVersion: "1.5.0", confirmation: parsed, metadata: {} as never });

    return harness.importer.confirmCost(new Uint8Array([0x25, 0x50, 0x44, 0x46, Number(parsed.ccNumber) % 256]), file);
  }

  it("1-2. finds the collection on 26/10 for the STOP and the WAIT confirmation, and records each apart", async () => {
    const trip = aTrip("trip-26", COST_DAY, null, TripDirection.COLLECTION);

    await importIt(STOP);
    await importIt(WAIT);

    expect(
      harness.costConfirmations.map((row) => [row.tripId, row.ccNumber, row.costCode, String(row.amount)]),
    ).toEqual([
      [trip.id, "4261545", "STOP", "70.00"],
      [trip.id, "4261544", "WAIT", "68.75"],
    ]);
  });

  it("3. a Trip on the loading date itself is still found on that date first", async () => {
    aTrip("trip-26", COST_DAY);
    const onLoadingDate = aTrip("trip-27", LOADING_DATE);

    await importIt(STOP);

    expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: onLoadingDate.id })]);
  });

  it("3. a confirmation naming no day in its Remarks keeps the loading-date rule", async () => {
    aTrip("trip-26", COST_DAY);

    await expect(importIt(confirmation({ remarksDate: null, remarks: "calculation after 0.5 hrs" }))).rejects.toThrow(
      /No Trip matches booking number ANRDUB2821379 on 2026-10-27, the LOADING\/DELIVERY date the confirmation prints \(compared/,
    );
    expect(harness.costConfirmations).toEqual([]);
  });

  it("4. finds the Trip whose container an operator typed in later, and leaves it", async () => {
    const trip = aTrip("trip-26", COST_DAY, "PVDU 1234567");

    await importIt(STOP);

    expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: trip.id })]);
    expect(trip.containerNumber).toBe("PVDU 1234567");
  });

  it("5. two Trips on the booking and that day: refused as ambiguous, on the day it compared", async () => {
    aTrip("trip-26-a", COST_DAY);
    aTrip("trip-26-b", COST_DAY, "PVDU 1234567");

    await expect(importIt(STOP)).rejects.toThrow(/matches 2 Trips on 2026-10-26/);
    expect(harness.costConfirmations).toEqual([]);
  });

  it("6. no day the Remarks name reliably: no match on a guess, both days said", async () => {
    aTrip("trip-25", "2026-10-25");

    await expect(importIt(STOP)).rejects.toThrow(
      'No Trip matches booking number ANRDUB2821379 on 2026-10-27, the LOADING/DELIVERY date the confirmation prints, nor on 2026-10-26, the "dd" day its Remarks name, (compared with each Trip\'s planning date and originally ordered date; a container is not required), and no collection does within 3 days of it. Trips with this booking number are on 2026-10-25.',
    );
    expect(harness.costConfirmations).toEqual([]);
  });

  it("7. records a confirmation once when it arrives again", async () => {
    aTrip("trip-26", COST_DAY);

    await importIt(STOP);
    await importIt(STOP, "the same document, another name.pdf");

    expect(harness.costConfirmations).toHaveLength(1);
  });

  /**
   * ── A COLLECTION ON A NEARBY DAY (owner, November 2026) ───────────────────
   * Neither the loading date (27/10) nor a Remarks day finds a Trip: a
   * COLLECTION is looked for ±1, ±2, ±3 days away, closest first, by booking
   * and its original or planned date — never by its container. The WAIT names
   * no Remarks day, so it is the confirmation these cases send.
   */
  describe("a collection on a nearby day", () => {
    const collection = (id: string, isoDate: string, containerNumber: string | null = null) =>
      aTrip(id, isoDate, containerNumber, TripDirection.COLLECTION);

    it("1/4/7. finds the collection one day before, without a container", async () => {
      const trip = collection("trip-26", COST_DAY);

      await importIt(WAIT);

      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: trip.id, ccNumber: "4261544" })]);
    });

    it("2. finds it when an operator typed its container in later, and leaves it", async () => {
      const trip = collection("trip-26", COST_DAY, "PVDU 1234567");

      await importIt(WAIT);

      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: trip.id })]);
      expect(trip.containerNumber).toBe("PVDU 1234567");
    });

    it("3. finds it by its ORIGINAL date when its planning date was moved, and moves neither", async () => {
      const trip = collection("trip-26", COST_DAY);
      trip.planningDate = new Date("2026-11-03T00:00:00.000Z");

      await importIt(WAIT);

      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: trip.id })]);
      expect(trip.originalPlanningDate).toEqual(new Date(`${COST_DAY}T00:00:00.000Z`));
      expect(trip.planningDate).toEqual(new Date("2026-11-03T00:00:00.000Z"));
    });

    it("finds the CLOSEST collection: one day before wins over three days after", async () => {
      const near = collection("trip-26", COST_DAY);
      collection("trip-30", "2026-10-30");

      await importIt(WAIT);

      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: near.id })]);
    });

    it("reaches three days, and no further", async () => {
      const three = collection("trip-24", "2026-10-24");

      await importIt(WAIT);
      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: three.id })]);
    });

    it("refuses a collection four days away", async () => {
      collection("trip-23", "2026-10-23");

      await expect(importIt(WAIT)).rejects.toThrow(/no collection does within 3 days of it/);
      expect(harness.costConfirmations).toEqual([]);
    });

    it("5. refuses a collection the day before AND one the day after, choosing neither", async () => {
      collection("trip-26", COST_DAY);
      collection("trip-28", "2026-10-28");

      await expect(importIt(WAIT)).rejects.toThrow(/matches 2 Trips on 2026-10-26 \/ 2026-10-28/);
      expect(harness.costConfirmations).toEqual([]);
    });

    it("5. refuses two collections on the same nearby day", async () => {
      collection("trip-26-a", COST_DAY);
      collection("trip-26-b", COST_DAY, "PVDU 1234567");

      await expect(importIt(WAIT)).rejects.toThrow(/matches 2 Trips/);
      expect(harness.costConfirmations).toEqual([]);
    });

    it("6. never reaches a Trip that is not a collection", async () => {
      aTrip("trip-26", COST_DAY, null, TripDirection.DELIVERY);

      await expect(importIt(WAIT)).rejects.toThrow(/no collection does within 3 days of it/);
      expect(harness.costConfirmations).toEqual([]);
    });

    it("never looks at a nearby day when the loading date itself finds the Trip", async () => {
      collection("trip-26", COST_DAY);
      const onLoadingDate = aTrip("trip-27", LOADING_DATE);

      await importIt(WAIT);

      expect(harness.costConfirmations).toEqual([expect.objectContaining({ tripId: onLoadingDate.id })]);
    });
  });
});
