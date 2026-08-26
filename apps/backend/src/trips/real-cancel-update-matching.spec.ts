import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Trip, TripStatus } from "@prisma/client";
import { parse } from "@tms/parser";

import {
  resolveTripForDocument,
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

function buildTrip(overrides: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    containerNumber: null,
    ...overrides,
  } as unknown as Trip;
}

/** The two lookups the resolver uses, over an in-memory set. */
function repositoryOf(stored: readonly Trip[]): TripRepository {
  return {
    findByIdentity: jest.fn(
      ({
        identity,
        statuses,
      }: {
        identity: { bookingNumber: string; containerNumber: string | null };
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          stored.find(
            (trip) =>
              trip.bookingNumber === identity.bookingNumber &&
              trip.containerNumber === identity.containerNumber &&
              statuses.includes(trip.status),
          ) ?? null,
        ),
    ),
    findManyByBookingNumber: jest.fn(
      ({
        bookingNumber,
        statuses,
      }: {
        bookingNumber: string;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          stored.filter(
            (trip) =>
              trip.bookingNumber === bookingNumber &&
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
            containerNumber: document.containerNumber ?? "EUCU9999999",
          }),
        ]);

        results.push({
          file: document.file,
          match: await resolveTripForDocument(repository, document),
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
            // A container the operator typed in later.
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document)).toMatchObject(
          { kind: "MATCHED", method: "BOOKING_ONLY" },
        );
      }
    });

    it("uses booking and container for the ones printing one", async () => {
      for (const document of cancels.filter((d) => d.containerNumber !== null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            containerNumber: document.containerNumber,
          }),
        ]);

        expect(await resolveTripForDocument(repository, document)).toMatchObject(
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
            containerNumber: "EUCU1111111",
          }),
          buildTrip({
            id: "b",
            bookingNumber: document.bookingNumber,
            containerNumber: "PVDU2222222",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document)).toMatchObject(
          { kind: "AMBIGUOUS_BOOKING_MATCH", tripCount: 2 },
        );
      }
    });

    it("finds nothing when the booking is genuinely unknown", async () => {
      for (const document of cancels) {
        expect(
          await resolveTripForDocument(repositoryOf([]), document),
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
            containerNumber: document.containerNumber ?? "EUCU9999999",
          }),
        ]);

        expect(await resolveTripForDocument(repository, document)).toMatchObject(
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
            containerNumber: "EUCU9999999",
          }),
        ]);

        expect(
          (await resolveTripForDocument(repository, document)).kind,
        ).not.toBe("NO_MATCHING_TRIP");
      }
    });

    it("matches strictly when the document prints a container", async () => {
      for (const document of updates.filter((d) => d.containerNumber !== null)) {
        const repository = repositoryOf([
          buildTrip({
            bookingNumber: document.bookingNumber,
            containerNumber: "PVDU0000000",
          }),
        ]);

        // A different container on the same booking is a different transport.
        expect(await resolveTripForDocument(repository, document)).toMatchObject(
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
      }),
    ]);

    expect(
      await resolveTripForDocument(repository, printed as DocumentTrip),
    ).toMatchObject({ kind: "MATCHED" });
  });
});
