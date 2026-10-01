import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripService } from "../trips/trip.service";
import { CostConfirmationMatchingService } from "./cost-confirmation-matching.service";

/**
 * Which Trip a Cost Confirmation belongs to.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Phase 1 matches the booking number EXACTLY, on the ordered transport date the
 * confirmation itself prints, with the container rule below. Only when that
 * finds NOTHING does Phase 2 repeat it with the booking numbers reduced to
 * their digits.
 *
 *   confirmation names a container  → only the Trip holding that container
 *   confirmation names none usable  → only a Trip whose ORIGINAL order printed
 *                                     none either
 *
 * ── THE PART THAT IS EASY TO GET WRONG ──────────────────────────────────────
 * "Originally had no container" is read from the DOCUMENT the Trip was created
 * from, never from the Trip's current container number. A Loading is ordered
 * before anyone knows the container, so the order prints none and an operator
 * types one in later — and that edit must not change which confirmations can
 * reach the Trip. The tests below drive both directions of that mismatch with
 * real transport orders.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

/** A real order that prints NO container: ANRDUB2602247 on 2025-05-22. */
const ORDER_WITHOUT_CONTAINER = "NEW/1page.pdf";
/** A real order that DOES print one: DUBANR2598395 / PVDU3013260, 2025-05-22. */
const ORDER_WITH_CONTAINER = "NEW/combination.pdf";

const BOOKING = "ANRDUB2796277";
const DATE = "2026-08-28";
const CONTAINER = "EUCU4582658";

function documentContent(fixture: string) {
  return {
    content: new Uint8Array(readFileSync(join(FIXTURES, fixture))),
    originalFilename: fixture,
    mimeType: "application/pdf",
  };
}

/**
 * A Trip as the matcher sees it.
 *
 * `sourceFixture` is the real PDF the Trip was created from, and it is the ONLY
 * thing that decides its original container — deliberately independent of
 * `containerNumber`, so a test can make the two disagree.
 */
function buildTrip(
  overrides: Partial<Trip> & { sourceFixture?: string } = {},
): Trip & { sourceFixture?: string } {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    containerNumber: null,
    originalPlanningDate: new Date(`${DATE}T00:00:00.000Z`),
    planningDate: new Date(`${DATE}T00:00:00.000Z`),
    pdfDocumentId: "pdf-1",
    sourceFixture: ORDER_WITHOUT_CONTAINER,
    ...overrides,
  } as unknown as Trip & { sourceFixture?: string };
}

