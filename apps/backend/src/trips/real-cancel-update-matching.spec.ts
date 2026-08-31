import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Trip, TripStatus } from "@prisma/client";
import { parse } from "@tms/parser";

import {
  resolveTripForDocument,
  type ContainerMissRule,
  type DocumentTripMatch,
} from "./document-trip-matching";
import type { TripRepository } from "./trip.repository";

/**
 * Every real CANCEL and UPDATE fixture, matched against a Trip that exists.
 *
 * ── WHY AGAINST REAL DOCUMENTS ──────────────────────────────────────────────
 * The rule changed because of what these files actually contain: SIX of the
 * eight real cancellations print no container at all, because a COLLECTION
 * order is written before anyone knows which container will be picked up.
 * Under strict booking+container matching every one of them found nothing and
 * disappeared without a trace.
 *
 * A hand-written fixture would have proved nothing here — the whole question is
 * what the documents really say, so these tests read them.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = join(process.cwd(), "..", "..", "docs", "06-pdf");

/**
 * The one rule that differs between the two document kinds.
 *
 * A cancellation whose printed container matches nothing falls back to the
 * booking and the date; a revision refuses so the caller creates the Trip. Each
 * call below states which kind it is exercising.
 */
const CANCEL_RULE: ContainerMissRule = "FALL_BACK_TO_BOOKING_AND_DATE";
const UPDATE_RULE: ContainerMissRule = "REFUSE";

function buildTrip(overrides: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    containerNumber: null,
    ...overrides,
  } as unknown as Trip;
}

function sameDate(trip: Trip, date: Date | null): boolean {
  return trip.originalPlanningDate === null || date === null
    ? trip.originalPlanningDate === date
    : trip.originalPlanningDate.getTime() === date.getTime();
}

