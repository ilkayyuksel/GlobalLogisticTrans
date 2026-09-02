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

    it("does not match a different container on the same booking and date", async () => {
      const { service } = matcherOver([
        buildTrip({ containerNumber: "PVDU9999999" }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
    });

    it("does not match the same container on a different date", async () => {
      const { service } = matcherOver([
        buildTrip({
          containerNumber: CONTAINER,
          originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
        }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
    });

    /** It never widens to booking+date when the container finds nothing. */
    it("does not fall back to the container-less rule", async () => {
      const { service } = matcherOver([
        buildTrip({ containerNumber: null, sourceFixture: ORDER_WITHOUT_CONTAINER }),
      ]);

      expect(
        await service.findTripForCostConfirmation(
          confirmation({ containerReference: CONTAINER }),
        ),
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
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

    it("does not match a Trip whose original order printed one", async () => {
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
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
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

    /** And the mirror image: the order HAD one, the Trip's is now empty. */
    it("does not match although the Trip's container is now empty", async () => {
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
      ).toEqual({ kind: "NO_MATCHING_TRIP" });
    });

    it("still requires the date", async () => {
      const { service } = matcherOver([
        buildTrip({
          originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
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
        originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
      }),
    ]);

    expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
      kind: "NO_MATCHING_TRIP",
    });
  });

  it("still requires the container when the confirmation names one", async () => {
    const { service } = matcherOver([
      buildTrip({ ...digitsOnly, containerNumber: "PVDU9999999" }),
    ]);

    expect(
      await service.findTripForCostConfirmation(
        confirmation({ containerReference: CONTAINER }),
      ),
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
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

  it("still requires the original order to have had no container", async () => {
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
    ).toEqual({ kind: "NO_MATCHING_TRIP" });
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
  it("refuses a Trip with no source document", async () => {
    const { service } = matcherOver([
      buildTrip({ pdfDocumentId: null, sourceFixture: undefined }),
    ]);

    expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
      kind: "NO_MATCHING_TRIP",
    });
  });

  it("refuses a Trip whose stored file is gone", async () => {
    const { service } = matcherOver([buildTrip({ sourceFixture: undefined })]);

    expect(await service.findTripForCostConfirmation(confirmation())).toEqual({
      kind: "NO_MATCHING_TRIP",
    });
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
