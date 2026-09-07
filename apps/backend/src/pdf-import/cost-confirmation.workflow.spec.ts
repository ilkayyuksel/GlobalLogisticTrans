import { TripStatus } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * EVERY real Cost Confirmation, through the real workflow.
 *
 * ── WHAT A CONFIRMATION IS ALLOWED TO DO ────────────────────────────────────
 * Add an amount and its document to a Trip that already exists. That is all.
 * It creates no Trip, changes no status, moves no planning and touches no
 * waiting time — the minutes an operator entered and the money Eucon confirms
 * are different facts about the same delay, and neither may overwrite the
 * other.
 *
 * These documents carry a COMPLETE transport order inside them, so the mistake
 * this guards against is a real one: read as an order, each would create a
 * second Trip for a booking that already has one.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");
const CONFIRMATIONS = join(FIXTURES, "Cost-Combination");

interface ExpectedConfirmation {
  readonly file: string;
  readonly ccNumber: string;
  readonly bookingNumber: string;
  readonly amount: string;
  /** The ordered transport date the confirmation prints, ISO. */
  readonly transportDate: string;
  /** The container it names, or null when it names none usable. */
  readonly containerReference: string | null;
}

/** Pinned from the documents, not from their filenames. */
const EXPECTED: readonly ExpectedConfirmation[] = [
  {
    file: "COST_CONFIRMATION_NR_4132482__ANRDUB2789089__EUCU4530818.pdf",
    ccNumber: "4132482",
    bookingNumber: "ANRDUB2789089",
    amount: "25.00",
    transportDate: "2026-08-14",
    containerReference: "EUCU4530818",
  },
  {
    file: "COST_CONFIRMATION_NR_4133634__ANRDUB2791468__PVDU1139156.pdf",
    ccNumber: "4133634",
    bookingNumber: "ANRDUB2791468",
    amount: "41.25",
    transportDate: "2026-08-18",
    containerReference: "PVDU1139156",
  },
  {
    file: "COST_CONFIRMATION_NR_4139509__ANRDUB2792284__EUCU4583166.pdf",
    ccNumber: "4139509",
    bookingNumber: "ANRDUB2792284",
    amount: "55.00",
    transportDate: "2026-08-20",
    containerReference: "EUCU4583166",
  },
  {
    file: "COST_CONFIRMATION_NR_4139511__ANRDUB2790211__XXXXXXXXXXXX.pdf",
    ccNumber: "4139511",
    bookingNumber: "ANRDUB2790211",
    amount: "96.25",
    transportDate: "2026-08-20",
    containerReference: null,
  },
  {
    /* A clean container: matched strictly on it. */
    file: "CC-met-container.pdf",
    ccNumber: "4152218",
    bookingNumber: "ANRDUB2796277",
    amount: "41.25",
    transportDate: "2026-08-28",
    containerReference: "EUCU4582658",
  },
  {
    /* Prints `1????`, which names no container: the container-less rule. */
    file: "CC-zonder-container.pdf",
    ccNumber: "4152206",
    bookingNumber: "ANRDUB2796313",
    amount: "165.00",
    transportDate: "2026-08-28",
    containerReference: null,
  },
];

function readConfirmation(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(CONFIRMATIONS, file)));
}

