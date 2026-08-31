import { Trip, TripStatus } from "@prisma/client";

import {
  resolveTripForDocument,
  toContainerIdentity,
  type ContainerMissRule,
} from "./document-trip-matching";
import type { TripRepository } from "./trip.repository";

/**
 * Which Trip an incoming UPDATE or CANCEL is about.
 *
 * ── THE RULE THIS FILE HOLDS IN PLACE ───────────────────────────────────────
 *   container printed → booking AND container, exactly, FIRST.
 *   container absent  → booking and date alone.
 *   both halves scoped to the document's own ORIGINAL transport date.
 *   booking alone, several Trips on that date → nobody chooses.
 *
 * The booking-only half is the point of the asymmetry. A COLLECTION order is
 * written before anyone knows which container will be picked up, so it prints
 * none — and six of the eight real CANCEL fixtures are exactly that. Requiring
 * a container to match left those cancellations unapplied and silent.
 *
 * ── WHERE THE TWO DOCUMENT KINDS PART COMPANY ───────────────────────────────
 * What happens when a PRINTED container matches nothing is the one difference,
 * and it is the reason most of this file runs its cases against BOTH rules:
 * everything they share must be proved to be shared.
 *
 *   an UPDATE refuses      — the transport it describes is not here, and the
 *                            caller creates it. Revising a different
 *                            container's Trip would rewrite the wrong work.
 *   a CANCEL falls back    — the order was placed with no container, an
 *                            operator typed one in, and the customer cancels
 *                            naming theirs. Refusing would leave a real
 *                            cancellation unapplied. A CANCEL creates nothing,
 *                            so the looser rule costs nothing.
 *
 * ── AND THE DATE IS PART OF THE IDENTITY ────────────────────────────────────
 * The same booking and the same container come round again a week later as a
 * genuinely different transport. The date separates them, and it is the
 * ORIGINAL date — what the document said — never the current planning date,
 * which the operator may move without changing which transport this is.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Last week's transport. */
const D1 = new Date("2026-08-24T00:00:00.000Z");
/** This week's, same booking, same container. A different Trip. */
const D2 = new Date("2026-08-31T00:00:00.000Z");

const BOOKING = "ANRDUB2793554";
const CONTAINER = "EUCU1451295";

const UPDATE: ContainerMissRule = "REFUSE";
const CANCEL: ContainerMissRule = "FALL_BACK_TO_BOOKING_AND_DATE";

/** The cases that must behave identically whichever document arrived. */
const BOTH: [string, ContainerMissRule][] = [
  ["an UPDATE", UPDATE],
  ["a CANCEL", CANCEL],
];

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