/** The two lookups the resolver uses, over an in-memory set. */
function repositoryOf(stored: readonly Trip[]): TripRepository {
  return {
    findByIdentity: jest.fn(
      ({
        identity,
        statuses,
      }: {
        identity: {
          bookingNumber: string;
          containerNumber: string | null;
          originalPlanningDate: Date | null;
        };
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          stored.find(
            (trip) =>
              trip.bookingNumber === identity.bookingNumber &&
              trip.containerNumber === identity.containerNumber &&
              sameDate(trip, identity.originalPlanningDate) &&
              statuses.includes(trip.status),
          ) ?? null,
        ),
    ),
    findManyByBookingNumberAndOriginalDate: jest.fn(
      ({
        bookingNumber,
        originalPlanningDate,
        statuses,
      }: {
        bookingNumber: string;
        originalPlanningDate: Date | null;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          stored.filter(
            (trip) =>
              trip.bookingNumber === bookingNumber &&
              sameDate(trip, originalPlanningDate) &&
              statuses.includes(trip.status),
          ),
        ),
    ),
  } as unknown as TripRepository;
}

interface DocumentTrip {
  readonly file: string;
  readonly bookingNumber: string;
  readonly containerNumber: string | null;
  /**
   * The transport date THIS document prints, straight from the parser.
   *
   * Nothing here supplies it: it is whatever the real file says on the
   * `Date/time:` line of its LOADING or DELIVERY section, which is the whole
   * point of matching against real documents rather than fixtures.
   */
  readonly originalPlanningDate: Date;
}

/** Every Trip every fixture in a folder describes, parsed once. */
async function documentsIn(folder: string): Promise<DocumentTrip[]> {
  const parsed: DocumentTrip[] = [];

  for (const file of readdirSync(join(FIXTURES, folder))) {
    if (!file.endsWith(".pdf")) {
      continue;
    }

    const result = await parse(readFileSync(join(FIXTURES, folder, file)));

    // A fixture that cannot be parsed is a different problem; the
    // parser's own suite owns it, and matching has nothing to say.
    if (!result.ok) {
      continue;
    }

    for (const trip of result.trips) {
      parsed.push({
        file,
        bookingNumber: trip.bookingNumber,
        containerNumber: trip.containerNumber,
        /*
         * `trip.date` is the parser's own field for the `Date/time:` line of
         * the section this trip was read from. The Backend stores it as
         * `planningDate` on import and as `original_planning_date` on the Trip,
         * so this is the same value the identity is built from in production.
         */
        originalPlanningDate: new Date(`${trip.date}T00:00:00.000Z`),
      });
    }
  }

  return parsed;
}

describe("the real CANCEL and UPDATE fixtures", () => {
  let cancels: DocumentTrip[];
  let updates: DocumentTrip[];

  beforeAll(async () => {
    cancels = await documentsIn("CANCEL");
    updates = await documentsIn("UPDATE");
  });

  /** The fact that drove the change, asserted rather than remembered. */
  it("shows that most real cancellations print no container", async () => {
    const withoutContainer = cancels.filter(
      (document) => document.containerNumber === null,
    );

    expect(cancels.length).toBeGreaterThan(0);
    expect(withoutContainer.length).toBeGreaterThan(cancels.length / 2);
  });

  describe("every CANCEL finds the Trip its booking names", () => {
    it("matches all of them against one Trip per booking", async () => {
      const results: Array<{ file: string; match: DocumentTripMatch }> = [];

      for (const document of cancels) {
        /*
         * The Trip as it realistically stands: created from the original order
         * with no container, and given one by hand afterwards. That is the
         * exact case that used to fail.
         */
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: document.containerNumber ?? "EUCU9999999",
          }),
        ]);

        results.push({
          file: document.file,
          match: await resolveTripForDocument(repository, document, CANCEL_RULE),
        });
      }

      expect(
        results.filter(({ match }) => match.kind !== "MATCHED"),
      ).toEqual([]);
    });

    it("uses booking-only for the ones printing no container", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            // A container the operator typed in later.
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, CANCEL_RULE)).toMatchObject(
          { kind: "MATCHED", method: "BOOKING_ONLY" },
        );
      }
    });

    it("uses booking and container for the ones printing one", async () => {
      for (const document of cancels.filter((d) => d.containerNumber !== null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: document.containerNumber,
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, CANCEL_RULE)).toMatchObject(
          { kind: "MATCHED", method: "BOOKING_AND_CONTAINER" },
        );
      }
    });

    /** A booking held twice: no cancellation is applied to a guess. */
    it("refuses every container-less CANCEL against an ambiguous booking", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            id: "a",
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "EUCU1111111",
          }),
          buildTrip({
            id: "b",
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "PVDU2222222",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, CANCEL_RULE)).toMatchObject(
          { kind: "AMBIGUOUS_BOOKING_MATCH", tripCount: 2 },
        );
      }
    });

    it("finds nothing when the booking is genuinely unknown", async () => {
      for (const document of cancels) {
        expect(
          await resolveTripForDocument(repositoryOf([]), document, CANCEL_RULE),
        ).toMatchObject({ kind: "NO_MATCHING_TRIP" });
      }
    });
  });

  describe("every UPDATE finds the Trip its booking names", () => {
    it("matches all of them against one Trip per booking", async () => {
      for (const document of updates) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: document.containerNumber ?? "EUCU9999999",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, UPDATE_RULE)).toMatchObject(
          { kind: "MATCHED" },
        );
      }
    });

    /**
     * The duplicate this prevents: a container-less UPDATE that found nothing
     * used to CREATE a Trip, giving the booking a second one.
     */
    it("does not report no-match when the booking is held once", async () => {
      for (const document of updates.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(
          (await resolveTripForDocument(repository, document, UPDATE_RULE)).kind,
        ).not.toBe("NO_MATCHING_TRIP");
      }
    });

    it("matches strictly when the document prints a container", async () => {
      for (const document of updates.filter((d) => d.containerNumber !== null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            // The date THIS document prints. Identity is scoped to it.
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "PVDU0000000",
          }),
        ]);

        // A different container on the same booking is a different transport.
        expect(await resolveTripForDocument(repository, document, UPDATE_RULE)).toMatchObject(
          { kind: "NO_MATCHING_TRIP" },
        );
      }
    });
  });

  /**
   * The parser hands over the CANONICAL form, not the printed one.
   *
   * `EUCU 200024/9` is typography for a human; `EUCU2000249` is the identity,
   * and it is what the Trip stores and what matching compares — so two
   * documents printing one container differently still name one transport.
   */
  it("delivers a canonical container, not the printed formatting", async () => {
    const printed = cancels.find((d) => d.containerNumber !== null);

    expect(printed?.containerNumber).not.toMatch(/[\s/\\]/);
    expect(printed?.containerNumber).toMatch(/^[A-Za-z0-9]+$/);

    const repository = repositoryOf([
      buildTrip({
        bookingNumber: printed?.bookingNumber as string,
        containerNumber: printed?.containerNumber as string,
        originalPlanningDate: printed?.originalPlanningDate as Date,
      }),
    ]);

    expect(
      await resolveTripForDocument(repository, printed as DocumentTrip, CANCEL_RULE),
    ).toMatchObject({ kind: "MATCHED" });
  });

  /**
   * ── THE IDENTITY DATE COMES FROM THE DOCUMENT ─────────────────────────────
   * Every assertion below is driven by dates the real files actually print. No
   * date is supplied by this test, which is the point: if the parser ever
   * started handing over an email date, an import timestamp or a voyage date,
   * these would fail rather than quietly matching the wrong Trip.
   */
  /**
   * ── THE CANCEL FALLBACK, ON REAL DOCUMENTS ────────────────────────────────
   * The scenario the fallback exists for, driven by the real files:
   *
   *   the order was placed with NO container;
   *   an operator entered one from the driver afterwards;
   *   the customer cancels, naming the container THEY know.
   *
   * The exact identity finds nothing, because our record and theirs differ. A
   * cancellation must still be applied — refusing would leave a real
   * cancellation silently unapplied, which is the failure this whole rule
   * exists to prevent.
   */
  describe("a cancellation naming a container we never recorded", () => {
    /** A container no fixture prints, so the exact lookup cannot succeed. */
    const CUSTOMERS_CONTAINER = "MSCU7654321";

    it("still cancels the Trip, through the booking and the date", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            id: "typed-in",
            bookingNumber: document.bookingNumber,
            originalPlanningDate: document.originalPlanningDate,
            // Entered by hand after the order arrived without one.
            containerNumber: "EUCU9999999",
          }),
        ]);

        const match = await resolveTripForDocument(
          repository,
          { ...document, containerNumber: CUSTOMERS_CONTAINER },
          CANCEL_RULE,
        );

        expect(match).toMatchObject({
          kind: "MATCHED",
          method: "BOOKING_ONLY",
          trip: { id: "typed-in" },
        });
      }
    });

    /** An UPDATE in the same position refuses, and the caller creates a Trip. */
    it("is refused for a revision, which creates its own Trip instead", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(
          (
            await resolveTripForDocument(
              repository,
              { ...document, containerNumber: CUSTOMERS_CONTAINER },
              UPDATE_RULE,
            )
          ).kind,
        ).toBe("NO_MATCHING_TRIP");
      }
    });

    /**
     * The fallback stays inside its own date. A Trip on the same booking and
     * container ordered for another week is not touched by it.
     */
    it("does not reach a Trip ordered for another date", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const aWeekEarlier = new Date(
          document.originalPlanningDate.getTime() - 7 * 24 * 60 * 60 * 1000,
        );

        const repository = repositoryOf([
          buildTrip({
            id: "other-week",
            bookingNumber: document.bookingNumber,
            originalPlanningDate: aWeekEarlier,
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(
          (
            await resolveTripForDocument(
              repository,
              { ...document, containerNumber: CUSTOMERS_CONTAINER },
              CANCEL_RULE,
            )
          ).kind,
        ).toBe("NO_MATCHING_TRIP");
      }
    });

    /** Two Trips on that booking and date: nobody chooses between them. */
    it("refuses as ambiguous when the fallback finds several", async () => {
      for (const document of cancels.filter((d) => d.containerNumber === null)) {
        const repository = repositoryOf([
          buildTrip({
            id: "a",
            bookingNumber: document.bookingNumber,
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "EUCU1111111",
          }),
          buildTrip({
            id: "b",
            bookingNumber: document.bookingNumber,
            originalPlanningDate: document.originalPlanningDate,
            containerNumber: "PVDU2222222",
          }),
        ]);

        expect(
          await resolveTripForDocument(
            repository,
            { ...document, containerNumber: CUSTOMERS_CONTAINER },
            CANCEL_RULE,
          ),
        ).toMatchObject({ kind: "AMBIGUOUS_BOOKING_MATCH", tripCount: 2 });
      }
    });
  });

  describe("the date every real document is matched on", () => {
    it("is a real calendar date on every fixture", () => {
      expect([...cancels, ...updates].length).toBeGreaterThan(0);

      for (const document of [...cancels, ...updates]) {
        expect(Number.isNaN(document.originalPlanningDate.getTime())).toBe(
          false,
        );
        // Midnight UTC, so it compares cleanly against a DATE column.
        expect(document.originalPlanningDate.toISOString()).toMatch(
          /T00:00:00\.000Z$/,
        );
      }
    });

    /**
     * The case the whole phase exists for, driven by real documents: the same
     * booking and container, ordered again a week later. Only the Trip on the
     * document's own date may be reached.
     */
    it("reaches only the Trip ordered for that date", async () => {
      for (const document of [...cancels, ...updates]) {
        const aWeekEarlier = new Date(
          document.originalPlanningDate.getTime() - 7 * 24 * 60 * 60 * 1000,
        );

        const repository = repositoryOf([
          buildTrip({
            id: "last-week",
            bookingNumber: document.bookingNumber,
            containerNumber: document.containerNumber ?? "EUCU9999999",
            originalPlanningDate: aWeekEarlier,
          }),
          buildTrip({
            id: "this-week",
            bookingNumber: document.bookingNumber,
            containerNumber: document.containerNumber ?? "EUCU9999999",
            originalPlanningDate: document.originalPlanningDate,
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, UPDATE_RULE)).toMatchObject(
          { kind: "MATCHED", trip: { id: "this-week" } },
        );
      }
    });

    /**
     * And a Trip the operator re-planned is still found. `planning_date` moved;
     * the transport the document ordered did not.
     */
    it("still reaches a Trip whose planning date was moved by hand", async () => {
      for (const document of [...cancels, ...updates]) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            containerNumber: document.containerNumber ?? "EUCU9999999",
            originalPlanningDate: document.originalPlanningDate,
            planningDate: new Date(
              document.originalPlanningDate.getTime() + 2 * 24 * 60 * 60 * 1000,
            ),
          }),
        ]);

        expect(await resolveTripForDocument(repository, document, UPDATE_RULE)).toMatchObject(
          { kind: "MATCHED" },
        );
      }
    });

    /** Nothing is found for a date no document ordered. */
    it("finds nothing when only another date is stored", async () => {
      for (const document of [...cancels, ...updates]) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            containerNumber: document.containerNumber ?? "EUCU9999999",
            originalPlanningDate: new Date(
              document.originalPlanningDate.getTime() + 7 * 24 * 60 * 60 * 1000,
            ),
          }),
        ]);

        expect((await resolveTripForDocument(repository, document, UPDATE_RULE)).kind).toBe(
          "NO_MATCHING_TRIP",
        );
      }
    });
  });
});
