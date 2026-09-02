import { Trip, TripStatus } from "@prisma/client";

import {
  resolveTripForDocument,
  toContainerIdentity,
} from "./document-trip-matching";
import type { TripRepository } from "./trip.repository";

/**
 * Which Trip an incoming UPDATE or CANCEL is about.
 *
 * ── THE RULE THIS FILE HOLDS IN PLACE ───────────────────────────────────────
 * Two phases, and the order is the whole rule:
 *
 *   1. booking + container + the document's own transport date, tried only
 *      when the document states a container;
 *   2. booking + that date, with the container dropped entirely.
 *
 * One Trip answers. Nothing hands on to the next phase. Several is an ambiguity
 * nobody may resolve automatically — not the newest, not the oldest, not the one
 * planned first.
 *
 * ── WHY THE CONTAINER IS DROPPED, AND ONLY LAST ─────────────────────────────
 * A container printed on an incoming document does not reliably identify a
 * Trip. A COLLECTION order is written before anyone knows which container will
 * be picked up, so it prints none — six of the eight real CANCEL fixtures are
 * exactly that — and an operator types one in later. The next document for that
 * transport may then carry a value we never recorded, or one we recorded by
 * hand. Matching strictly on it left real revisions and real cancellations
 * unapplied.
 *
 * So the container is used while it helps and abandoned when it does not, and
 * never abandoned first: a document naming a container we hold must reach that
 * Trip and no other.
 *
 * ── UPDATE AND CANCEL ANSWER ALIKE ──────────────────────────────────────────
 * They once differed on what a container miss meant. Both now reach the same
 * last phase, so the distinction changes no outcome and is gone from the rule.
 * What a CALLER does with the answer still differs — a revision may create a
 * Trip, a cancellation never does — and that lives in the revision service.
 *
 * ── AND THE DATE IS NEVER DROPPED ───────────────────────────────────────────
 * The same booking and container come round again a week later as a genuinely
 * different transport. It is the ORIGINAL date — what the document said — never
 * the current planning date, which an operator may move.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Last week's transport. */
const D1 = new Date("2026-08-24T00:00:00.000Z");
/** This week's, same booking, same container. A different Trip. */
const D2 = new Date("2026-08-31T00:00:00.000Z");

const BOOKING = "ANRDUB2793554";
const CONTAINER = "EUCU1451295";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    containerNumber: null,
    originalPlanningDate: D1,
    // The operator's date. Deliberately equal to the original here so that a
    // test which moves it has to say so explicitly.
    planningDate: D1,
    ...overrides,
  } as unknown as Trip;
}

/** What a document says about itself. The date defaults to last week's. */
function names(
  containerNumber: string | null,
  originalPlanningDate: Date | null = D1,
) {
  return { bookingNumber: BOOKING, containerNumber, originalPlanningDate };
}

/**
 * An in-memory repository with only the lookups the resolver uses.
 *
 * `findManyByBookingNumber` is present but deliberately wired to a rejection:
 * it belongs to Cost Confirmations, and a test below proves document matching
 * never reaches for it.
 */
function repositoryOf(stored: readonly Trip[]) {
  const sameDate = (trip: Trip, date: Date | null) =>
    trip.originalPlanningDate === null || date === null
      ? trip.originalPlanningDate === date
      : trip.originalPlanningDate.getTime() === date.getTime();

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
              // Absent is a VALUE: null matches null, and nothing else.
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
    findManyByBookingNumber: jest.fn(() =>
      Promise.reject(new Error("Cost Confirmation lookup, not this one.")),
    ),
  } as unknown as TripRepository;
}

describe("PHASE 1 — the whole identity", () => {
  const trip = buildTrip({ containerNumber: CONTAINER });

  it("matches on booking, container and date together", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([trip]),
      names(CONTAINER),
    );

    expect(match).toMatchObject({
      kind: "MATCHED",
      method: "BOOKING_AND_CONTAINER",
    });
  });

  /** A phase that answers STOPS. The fallback must not even be consulted. */
  it("never reaches the fallback when it answers", async () => {
    const repository = repositoryOf([trip]);

    await resolveTripForDocument(repository, names(CONTAINER));

    expect(
      repository.findManyByBookingNumberAndOriginalDate,
    ).not.toHaveBeenCalled();
  });

  /** A document naming no container has no identity phase to run. */
  it("is skipped when the document names no container", async () => {
    const repository = repositoryOf([buildTrip()]);

    await resolveTripForDocument(repository, names(null));

    expect(repository.findByIdentity).not.toHaveBeenCalled();
  });

  /** It reaches the Trip holding that container, and no other. */
  it("picks only the Trip holding the container named", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([
        buildTrip({ id: "a", containerNumber: "PVDU3013260" }),
        buildTrip({ id: "b", containerNumber: CONTAINER }),
      ]),
      names(CONTAINER),
    );

    expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "b" } });
  });
});