describe("every real Cost Confirmation, through the real workflow", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-cost-confirmation-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /** A Trip the confirmation can name, carrying operator work to protect. */
  /**
   * A real transport order that prints NO container — the source a Trip needs
   * for a container-less confirmation to be able to reach it. Stored through
   * the real document service, so the matcher genuinely re-reads it.
   */
  const CONTAINERLESS_ORDER = join(FIXTURES, "NEW", "1page.pdf");

  /**
   * The Trip a confirmation names, carrying what matching now requires.
   *
   * The ORDERED date and the container come from the confirmation itself: a
   * Trip on another day, or holding another container, is no longer a
   * candidate. Its source document is a real order printing no container, so a
   * container-less confirmation is eligible to reach it — and a Trip's CURRENT
   * container is set independently, which is exactly the mismatch the
   * provenance rule exists to survive.
   */
  async function seedTrip(expected: ExpectedConfirmation) {
    /*
     * `store` writes the file and PREPARES the row; the importer is what
     * normally creates it. Both halves are done here so the matcher can read
     * the document back exactly as it does in production.
     */
    const prepared = await harness.pdfDocumentService.store(
      new Uint8Array(readFileSync(CONTAINERLESS_ORDER)),
      "source-order.pdf",
      "test",
    );

    const source = {
      document: {
        id: `pdf-source-${harness.pdfDocuments.length + 1}`,
        ...prepared.document,
      },
    };

    harness.pdfDocuments.push(source.document);

    const trip = {
      id: `trip-${harness.trips.length + 1}`,
      bookingNumber: expected.bookingNumber,
      status: TripStatus.OPEN,
      containerNumber: expected.containerReference ?? "EUCU 453081/8",
      containerType: "45PH",
      terminal: "PSA Quay 869",
      destinationCity: "Aalter",
      destinationCountry: "Belgium",
      planningDate: new Date(`${expected.transportDate}T00:00:00.000Z`),
      originalPlanningDate: new Date(`${expected.transportDate}T00:00:00.000Z`),
      vehicleId: "vehicle-1",
      driverId: null,
      waitingTimeStart: null,
      waitingTimeEnd: null,
      waitingTimeMinutes: 150,
      internalNotes: "Bel de klant",
      tripGroupId: null,
      pdfDocumentId: source.document.id,
    };

    harness.trips.push(trip);

    return trip;
  }

  /**
   * Points a seeded Trip at another confirmation's transport.
   *
   * Matching now needs all three — booking, ordered date and container — so a
   * test that wants a second confirmation to reach the SAME Trip has to move
   * all three rather than the booking number alone.
   */
  function retarget(
    trip: Record<string, unknown>,
    expected: ExpectedConfirmation,
  ): void {
    trip.bookingNumber = expected.bookingNumber;
    trip.originalPlanningDate = new Date(
      `${expected.transportDate}T00:00:00.000Z`,
    );
    trip.containerNumber = expected.containerReference ?? trip.containerNumber;
  }

  it("covers every document in the folder", () => {
    expect(EXPECTED.map((entry) => entry.file).sort()).toEqual(
      readdirSync(CONFIRMATIONS)
        .filter((name) => name.endsWith(".pdf"))
        .sort(),
    );
  });

  /**
   * ── WHY NO REAL DOCUMENT EXERCISES THE DIGIT FALLBACK ─────────────────────
   * The fallback exists because a confirmation can print a partial booking
   * reference — `DUB2793554` or `2793554` for `ANRDUB2793554`. Every real
   * confirmation we hold prints the booking IN FULL, so all four are served by
   * the exact lookup and none of them reaches the fallback.
   *
   * Asserted rather than assumed, so that the day a real partial arrives this
   * test fails and the fallback gains the real-document regression it currently
   * cannot have. Nothing here is fabricated to stand in for one.
   */
  it("shows that every real confirmation prints a full booking number", () => {
    expect(EXPECTED.length).toBeGreaterThan(0);

    for (const expected of EXPECTED) {
      // A full booking number carries its alphabetic prefix; a partial one
      // would be the digits alone or a shortened prefix.
      expect(expected.bookingNumber).toMatch(/^[A-Z]{6}\d+$/);
    }
  });

  describe.each(EXPECTED)("$file", (expected) => {
    it("records the confirmed amount against the Trip it names", async () => {
      const trip = await seedTrip(expected);

      const result = await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      expect(result.costConfirmations).toEqual([
        {
          ccNumber: expected.ccNumber,
          bookingNumber: expected.bookingNumber,
          tripId: trip.id,
          amount: expected.amount,
          currency: "EUR",
          outcome: "RECORDED",
        },
      ]);
    });

    it("creates no Trip", async () => {
      await seedTrip(expected);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      // One Trip: the one that was already there.
      expect(harness.trips).toHaveLength(1);
      expect(result_trips(harness)).toEqual([expected.bookingNumber]);
    });

    it("stores the document and links it to the confirmation", async () => {
      await seedTrip(expected);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      /*
       * Two documents: the Trip's own source order, seeded so its original
       * container can be established, and the confirmation itself. The
       * confirmation is the LATEST, and it is the one the record points at.
       */
      const confirmationDocument = harness.pdfDocuments.at(
        -1,
      ) as Record<string, unknown>;

      expect(confirmationDocument.originalFilename).toBe(expected.file);
      expect(harness.costConfirmations[0].pdfDocumentId).toBe(
        confirmationDocument.id,
      );
      expect(readdirSync(storageDirectory)).toHaveLength(2);
    });

    it("changes nothing about the Trip itself", async () => {
      const trip = await seedTrip(expected);
      const before = { ...trip };

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      // Not the status, not the planning, and above all not the waiting time.
      expect(trip).toEqual(before);
      expect(trip.waitingTimeMinutes).toBe(150);
    });

    it("appears in the Trip's document history", async () => {
      const trip = await seedTrip(expected);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      const { items } = await harness.documents.findForTrip(trip.id);

      /*
       * Two: the confirmation that just arrived, and the order the Trip was
       * created from. The confirmation is the most recent, and it is the one
       * this test is about.
       */
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        action: "COST_CONFIRMATION",
        originalFilename: expected.file,
        applied: true,
      });
      expect(items[0].outcome).toContain(`CC${expected.ccNumber}`);
    });

    it("keeps the document readable afterwards", async () => {
      await seedTrip(expected);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      // The confirmation is the latest document; the first is the Trip's own
      // source order, seeded so its original container can be established.
      const content = await harness.pdfDocumentService.readContent(
        harness.pdfDocuments.at(-1)?.id as string,
      );

      expect(content.originalFilename).toBe(expected.file);
      expect(content.content.byteLength).toBe(
        readConfirmation(expected.file).byteLength,
      );
    });
  });

  describe("the amounts", () => {
    it("are the amounts the documents state", async () => {
      const recorded: string[] = [];

      for (const expected of EXPECTED) {
        const trip = await seedTrip(expected);
        const result = await harness.importer.confirmCost(
          readConfirmation(expected.file),
          expected.file,
        );

        recorded.push(result.costConfirmations[0].amount);
        expect(result.costConfirmations[0].tripId).toBe(trip.id);
      }

      expect(recorded).toEqual(EXPECTED.map((entry) => entry.amount));
    });

    /** Money is a fixed-2 string from the page to the row. Never a float. */
    it("are stored as fixed-2 strings", async () => {
      await seedTrip(EXPECTED[1]);

      const result = await harness.importer.confirmCost(
        readConfirmation(EXPECTED[1].file),
        EXPECTED[1].file,
      );

      expect(result.costConfirmations[0].amount).toBe("41.25");
      expect(typeof result.costConfirmations[0].amount).toBe("string");
    });
  });

  describe("a booking nobody holds", () => {
    it("is refused, and writes nothing at all", async () => {
      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[0].file),
          EXPECTED[0].file,
        ),
      ).rejects.toThrow(/was not recorded/);

      expect(harness.trips).toEqual([]);
      expect(harness.costConfirmations).toEqual([]);
      // Nothing stored either: the message is retried, and a document per
      // attempt would pile up rows referencing nothing.
      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });
  });

  /**
   * ── WHY A CONFIRMATION CAN BE AMBIGUOUS ───────────────────────────────────
   * A Trip is identified by its booking number AND its container number, so one
   * booking may hold several Trips. A confirmation names only the booking: its
   * own container reference is printed in another format than a transport
   * order's — `EUCU4530818` against `EUCU4532322` — and one of the four real
   * confirmations prints none at all.
   *
   * It therefore REFUSES rather than choosing. The document carries money, and
   * putting it on the wrong leg of a booking is a silent invoicing error nobody
   * would find afterwards.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a booking held by more than one Trip", () => {
    const { file, bookingNumber } = EXPECTED[0];

    /**
     * Two Trips the confirmation cannot tell apart: same booking, same ordered
     * date, and both holding the container it names. The date and the container
     * have already narrowed as far as they can.
     */
    function twoIndistinguishableTrips(): void {
      const shared = {
        bookingNumber,
        containerNumber: EXPECTED[0].containerReference,
        originalPlanningDate: new Date(
          `${EXPECTED[0].transportDate}T00:00:00.000Z`,
        ),
        status: TripStatus.OPEN,
      };

      harness.trips.push(
        { id: "trip-container-1", ...shared },
        { id: "trip-container-2", ...shared },
      );
    }

    it("is refused rather than attached to one of them", async () => {
      twoIndistinguishableTrips();

      await expect(
        harness.importer.confirmCost(readConfirmation(file), file),
      ).rejects.toThrow(/was not recorded/);

      expect(harness.costConfirmations).toEqual([]);
    });

    it("says which booking is ambiguous and how many Trips hold it", async () => {
      twoIndistinguishableTrips();

      await expect(
        harness.importer.confirmCost(readConfirmation(file), file),
      ).rejects.toThrow(/2 Trips/);
    });

    it("stores nothing, because the message will be retried", async () => {
      twoIndistinguishableTrips();

      await expect(
        harness.importer.confirmCost(readConfirmation(file), file),
      ).rejects.toThrow();

      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });

    /** One eligible Trip is unambiguous, and still works. */
    it("records it normally when only one Trip matches", async () => {
      harness.trips.push({
        id: "trip-only",
        bookingNumber,
        containerNumber: EXPECTED[0].containerReference,
        originalPlanningDate: new Date(
          `${EXPECTED[0].transportDate}T00:00:00.000Z`,
        ),
        status: TripStatus.OPEN,
      });

      await harness.importer.confirmCost(readConfirmation(file), file);

      expect(harness.costConfirmations).toHaveLength(1);
    });
  });

  /**
   * ── A CONFIRMATION IS NOT MATCHED BY TRIP IDENTITY ────────────────────────
   * A Trip is identified by its booking number, its container AND its original
   * transport date. A Cost Confirmation is matched on the booking number ALONE,
   * and deliberately so: it prints its container reference in a different
   * format from a transport order — `EUCU4530818` against `EUCU 453232/2` — and
   * often prints no date of transport at all.
   *
   * Narrowing confirmations by date would therefore not make them more precise;
   * it would make them refuse money that belongs to a Trip we hold. These tests
   * exist because the two lookups sit beside each other in the repository, and
   * a date added to the wrong one would fail silently and only in production.
   */
  /**
   * ── THE DATE IS PART OF THE RULE ──────────────────────────────────────────
   * A confirmation prints the ordered transport date of the transport it is
   * paying for, and one booking can hold several Trips ordered for different
   * days. It is matched against the Trip's ORIGINAL planning date — never the
   * operational one, which an operator may have moved since.
   */
  describe("a booking whose Trips were ordered for different dates", () => {
    const { file, bookingNumber } = EXPECTED[0];

    function tripOrderedOn(id: string, isoDate: string) {
      return {
        id,
        bookingNumber,
        containerNumber: EXPECTED[0].containerReference,
        originalPlanningDate: new Date(`${isoDate}T00:00:00.000Z`),
        planningDate: new Date(`${isoDate}T00:00:00.000Z`),
        status: TripStatus.OPEN,
      };
    }

    it("reaches only the Trip ordered for the date it states", async () => {
      harness.trips.push(
        tripOrderedOn("trip-other-week", "2026-08-07"),
        tripOrderedOn("trip-this-one", EXPECTED[0].transportDate),
      );

      await harness.importer.confirmCost(readConfirmation(file), file);

      expect(harness.costConfirmations).toHaveLength(1);
      expect(harness.costConfirmations[0]).toMatchObject({
        tripId: "trip-this-one",
      });
    });

    it("finds nothing when only another date is held", async () => {
      harness.trips.push(tripOrderedOn("trip-other-week", "2027-03-01"));

      await expect(
        harness.importer.confirmCost(readConfirmation(file), file),
      ).rejects.toThrow(/was not recorded/);

      expect(harness.costConfirmations).toEqual([]);
    });

    /**
     * The operator's date is not consulted. A Trip re-planned to another day is
     * still the transport that was ORDERED for the confirmation's date.
     */
    it("ignores a planning date the operator has moved", async () => {
      harness.trips.push({
        ...tripOrderedOn("trip-replanned", EXPECTED[0].transportDate),
        planningDate: new Date("2026-09-30T00:00:00.000Z"),
      });

      await harness.importer.confirmCost(readConfirmation(file), file);

      expect(harness.costConfirmations).toHaveLength(1);
    });

    /** Matching starts from the booking number, exactly as it always has. */
    it("starts from the exact booking number", async () => {
      harness.trips.push(
        tripOrderedOn("trip-only", EXPECTED[0].transportDate),
      );

      await harness.importer.confirmCost(readConfirmation(file), file);

      expect(harness.tripRepository.findManyByBookingNumber).toHaveBeenCalled();
      // Trip identity is a different rule and is never consulted here.
      expect(harness.tripRepository.findByIdentity).not.toHaveBeenCalled();
      expect(
        harness.tripRepository.findManyByBookingNumberAndOriginalDate,
      ).not.toHaveBeenCalled();
    });
  });

  describe("the same confirmation twice", () => {
    const { file, ccNumber } = EXPECTED[0];

    it("records it once, under any filename", async () => {
      const trip = await seedTrip(EXPECTED[0]);

      await harness.importer.confirmCost(readConfirmation(file), file);
      const second = await harness.importer.confirmCost(
        readConfirmation(file),
        "a-different-name.pdf",
      );

      expect(second.costConfirmations[0].outcome).toBe("ALREADY_RECORDED");
      // One confirmed amount, whatever the document was called.
      expect(harness.costConfirmations).toHaveLength(1);
      expect(harness.costConfirmations[0].ccNumber).toBe(ccNumber);
      expect(trip.status).toBe(TripStatus.OPEN);
    });

    /** Content-addressed storage keeps one file for identical bytes. */
    it("writes one file for both arrivals", async () => {
      await seedTrip(EXPECTED[0]);

      await harness.importer.confirmCost(readConfirmation(file), file);
      await harness.importer.confirmCost(
        readConfirmation(file),
        "a-different-name.pdf",
      );

      /*
       * Two files: the Trip's seeded source order, and ONE copy of the
       * confirmation. Storage is content-addressed, so the same bytes under a
       * different name are written once — which is what this asserts.
       */
      expect(readdirSync(storageDirectory)).toHaveLength(2);
    });
  });

  /**
   * SEVERAL confirmations for one Trip, through the real workflow.
   *
   * A Trip used to hold exactly one confirmed cost and a second was refused.
   * That is withdrawn: Eucon confirms in instalments, every arrival is kept,
   * and the Trip is worth their sum.
   */
  describe("a second, DIFFERENT confirmation for one Trip", () => {
    /** Whatever `seedTrip` hands back — a Trip row as this harness builds one. */
    type SeededTrip = Awaited<ReturnType<typeof seedTrip>>;

    /** Imports EXPECTED[0], then re-aims the Trip and imports EXPECTED[index]. */
    async function alsoConfirm(
      trip: SeededTrip,
      index: number,
    ): Promise<void> {
      retarget(trip, EXPECTED[index]);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[index].file),
        EXPECTED[index].file,
      );
    }

    async function seedWithFirstConfirmation(): Promise<SeededTrip> {
      const trip = await seedTrip(EXPECTED[0]);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
      );

      return trip;
    }

    it("is recorded, and BOTH are kept", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);

      expect(harness.costConfirmations).toHaveLength(2);
      expect(
        harness.costConfirmations.map((row) => row.ccNumber).sort(),
      ).toEqual(["4132482", "4139509"]);
    });

    /** Neither amount is overwritten: each row holds what its document said. */
    it("keeps each confirmation's own amount", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);

      const amounts = harness.costConfirmations
        .map((row) => String(row.amount))
        .sort();

      // Each document's own figure, from the table above — never one of them
      // twice, and never a sum written into a row.
      expect(amounts).toEqual(
        [EXPECTED[0].amount, EXPECTED[2].amount].sort(),
      );
    });

    /** Each carries its OWN document; the first PDF is not replaced. */
    it("keeps both documents", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);

      const documentIds = new Set(
        harness.costConfirmations.map((row) => row.pdfDocumentId),
      );

      expect(documentIds.size).toBe(2);
      // The Trip's own source order, and one PDF per confirmation.
      expect(harness.pdfDocuments).toHaveLength(3);
    });

    it("changes nothing at all about the Trip", async () => {
      const trip = await seedWithFirstConfirmation();

      retarget(trip, EXPECTED[2]);
      const before = { ...trip };

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[2].file),
        EXPECTED[2].file,
      );

      expect(trip).toEqual(before);
      expect(trip.waitingTimeMinutes).toBe(150);
      expect(trip.status).toBe(TripStatus.OPEN);
    });

    /** Nothing is refused any more, so nothing records a refusal. */
    it("records no refusal", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);

      expect(
        harness.history.filter(
          (entry) => entry.eventType === "COST_CONFIRMATION_REFUSED",
        ),
      ).toEqual([]);
    });

    it("shows both confirmations in the history, both applied", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);

      const { items } = await harness.documents.findForTrip(trip.id);
      const confirmations = items.filter(
        (item) => item.action === "COST_CONFIRMATION",
      );

      expect(items).toHaveLength(3);
      expect(confirmations).toHaveLength(2);
      expect(confirmations.filter((item) => item.applied)).toHaveLength(2);
    });

    /** And the same document again still counts once. */
    it("counts a repeat of one of them only once", async () => {
      const trip = await seedWithFirstConfirmation();

      await alsoConfirm(trip, 2);
      await alsoConfirm(trip, 2);

      expect(harness.costConfirmations).toHaveLength(2);
    });
  });

  describe("what is refused", () => {
    it("refuses a transport order sent as a confirmation", async () => {
      await seedTrip({ ...EXPECTED[0], bookingNumber: "ANRDUB2602247" });

      await expect(
        harness.importer.confirmCost(
          new Uint8Array(readFileSync(join(FIXTURES, "NEW/1page.pdf"))),
          "1page.pdf",
        ),
      ).rejects.toThrow();

      expect(harness.costConfirmations).toEqual([]);
    });

    it("refuses a subject that contradicts its document", async () => {
      await seedTrip(EXPECTED[0]);

      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[0].file),
          EXPECTED[0].file,
          { subject: "COST CONFIRMATION NR 9999999 ANRDUB9999999" },
        ),
      ).rejects.toThrow(/subject names/);

      // Nothing of the CONFIRMATION was written; the seeded source order, which
      // existed before the attempt, is untouched.
      expect(harness.costConfirmations).toEqual([]);
      expect(
        harness.pdfDocuments.filter(
          (document) => document.originalFilename !== "source-order.pdf",
        ),
      ).toEqual([]);
    });

    it("accepts a subject that agrees with its document", async () => {
      await seedTrip(EXPECTED[0]);

      const result = await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
        {
          subject: `COST CONFIRMATION NR ${EXPECTED[0].ccNumber} ${EXPECTED[0].bookingNumber}`,
        },
      );

      expect(result.costConfirmations[0].outcome).toBe("RECORDED");
    });
  });
});

/** The booking numbers currently in the harness, for a short assertion. */
function result_trips(harness: RealDocumentHarness): string[] {
  return harness.trips.map((trip) => trip.bookingNumber as string);
}