describe("resolving the Trip a document names", () => {
  /** The exact identity is tried first, and it answers the same way for both. */
  describe("when the document prints a container that exists", () => {
    const trip = buildTrip({ containerNumber: CONTAINER });

    it.each(BOTH)("matches on booking and container for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([trip]),
        names(CONTAINER),
        rule,
      );

      expect(match).toMatchObject({
        kind: "MATCHED",
        method: "BOOKING_AND_CONTAINER",
      });
    });

    it.each(BOTH)("does not reach the booking lookup for %s", async (_l, rule) => {
      const repository = repositoryOf([trip]);

      await resolveTripForDocument(repository, names(CONTAINER), rule);

      expect(
        repository.findManyByBookingNumberAndOriginalDate,
      ).not.toHaveBeenCalled();
    });
  });

  /**
   * ── THE DIFFERENCE, STATED TWICE ──────────────────────────────────────────
   * The same repository, the same document, two answers — decided only by which
   * kind of document arrived.
   */
  describe("when the document prints a container that matches nothing", () => {
    /** A Trip on the same booking and date, holding a DIFFERENT container. */
    const other = buildTrip({ containerNumber: "PVDU3013260" });

    it("refuses for an UPDATE, so the caller creates a Trip", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([other]),
        names(CONTAINER),
        UPDATE,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    it("never reaches the booking lookup for an UPDATE", async () => {
      const repository = repositoryOf([other]);

      await resolveTripForDocument(repository, names(CONTAINER), UPDATE);

      expect(
        repository.findManyByBookingNumberAndOriginalDate,
      ).not.toHaveBeenCalled();
    });

    it("falls back to booking and date for a CANCEL", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([other]),
        names(CONTAINER),
        CANCEL,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    /**
     * ── THE CASE THE FALLBACK EXISTS FOR ────────────────────────────────────
     * The order was placed with no container. An operator entered one from the
     * driver. The customer cancels, naming the container THEY know. The exact
     * identity finds nothing, and the cancellation must still be applied.
     */
    it("cancels the Trip whose container was entered by hand", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ id: "typed-in", containerNumber: CONTAINER })]),
        // The stored container happens to be the same; what matters is that the
        // exact lookup is not what found it.
        names("PVDU3013260"),
        CANCEL,
      );

      expect(match).toMatchObject({
        kind: "MATCHED",
        method: "BOOKING_ONLY",
        trip: { id: "typed-in" },
      });
    });

    it.each(BOTH)("finds nothing for %s when the booking is not held", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([]),
        names(CONTAINER),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** The fallback narrows by date like every other lookup here. */
    it("does not let a CANCEL fall back onto another date", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ originalPlanningDate: D2 })]),
        names(CONTAINER, D1),
        CANCEL,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** The fallback is the same lookup, so it inherits the same ambiguity. */
    it("refuses a CANCEL fallback that finds several Trips", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
          buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
        ]),
        names(CONTAINER),
        CANCEL,
      );

      expect(match).toEqual({
        kind: "AMBIGUOUS_BOOKING_MATCH",
        tripCount: 2,
      });
    });

    it.each([
      ["newest", "b"],
      ["oldest", "a"],
    ])("never picks the %s in an ambiguous CANCEL fallback", async (_l, id) => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
          buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
        ]),
        names(CONTAINER),
        CANCEL,
      );

      expect(match).not.toMatchObject({ kind: "MATCHED", trip: { id } });
    });

    /** A Trip with no container at all is still reachable by the fallback. */
    it("falls back onto a Trip that has no container", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: null })]),
        names(CONTAINER),
        CANCEL,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    it("refuses the same case for an UPDATE", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: null })]),
        names(CONTAINER),
        UPDATE,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });
  });

  /** With no container printed, the two rules cannot differ at all. */
  describe("when the document prints no container", () => {
    it.each(BOTH)("matches the single Trip for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: null })]),
        names(null),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    /**
     * The operator typed a container in after the Trip was created; the
     * document still prints none. The Trip's CURRENT container must not decide
     * the lookup — under strict identity this found nothing and vanished.
     */
    it.each(BOTH)(
      "matches a Trip whose container was entered later, for %s",
      async (_l, rule) => {
        const match = await resolveTripForDocument(
          repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
          names(null),
          rule,
        );

        expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
      },
    );

    it.each(BOTH)("finds nothing for %s when the booking is not held", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([]),
        names(null),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** Two Trips, one booking, one date, nothing to tell them apart. */
    it.each(BOTH)("refuses %s as ambiguous when several Trips hold it", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
          buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
        ]),
        names(null),
        rule,
      );

      expect(match).toEqual({
        kind: "AMBIGUOUS_BOOKING_MATCH",
        tripCount: 2,
      });
    });

    it.each([
      ["newest", "b"],
      ["oldest", "a"],
    ])("never quietly picks the %s", async (_label, id) => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
          buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
        ]),
        names(null),
        CANCEL,
      );

      expect(match).not.toMatchObject({ kind: "MATCHED", trip: { id } });
    });
  });

  /**
   * ── THE DATE IS PART OF THE IDENTITY ──────────────────────────────────────
   * The same booking and container, a week apart, are two transports. Before
   * the date joined the identity the second one could not be imported at all,
   * and an UPDATE for either reached whichever existed.
   */
  describe("when the same booking and container recur on another date", () => {
    const lastWeek = buildTrip({
      id: "a",
      containerNumber: CONTAINER,
      originalPlanningDate: D1,
      planningDate: D1,
    });
    const thisWeek = buildTrip({
      id: "b",
      containerNumber: CONTAINER,
      originalPlanningDate: D2,
      planningDate: D2,
    });

    it.each(BOTH)("matches only the Trip on the document's date, for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([lastWeek, thisWeek]),
        names(CONTAINER, D2),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "b" } });
    });

    it.each(BOTH)("matches the other one for the other date, for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([lastWeek, thisWeek]),
        names(CONTAINER, D1),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", trip: { id: "a" } });
    });

    it.each(BOTH)("finds nothing for %s on a date neither was ordered for", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([lastWeek, thisWeek]),
        names(CONTAINER, new Date("2026-09-07T00:00:00.000Z")),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /**
     * Two Trips, one booking, no container printed — but on different dates, so
     * the date settles it and there is nothing ambiguous about it.
     */
    it.each(BOTH)("is not ambiguous for %s when the date separates them", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", originalPlanningDate: D1 }),
          buildTrip({ id: "b", originalPlanningDate: D2 }),
        ]),
        names(null, D2),
        rule,
      );

      expect(match).toMatchObject({
        kind: "MATCHED",
        method: "BOOKING_ONLY",
        trip: { id: "b" },
      });
    });
  });

  /**
   * ── AND THE OPERATOR'S DATE IS NOT THE IDENTITY ───────────────────────────
   * A truck re-planned to another day is still the same transport. If matching
   * read `planning_date`, every re-planned Trip would become unreachable by the
   * UPDATE and CANCEL that follow it.
   */
  describe("when the operator has moved the planning date", () => {
    const moved = buildTrip({
      containerNumber: CONTAINER,
      originalPlanningDate: D1,
      // Re-planned by hand to another day.
      planningDate: new Date("2026-09-02T00:00:00.000Z"),
    });

    it.each(BOTH)("still matches %s on the date the document named", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([moved]),
        names(CONTAINER, D1),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED" });
    });

    it.each(BOTH)("does not match %s on the date it was moved to", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([moved]),
        names(CONTAINER, new Date("2026-09-02T00:00:00.000Z")),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    it.each(BOTH)("still matches %s with no container printed", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([moved]),
        names(null, D1),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });
  });

  /**
   * An absent date is a VALUE, exactly as an absent container is — never a
   * wildcard. A Trip created by hand with no date is found only by a document
   * that states none, which no real transport order does.
   */
  describe("when there is no original date", () => {
    const undated = buildTrip({
      containerNumber: CONTAINER,
      originalPlanningDate: null,
      planningDate: null,
    });

    it.each(BOTH)("matches %s only when the document states none either", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([undated]),
        names(CONTAINER, null),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED" });
    });

    it.each(BOTH)("is not reached by %s that states one", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([undated]),
        names(CONTAINER, D1),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    it("does not answer for a dated Trip", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
        names(CONTAINER, null),
        UPDATE,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });
  });

  /**
   * A DELETED Trip never answers for a live document: it is outside the status
   * set, so it neither matches nor counts towards an ambiguity — and it is not
   * resurrected by the CANCEL fallback either.
   */
  describe("which Trips may answer", () => {
    it.each(BOTH)("ignores a DELETED Trip when counting an ambiguity, for %s", async (_l, rule) => {
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
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    it.each(BOTH)("does not match a DELETED Trip on its own identity, for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({
            containerNumber: CONTAINER,
            status: TripStatus.DELETED,
          }),
        ]),
        names(CONTAINER),
        rule,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** The fallback must not reach a Trip the strict lookup was denied. */
    it("does not let the CANCEL fallback reach a DELETED Trip", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({
            containerNumber: "PVDU3013260",
            status: TripStatus.DELETED,
          }),
        ]),
        names(CONTAINER),
        CANCEL,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    it.each(BOTH)("matches a CLOSED Trip for %s, so its own state can refuse", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ status: TripStatus.CLOSED })]),
        names(null),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED" });
    });
  });

  /**
   * ── COST CONFIRMATIONS ARE NOT MATCHED THIS WAY ───────────────────────────
   * A confirmation matches on the booking number alone, with no date, through
   * its own repository method. Asserted here because the two lookups sit side
   * by side and a date added to the wrong one would silently narrow which Trips
   * a confirmation can pay.
   */
  it.each(BOTH)("never uses the Cost Confirmation lookup, for %s", async (_l, rule) => {
    const repository = repositoryOf([buildTrip({ containerNumber: CONTAINER })]);

    await resolveTripForDocument(repository, names(CONTAINER), rule);
    await resolveTripForDocument(repository, names(null), rule);

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

    it("keeps a real value, spaces and slash included", () => {
      expect(toContainerIdentity("EUCU4532322")).toBe("EUCU4532322");
    });

    it("trims the padding around a real value", () => {
      expect(toContainerIdentity("  EUCU4532322  ")).toBe("EUCU4532322");
    });

    it.each(BOTH)("matches by booking alone when the container is blank, for %s", async (_l, rule) => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
        names("   "),
        rule,
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    /**
     * The formatted printing and the canonical one are the same container, and
     * on the same date they are the same Trip.
     */
    it.each(["EUCU 145129/5", "EUCU 145129\\5", "EUCU1451295"])(
      "resolves %s to the same Trip",
      async (printed) => {
        const match = await resolveTripForDocument(
          repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
          names(printed),
          UPDATE,
        );

        expect(match).toMatchObject({
          kind: "MATCHED",
          method: "BOOKING_AND_CONTAINER",
        });
      },
    );

    /** Normalisation does not soften the date: it is still a different Trip. */
    it("does not let a formatted container reach another date", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: CONTAINER })]),
        names("EUCU 145129/5", D2),
        UPDATE,
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });
  });
});