/**
 * ── PHASE 2, THE LAST ───────────────────────────────────────────────────────
 * The booking and the date, with the container dropped. Reached only because
 * Phase 1 found nothing.
 */
describe("PHASE 2 — the booking and the date", () => {
  it("matches the single Trip on that booking and date", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip()]),
      names(null),
    );

    expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });

  /**
   * ── THE CASE THE FALLBACK EXISTS FOR ──────────────────────────────────────
   * The order was placed with no container. An operator entered one. The next
   * document names a container we cannot match — and the transport is plainly
   * the same one.
   */
  it("reaches a Trip whose container the document does not match", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: "PVDU3013260" })]),
      names(CONTAINER),
    );

    expect(match).toMatchObject({
      kind: "MATCHED",
      method: "BOOKING_ONLY",
      trip: { id: "trip-1" },
    });
  });

  it("reaches a Trip that holds no container at all", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: null })]),
      names(CONTAINER),
    );

    expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });

  /** The Trip's own container is never consulted in this phase. */
  it("matches a Trip whose container was entered later", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
      names(null),
    );

    expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });

  it("finds nothing when the booking is not held", async () => {
    expect(
      (await resolveTripForDocument(repositoryOf([]), names(CONTAINER))).kind,
    ).toBe("NO_MATCHING_TRIP");
  });

  /** The date is NOT dropped with the container. */
  it("does not reach across to another date", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ originalPlanningDate: D2 })]),
      names(CONTAINER, D1),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });
});

/**
 * ── AMBIGUITY STOPS EVERYTHING ──────────────────────────────────────────────
 * Several candidates is an answer, not a problem to be narrowed. A looser phase
 * could only ever find more, so nothing is retried and nothing is chosen.
 */
describe("ambiguity", () => {
  const twoOnOneDate = [
    buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
    buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
  ];

  it("reports the count when the last phase finds several", async () => {
    const match = await resolveTripForDocument(
      repositoryOf(twoOnOneDate),
      names(null),
    );

    expect(match).toEqual({
      kind: "AMBIGUOUS_BOOKING_MATCH",
      tripCount: 2,
    });
  });

  it("is ambiguous for a container-naming document too", async () => {
    const match = await resolveTripForDocument(
      repositoryOf(twoOnOneDate),
      names("MSCU7654321"),
    );

    expect(match).toMatchObject({ kind: "AMBIGUOUS_BOOKING_MATCH" });
  });

  it.each([
    ["newest", "b"],
    ["oldest", "a"],
  ])("never quietly picks the %s", async (_label, id) => {
    const match = await resolveTripForDocument(
      repositoryOf(twoOnOneDate),
      names(null),
    );

    expect(match).not.toMatchObject({ kind: "MATCHED", trip: { id } });
  });

  /**
   * Phase 1 cannot itself be ambiguous — the unique index allows only one live
   * Trip per booking, container and date — so a Phase 1 HIT ends the search
   * before the fallback could widen it.
   */
  it("stops at a Phase 1 hit even when the booking holds several", async () => {
    const repository = repositoryOf([
      buildTrip({ id: "exact", containerNumber: CONTAINER }),
      buildTrip({ id: "other", containerNumber: "PVDU2222222" }),
    ]);

    const match = await resolveTripForDocument(repository, names(CONTAINER));

    expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "exact" } });
    expect(
      repository.findManyByBookingNumberAndOriginalDate,
    ).not.toHaveBeenCalled();
  });
});

/**
 * The same booking and container a week apart are two transports, and the date
 * separates them in every phase.
 */
describe("when the same booking recurs on another date", () => {
  const lastWeek = buildTrip({
    id: "a",
    containerNumber: CONTAINER,
    originalPlanningDate: D1,
  });
  const thisWeek = buildTrip({
    id: "b",
    containerNumber: CONTAINER,
    originalPlanningDate: D2,
  });

  it("matches only the Trip on the document's own date", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([lastWeek, thisWeek]),
      names(CONTAINER, D2),
    );

    expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "b" } });
  });

  it("finds nothing for a date neither was ordered for", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([lastWeek, thisWeek]),
      names(CONTAINER, new Date("2026-09-07T00:00:00.000Z")),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });

  /** Two Trips separated only by date are not ambiguous — the date decides. */
  it("is not ambiguous when the date separates them", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([
        buildTrip({ id: "a", originalPlanningDate: D1 }),
        buildTrip({ id: "b", originalPlanningDate: D2 }),
      ]),
      names(null, D2),
    );

    expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "b" } });
  });

  /** And the fallback cannot reach across it either. */
  it("does not let the fallback cross a date boundary", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([lastWeek]),
      names("MSCU7654321", D2),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });
});