function matcherOver(stored: readonly (Trip & { sourceFixture?: string })[]) {
  const eligible = stored.filter((trip) => trip.status !== TripStatus.DELETED);

  const trips = {
    findByExactBookingNumber: jest.fn((bookingNumber: string) =>
      Promise.resolve(
        eligible.filter((trip) => trip.bookingNumber === bookingNumber),
      ),
    ),
    findByBookingDigits: jest.fn((digits: string) =>
      Promise.resolve(
        eligible.filter(
          (trip) => (trip.bookingNumber ?? "").replace(/\D/g, "") === digits,
        ),
      ),
    ),
  };

  const pdfDocuments = {
    readContent: jest.fn((pdfDocumentId: string) => {
      const owner = stored.find((trip) => trip.pdfDocumentId === pdfDocumentId);

      if (!owner?.sourceFixture) {
        return Promise.reject(new Error("no such document"));
      }

      return Promise.resolve(documentContent(owner.sourceFixture));
    }),
  };

  const service = new CostConfirmationMatchingService(
    trips as unknown as TripService,
    pdfDocuments as unknown as PdfDocumentService,
    {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService,
  );

  return { service, trips, pdfDocuments };
}

/** What a confirmation states. The date and booking default to the happy case. */
function confirmation(
  overrides: Partial<{
    bookingNumber: string;
    transportDate: string | null;
    containerReference: string | null;
  }> = {},
) {
  return {
    bookingNumber: BOOKING,
    transportDate: DATE,
    containerReference: null,
    ...overrides,
  };
}

describe("Phase 1 — the exact booking number", () => {
  describe("when the confirmation names a container", () => {
    it("matches booking, date and container together", async () => {
      const { service } = matcherOver([
        buildTrip({ containerNumber: CONTAINER }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toMatchObject({ kind: "MATCHED", trip: { id: "trip-1" } });
    });

    /**
     * Phase 1 declines — the containers differ — and the LAST phase catches it
     * on the booking and the date. Which Trip the strict phase would have
     * chosen among several is proved separately below.
     */
    it("declines a different container, leaving it to the last phase", async () => {
      const { service } = matcherOver([
        buildTrip({ containerNumber: "PVDU9999999" }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toMatchObject({ kind: "MATCHED", trip: { id: "trip-1" } });
    });

    it("does not match the same container on a different date", async () => {
      const { service } = matcherOver([
        buildTrip({
          containerNumber: CONTAINER,
        /*
         * BOTH dates, which is what a Trip on another day actually looks like:
         * an import writes the document's date into each column. Stating only
         * the immutable one would leave the Trip still planned on the confirmed
         * date, which is the re-planned case a confirmation SHOULD reach.
         */
          originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
          planningDate: new Date("2026-08-21T00:00:00.000Z"),
        }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
    });

    /**
     * A confirmation naming a container never uses the provenance rule: that is
     * the container-less reading. It reaches this Trip through the last phase
     * instead, so the original source is never read.
     */
    it("never consults provenance when it names a container", async () => {
      const { service, pdfDocuments } = matcherOver([
        buildTrip({ containerNumber: null, sourceFixture: ORDER_WITHOUT_CONTAINER }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toMatchObject({ kind: "MATCHED" });
      expect(pdfDocuments.readContent).not.toHaveBeenCalled();
    });

    /** Only the exact container is eligible among several on one booking. */
    it("picks only the Trip holding that container", async () => {
      const { service } = matcherOver([
        buildTrip({ id: "a", containerNumber: "PVDU1111111" }),
        buildTrip({ id: "b", containerNumber: CONTAINER }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toMatchObject({ kind: "MATCHED", trip: { id: "b" } });
    });
  });

  describe("when the confirmation names no container", () => {
    it("matches a Trip whose original order printed none", async () => {
      const { service } = matcherOver([
        buildTrip({ sourceFixture: ORDER_WITHOUT_CONTAINER }),
      ]);

      expect(await service.findTripForCostConfirmation(confirmation())).toMatchObject(
        { kind: "MATCHED", trip: { id: "trip-1" } },
      );
    });

    /**
     * The provenance rule excludes this Trip from Phase 1 — its original order
     * DID print a container — and the last phase, which ignores provenance
     * entirely, then matches it. Phase 1's discrimination is proved by the pair
     * test further down, where it decides WHICH of two Trips is eligible.
     */
    it("is excluded from Phase 1, then caught by the last phase", async () => {
      const { service } = matcherOver([
        buildTrip({
          bookingNumber: "DUBANR2598395",
          originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
          sourceFixture: ORDER_WITH_CONTAINER,
        }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({
            bookingNumber: "DUBANR2598395",
            transportDate: "2025-05-22",
          }),
        ),
      ).toMatchObject({ kind: "MATCHED" });
    });

    /**
     * ── THE CASE THE PROVENANCE RULE EXISTS FOR ─────────────────────────────
     * The order printed no container; an operator typed one in afterwards. The
     * Trip's CURRENT container must not make it ineligible.
     */
    it("matches although the operator has since entered a container", async () => {
      const { service } = matcherOver([
        buildTrip({
          containerNumber: "CNEU1234567",
          sourceFixture: ORDER_WITHOUT_CONTAINER,
        }),
      ]);

      expect(await service.findTripForCostConfirmation(confirmation())).toMatchObject(
        { kind: "MATCHED" },
      );
    });

    /** The mirror image: the order HAD one, the Trip's is now empty. */
    it("is likewise caught only by the last phase", async () => {
      const { service } = matcherOver([
        buildTrip({
          bookingNumber: "DUBANR2598395",
          containerNumber: null,
          originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
          sourceFixture: ORDER_WITH_CONTAINER,
        }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({
            bookingNumber: "DUBANR2598395",
            transportDate: "2025-05-22",
          }),
        ),
      ).toMatchObject({ kind: "MATCHED" });
    });

    it("still requires the date", async () => {
      const { service } = matcherOver([
        buildTrip({
          // Both columns: see the note in Phase 1's container case above.
          originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
          planningDate: new Date("2026-08-21T00:00:00.000Z"),
        }),
      ]);

      expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
        kind: "NO_MATCHING_TRIP",
      });
    });

    /**
     * Two Trips on one booking and one date, one originally with a container
     * and one without. Only the container-less one is eligible, so there is
     * nothing ambiguous about it.
     */
    it("eliminates the originally-containered Trip from the pair", async () => {
      const { service } = matcherOver([
        buildTrip({
          id: "had-one",
          pdfDocumentId: "pdf-with",
          containerNumber: null,
          sourceFixture: ORDER_WITH_CONTAINER,
          bookingNumber: "DUBANR2598395",
          originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
        }),
        buildTrip({
          id: "had-none",
          pdfDocumentId: "pdf-without",
          containerNumber: "CNEU1234567",
          sourceFixture: ORDER_WITHOUT_CONTAINER,
          bookingNumber: "DUBANR2598395",
          originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
        }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({
            bookingNumber: "DUBANR2598395",
            transportDate: "2025-05-22",
          }),
        ),
      ).toMatchObject({ kind: "MATCHED", trip: { id: "had-none" } });
    });
  });

  /**
   * The count is the answer, and nothing is ever chosen from several. An
   * ambiguity is reported so a person can settle it.
   */
  describe("ambiguity", () => {
    it("refuses when two eligible Trips remain", async () => {
      const { service } = matcherOver([
        buildTrip({ id: "a", pdfDocumentId: "pdf-a" }),
        buildTrip({ id: "b", pdfDocumentId: "pdf-b" }),
      ]);

      const match = await service.findTripForCostConfirmation(confirmation());

      expect(match.kind).toBe("AMBIGUOUS");
    });

    /** The fallback is not an ambiguity resolver, and must not be reached. */
    it("does not try the digit fallback to break a tie", async () => {
      const { service, trips } = matcherOver([
        buildTrip({ id: "a", pdfDocumentId: "pdf-a" }),
        buildTrip({ id: "b", pdfDocumentId: "pdf-b" }),
      ]);

      await service.findTripForCostConfirmation(confirmation());

      expect(trips.findByBookingDigits).not.toHaveBeenCalled();
    });
  });

  /** A DELETED Trip holds no booking number and answers for nothing. */
  it("ignores a DELETED Trip", async () => {
    const { service } = matcherOver([
      buildTrip({ status: TripStatus.DELETED }),
    ]);

    expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
      kind: "NO_MATCHING_TRIP",
    });
  });
});

/**
 * ── PHASE 2 ─────────────────────────────────────────────────────────────────
 * The confirmation is produced by another system, which prints the booking
 * number in its own way. Reached ONLY when the exact booking found nothing
 * eligible, and it relaxes the booking comparison and nothing else.
 */
describe("Phase 2 — the digit-normalized booking number", () => {
  /** The Trip's booking is the digits alone; the confirmation prints it in full. */
  const digitsOnly = { bookingNumber: "2796277" };

  it("matches when only the spelling of the booking differs", async () => {
    const { service } = matcherOver([buildTrip(digitsOnly)]);

    expect(await service.findTripForCostConfirmation(confirmation())).toMatchObject(
      { kind: "MATCHED", trip: { id: "trip-1" } },
    );
  });

  it("runs only after the exact lookup found nothing", async () => {
    const { service, trips } = matcherOver([buildTrip(digitsOnly)]);

    await service.findTripForCostConfirmation(confirmation());

    expect(trips.findByExactBookingNumber).toHaveBeenCalled();
    expect(trips.findByBookingDigits).toHaveBeenCalledWith("2796277");
  });

  it("still requires the date", async () => {
    const { service } = matcherOver([
      buildTrip({
        ...digitsOnly,
        // Both columns: a Trip on another day states that day in each.
        originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
        planningDate: new Date("2026-08-21T00:00:00.000Z"),
      }),
    ]);

    expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
      kind: "NO_MATCHING_TRIP",
    });
  });

  /**
   * The strict digit phase declines on the container; the last phase, which
   * also compares the booking by digits, then matches on the date alone.
   */
  it("declines on the container, leaving it to the last phase", async () => {
    const { service } = matcherOver([
      buildTrip({ ...digitsOnly, containerNumber: "PVDU9999999" }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toMatchObject({ kind: "MATCHED", trip: { id: "trip-1" } });
  });

  it("matches on booking digits, date and container together", async () => {
    const { service } = matcherOver([
      buildTrip({ ...digitsOnly, containerNumber: CONTAINER }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });

  /** Provenance excludes it from the strict phase; the last phase ignores it. */
  it("applies provenance in the strict phase, not in the last", async () => {
    const { service } = matcherOver([
      buildTrip({
        bookingNumber: "2598395",
        originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
        sourceFixture: ORDER_WITH_CONTAINER,
      }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({
          bookingNumber: "DUBANR2598395",
          transportDate: "2025-05-22",
        }),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });

  it("reports an ambiguity of its own", async () => {
    const { service } = matcherOver([
      buildTrip({ id: "a", ...digitsOnly, pdfDocumentId: "pdf-a" }),
      buildTrip({ id: "b", bookingNumber: "2796277", pdfDocumentId: "pdf-b" }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmation())).kind,
    ).toBe("AMBIGUOUS");
  });

  /** Nothing numeric to compare, so there is no fallback to run. */
  it("does not run for a booking with no digits", async () => {
    const { service, trips } = matcherOver([buildTrip({ bookingNumber: "ANR" })]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ bookingNumber: "ANRDUB" }),
      ),
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
    expect(trips.findByBookingDigits).not.toHaveBeenCalled();
  });
});

/**
 * ── WHEN THE ORIGINAL SOURCE CANNOT BE READ ─────────────────────────────────
 * The answer is refused, never guessed. A confirmation must not attach money to
 * a Trip because its provenance happened to be unavailable.
 */
describe("a Trip whose original source cannot be established", () => {
  /**
   * Unreadable provenance excludes a Trip from the STRICT phases — it is never
   * assumed either way — and the last phase, which ignores provenance, may
   * still reach it. The distinction shows when another Trip is eligible: the
   * strict phase must prefer the one whose source it could actually read.
   */
  it("prefers the Trip whose provenance is known", async () => {
    const { service } = matcherOver([
      buildTrip({
        id: "unknowable",
        pdfDocumentId: null,
        sourceFixture: undefined,
      }),
      buildTrip({
        id: "known-containerless",
        pdfDocumentId: "pdf-2",
        sourceFixture: ORDER_WITHOUT_CONTAINER,
      }),
    ]);

    expect(
      await service.findTripForCostConfirmation(confirmation()),
    ).toMatchObject({ kind: "MATCHED", trip: { id: "known-containerless" } });
  });

  it("never guesses that an unreadable source had no container", async () => {
    const { service } = matcherOver([
      buildTrip({
        id: "unknowable",
        pdfDocumentId: null,
        sourceFixture: undefined,
      }),
      buildTrip({
        id: "known-containerless",
        pdfDocumentId: "pdf-2",
        sourceFixture: ORDER_WITHOUT_CONTAINER,
      }),
    ]);

    // Had it guessed, both would be eligible and the answer would be ambiguous.
    expect(
      (await service.findTripForCostConfirmation(confirmation())).kind,
    ).toBe("MATCHED");
  });

  /** It is only consulted when the confirmation names NO container. */
  it("is not consulted when the confirmation names a container", async () => {
    const { service, pdfDocuments } = matcherOver([
      buildTrip({ containerNumber: CONTAINER, sourceFixture: undefined }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toMatchObject({ kind: "MATCHED" });
    expect(pdfDocuments.readContent).not.toHaveBeenCalled();
  });
});

/** Without a date nothing can be told apart, so nothing is matched. */
describe("a confirmation that states no transport date", () => {
  it("matches nothing", async () => {
    const { service } = matcherOver([buildTrip()]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ transportDate: null }),
      ),
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
  });

  it("asks the repository for nothing at all", async () => {
    const { service, trips } = matcherOver([buildTrip()]);

    await service.findTripForCostConfirmation(
      confirmation({ transportDate: null }),
    );

    expect(trips.findByExactBookingNumber).not.toHaveBeenCalled();
    expect(trips.findByBookingDigits).not.toHaveBeenCalled();
  });
});

/**
 * ── PHASE 3, THE LAST ───────────────────────────────────────────────────────
 * The booking and the date, with the container rule dropped entirely — both the
 * container the confirmation names and the provenance test that stands in for
 * it.
 *
 * It exists because a container printed on a confirmation does not reliably
 * identify a Trip: an order placed without one is given a container by hand,
 * and the confirmation that follows may carry exactly that value. It is LAST,
 * so it can only ever be reached once both stricter readings found nothing.
 */
describe("Phase 3 — booking and date, container ignored", () => {
  /** The strict phases cannot match: the containers disagree. */
  it("matches when the confirmation's container is not the Trip's", async () => {
    const { service } = matcherOver([
      buildTrip({ containerNumber: "PVDU9999999" }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toMatchObject({ kind: "MATCHED", trip: { id: "trip-1" } });
  });

  /**
   * The provenance rule refuses this Trip — its original order DID print a
   * container — and Phase 3 matches it anyway, which is the whole point.
   */
  it("ignores original-container provenance", async () => {
    const { service } = matcherOver([
      buildTrip({
        bookingNumber: "DUBANR2598395",
        containerNumber: null,
        originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
        sourceFixture: ORDER_WITH_CONTAINER,
      }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({
          bookingNumber: "DUBANR2598395",
          transportDate: "2025-05-22",
        }),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });

  /** Even a Trip whose source cannot be read at all is reachable here. */
  it("matches although the original source cannot be established", async () => {
    const { service } = matcherOver([
      buildTrip({ pdfDocumentId: null, sourceFixture: undefined }),
    ]);

    expect(
      await service.findTripForCostConfirmation(confirmation()),
    ).toMatchObject({ kind: "MATCHED" });
  });

  /** The date is NOT dropped with the container. */
  it("still requires the ordered date", async () => {
    const { service } = matcherOver([
      buildTrip({
        containerNumber: "PVDU9999999",
        // Both columns: a Trip on another day states that day in each.
        originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
        planningDate: new Date("2026-08-21T00:00:00.000Z"),
      }),
    ]);

    expect(await service.findTripForCostConfirmation(
      confirmation({ containerReference: CONTAINER }),
    )).toEqual({ kind: "NO_MATCHING_TRIP" });
  });

  /** The two-phase booking strategy survives: exact first, then digits. */
  it("reaches a digit-spelled booking too", async () => {
    const { service } = matcherOver([
      buildTrip({ bookingNumber: "2796277", containerNumber: "PVDU9999999" }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });

  it("reports an ambiguity of its own", async () => {
    const { service } = matcherOver([
      buildTrip({ id: "a", containerNumber: "PVDU1111111", pdfDocumentId: "pdf-a" }),
      buildTrip({ id: "b", containerNumber: "PVDU2222222", pdfDocumentId: "pdf-b" }),
    ]);

    expect(
      (
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        )
      ).kind,
    ).toBe("AMBIGUOUS");
  });

  it("reports no match when nothing is held on that date", async () => {
    const { service } = matcherOver([]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
  });

  /** A DELETED Trip is out of reach in every phase, this one included. */
  it("does not reach a DELETED Trip", async () => {
    const { service } = matcherOver([
      buildTrip({
        containerNumber: "PVDU9999999",
        status: TripStatus.DELETED,
      }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
  });
});

/**
 * ── A PHASE THAT ANSWERS STOPS THE SEARCH ───────────────────────────────────
 * The looser phases exist for the case where the stricter ones found NOTHING.
 * A hit, or an ambiguity, ends it.
 */
describe("the phases run in order and stop", () => {
  it("does not reach Phase 3 when Phase 1 matched", async () => {
    const { service, pdfDocuments } = matcherOver([
      buildTrip({ containerNumber: CONTAINER }),
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmation({ containerReference: CONTAINER }),
    );

    expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "trip-1" } });
    // Phase 1 matched on the container, so provenance was never consulted.
    expect(pdfDocuments.readContent).not.toHaveBeenCalled();
  });

  /**
   * Two Trips share the container the confirmation names. That is an ambiguity,
   * and Phase 3 must NOT be used to narrow it — it would only find the same two.
   */
  it("does not fall through from an ambiguous strict phase", async () => {
    const { service } = matcherOver([
      buildTrip({ id: "a", containerNumber: CONTAINER, pdfDocumentId: "pdf-a" }),
      buildTrip({ id: "b", containerNumber: CONTAINER, pdfDocumentId: "pdf-b" }),
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmation({ containerReference: CONTAINER }),
    );

    expect(match.kind).toBe("AMBIGUOUS");
  });

  /** And an ambiguous container-less Phase 1 is equally final. */
  it("does not fall through from an ambiguous provenance phase", async () => {
    const { service } = matcherOver([
      buildTrip({ id: "a", pdfDocumentId: "pdf-a" }),
      buildTrip({ id: "b", pdfDocumentId: "pdf-b" }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmation())).kind,
    ).toBe("AMBIGUOUS");
  });
});

/**
 * ── A RE-PLANNED TRANSPORT STILL OWNS ITS CONFIRMATION ──────────────────────
 * `original_planning_date` is written once, when the Trip is created, and is
 * immutable from then on. `planning_date` is the date the transport is actually
 * on — an operator moves it, or a revised order does.
 *
 * A Cost Confirmation prints the LOADING/DELIVERY date/time of the work it is
 * paying for, so for a re-planned transport it names the CURRENT date. Matching
 * the immutable column alone refused money for a Trip that plainly owned it, and
 * left a Trip created by hand unable to receive a confirmation at all.
 *
 * The case these were written from: Cost Confirmation 4208847, booking
 * ANRBEL2808541, container EUCU4591789, 2026-09-28 — a waiting-time charge,
 * which by its nature is issued after the transport ran.
 */
describe("the date a confirmation may name", () => {
  const CONFIRMED_BOOKING = "ANRBEL2808541";
  const CONFIRMED_CONTAINER = "EUCU4591789";
  const CONFIRMED_DATE = "2026-09-28";

  /** The one real Trip, with its two dates stated separately. */
  function closedTrip(dates: {
    originalPlanningDate: string | null;
    planningDate: string | null;
  }) {
    return buildTrip({
      id: "trip-4208847",
      status: TripStatus.CLOSED,
      bookingNumber: CONFIRMED_BOOKING,
      containerNumber: CONFIRMED_CONTAINER,
      originalPlanningDate:
        dates.originalPlanningDate === null
          ? null
          : new Date(`${dates.originalPlanningDate}T00:00:00.000Z`),
      planningDate:
        dates.planningDate === null
          ? null
          : new Date(`${dates.planningDate}T00:00:00.000Z`),
      // It names a container, so provenance is never consulted.
      sourceFixture: ORDER_WITH_CONTAINER,
    } as Partial<Trip> & { sourceFixture?: string });
  }

  function confirmationFor4208847() {
    return confirmation({
      bookingNumber: CONFIRMED_BOOKING,
      transportDate: CONFIRMED_DATE,
      containerReference: CONFIRMED_CONTAINER,
    });
  }

  /** The concrete case: the transport was moved onto the confirmed day. */
  it("matches a Trip whose CURRENT planning date the confirmation names", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: "2026-09-21",
        planningDate: CONFIRMED_DATE,
      }),
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmationFor4208847(),
    );

    expect(match).toEqual({
      kind: "MATCHED",
      trip: expect.objectContaining({ id: "trip-4208847" }),
    });
  });

  /** The ordinary case, which must keep working exactly as it did. */
  it("matches a Trip that was never re-planned", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: CONFIRMED_DATE,
        planningDate: CONFIRMED_DATE,
      }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmationFor4208847()))
        .kind,
    ).toBe("MATCHED");
  });

  /** The order was placed for the confirmed day and then moved away from it. */
  it("still matches on the date the transport was ORDERED for", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: CONFIRMED_DATE,
        planningDate: "2026-10-05",
      }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmationFor4208847()))
        .kind,
    ).toBe("MATCHED");
  });

  /** A Trip entered by hand has no original date, and must still be payable. */
  it("matches a Trip created by hand, which has no original date", async () => {
    const { service } = matcherOver([
      closedTrip({ originalPlanningDate: null, planningDate: CONFIRMED_DATE }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmationFor4208847()))
        .kind,
    ).toBe("MATCHED");
  });

  /**
   * ── THE DATE IS STILL NOT LOOSENED ────────────────────────────────────────
   * The day before and the day after are different transports, and the widened
   * comparison must not reach either. This test is what fails if the rule ever
   * becomes "near enough".
   */
  it.each(["2026-09-27", "2026-09-29"])(
    "refuses a Trip that states neither date (%s)",
    async (otherDate) => {
      const { service } = matcherOver([
        closedTrip({
          originalPlanningDate: otherDate,
          planningDate: otherDate,
        }),
      ]);

      expect(
        (await service.findTripForCostConfirmation(confirmationFor4208847()))
          .kind,
      ).toBe("NO_MATCHING_TRIP");
    },
  );

  /** A Trip stating neither date is refused however its dates disagree. */
  it("refuses a Trip re-planned away from the confirmed date entirely", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: "2026-09-21",
        planningDate: "2026-10-05",
      }),
    ]);

    expect(
      (await service.findTripForCostConfirmation(confirmationFor4208847()))
        .kind,
    ).toBe("NO_MATCHING_TRIP");
  });

  /**
   * Phase 1 still prefers the Trip holding the confirmed container.
   *
   * Both Trips are on the confirmed day and both are re-planned onto it, so the
   * widened date comparison brings both into the phase. The container is what
   * separates them, exactly as before.
   */
  it("still prefers the Trip holding the confirmed container", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: "2026-09-21",
        planningDate: CONFIRMED_DATE,
      }),
      {
        ...closedTrip({
          originalPlanningDate: "2026-09-21",
          planningDate: CONFIRMED_DATE,
        }),
        id: "other-box",
        containerNumber: "EUCU0000000",
        pdfDocumentId: "pdf-other-box",
      },
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmationFor4208847(),
    );

    expect(match).toEqual({
      kind: "MATCHED",
      trip: expect.objectContaining({ id: "trip-4208847" }),
    });
  });

  /**
   * ── PHASE 3 IS UNCHANGED, AND STILL LAST ──────────────────────────────────
   * A confirmation naming a container no Trip holds falls through to the phase
   * that drops the container rule, and is matched on booking and date alone.
   * That is the documented safety net, and widening WHICH date counts must not
   * alter it: the Trip is reached because it is the only one on the day, not
   * because of its container.
   */
  it("keeps reaching a re-planned Trip through the container-less phase", async () => {
    const { service } = matcherOver([
      {
        ...closedTrip({
          originalPlanningDate: "2026-09-21",
          planningDate: CONFIRMED_DATE,
        }),
        containerNumber: "EUCU0000000",
      },
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmationFor4208847(),
    );

    expect(match.kind).toBe("MATCHED");
  });

  /**
   * Two Trips on one booking, one answering by each date. Nothing is chosen —
   * the count rule is untouched by the widened comparison.
   */
  it("reports an ambiguity rather than preferring one date over the other", async () => {
    const { service } = matcherOver([
      closedTrip({
        originalPlanningDate: CONFIRMED_DATE,
        planningDate: "2026-10-05",
      }),
      {
        ...closedTrip({
          originalPlanningDate: "2026-09-21",
          planningDate: CONFIRMED_DATE,
        }),
        id: "trip-second",
        pdfDocumentId: "pdf-second",
      },
    ]);

    const match = await service.findTripForCostConfirmation(
      confirmationFor4208847(),
    );

    expect(match.kind).toBe("AMBIGUOUS");
  });
});