/**
 * A truck re-planned to another day is still the same transport. If matching
 * read `planning_date`, every re-planned Trip would become unreachable.
 */
describe("when the operator has moved the planning date", () => {
  const moved = buildTrip({
    containerNumber: CONTAINER,
    originalPlanningDate: D1,
    planningDate: new Date("2026-09-02T00:00:00.000Z"),
  });

  it("still matches on the date the document named", async () => {
    expect(
      await resolveTripForDocument(repositoryOf([moved]), names(CONTAINER, D1)),
    ).toMatchObject({ kind: "MATCHED" });
  });

  it("does not match on the date it was moved to", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([moved]),
      names(CONTAINER, new Date("2026-09-02T00:00:00.000Z")),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });

  it("still matches through the fallback", async () => {
    expect(
      await resolveTripForDocument(repositoryOf([moved]), names(null, D1)),
    ).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });
});

/**
 * An absent date is a VALUE, never a wildcard. A Trip created by hand with no
 * date is found only by a document that states none.
 */
describe("when there is no original date", () => {
  const undated = buildTrip({
    containerNumber: CONTAINER,
    originalPlanningDate: null,
    planningDate: null,
  });

  it("matches only a document that states none either", async () => {
    expect(
      await resolveTripForDocument(
        repositoryOf([undated]),
        names(CONTAINER, null),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });

  it("is not reached by a document that states one", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([undated]),
      names(CONTAINER, D1),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });

  it("does not answer for a dated Trip", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
      names(CONTAINER, null),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });
});

/**
 * A DELETED Trip never answers for a live document, in either phase — and the
 * fallback must not resurrect one the strict phase was denied.
 */
describe("which Trips may answer", () => {
  it("ignores a DELETED Trip when counting an ambiguity", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([
        buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
        buildTrip({
          id: "b",
          containerNumber: "PVDU2222222",
          status: TripStatus.DELETED,
        }),
      ]),
      names(null),
    );

    expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });

  it("does not match a DELETED Trip on its own identity", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([
        buildTrip({ containerNumber: CONTAINER, status: TripStatus.DELETED }),
      ]),
      names(CONTAINER),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });

  it("does not let the fallback reach a DELETED Trip", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([
        buildTrip({
          containerNumber: "PVDU3013260",
          status: TripStatus.DELETED,
        }),
      ]),
      names(CONTAINER),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });

  it("matches a CLOSED Trip, so its own state can refuse the document", async () => {
    expect(
      await resolveTripForDocument(
        repositoryOf([buildTrip({ status: TripStatus.CLOSED })]),
        names(null),
      ),
    ).toMatchObject({ kind: "MATCHED" });
  });
});

/**
 * A confirmation matches on the booking alone through its own lookup. Asserted
 * because the two sit side by side in one repository.
 */
it("never uses the Cost Confirmation lookup", async () => {
  const repository = repositoryOf([buildTrip({ containerNumber: CONTAINER })]);

  await resolveTripForDocument(repository, names(CONTAINER));
  await resolveTripForDocument(repository, names(null));

  expect(repository.findManyByBookingNumber).not.toHaveBeenCalled();
});

/**
 * `""`, `" "` and null all say the same thing: the document printed no
 * container. Three identities separated by invisible characters would be a
 * matching rule nobody could reason about.
 */
describe("what counts as no container", () => {
  it.each([null, undefined, "", "   ", "\t", "\n"])(
    "treats %p as absent",
    (value) => {
      expect(toContainerIdentity(value as string | null)).toBeNull();
    },
  );

  it("keeps a real value", () => {
    expect(toContainerIdentity("EUCU4532322")).toBe("EUCU4532322");
  });

  it("trims the padding around a real value", () => {
    expect(toContainerIdentity("  EUCU4532322  ")).toBe("EUCU4532322");
  });

  it("matches by booking and date when the container is blank", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
      names("   "),
    );

    expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
  });

  /** The printed and canonical forms are one container, and one Trip. */
  it.each(["EUCU 145129/5", "EUCU 145129\\5", "EUCU1451295"])(
    "resolves %s through the identity phase",
    async (printed) => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
        names(printed),
      );

      expect(match).toMatchObject({
        kind: "MATCHED",
        method: "BOOKING_AND_CONTAINER",
      });
    },
  );

  it("does not let a formatted container reach another date", async () => {
    const match = await resolveTripForDocument(
      repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
      names("EUCU 145129/5", D2),
    );

    expect(match.kind).toBe("NO_MATCHING_TRIP");
  });
});
