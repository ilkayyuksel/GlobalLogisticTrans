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
 *   container printed → booking AND container, strictly. No fallback.
 *   container absent  → booking alone.
 *   booking alone, several Trips → nobody chooses. AMBIGUOUS_BOOKING_MATCH.
 *
 * The asymmetry is the point. A COLLECTION order is written before anyone knows
 * which container will be picked up, so it prints none — and six of the eight
 * real CANCEL fixtures are exactly that. Requiring a container to match left
 * those cancellations unapplied and silent.
 *
 * The strictness is equally the point. A document that DOES print a container
 * never falls back: booking A container Y naming nothing means that transport
 * is not here, and cancelling booking A container X instead would cancel a
 * transport nobody called off.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: "ANRDUB2790203",
    containerNumber: null,
    ...overrides,
  } as unknown as Trip;
}

/** An in-memory repository with only the two lookups the resolver uses. */
function repositoryOf(stored: readonly Trip[]) {
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
              // Absent is a VALUE: null matches null, and nothing else.
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

describe("resolving the Trip a document names", () => {
  describe("when the document prints a container", () => {
    const trip = buildTrip({ containerNumber: "EUCU4532322" });

    it("matches on booking and container together", async () => {
      const match = await resolveTripForDocument(repositoryOf([trip]), {
        bookingNumber: "ANRDUB2790203",
        containerNumber: "EUCU4532322",
      });

      expect(match).toMatchObject({
        kind: "MATCHED",
        method: "BOOKING_AND_CONTAINER",
      });
    });

    /** The protection that made the container part of the identity. */
    it("does not match a different container on the same booking", async () => {
      const match = await resolveTripForDocument(repositoryOf([trip]), {
        bookingNumber: "ANRDUB2790203",
        containerNumber: "PVDU3013260",
      });

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** And it never falls back to the booking when the container misses. */
    it("does not fall back to booking-only", async () => {
      const repository = repositoryOf([trip]);

      await resolveTripForDocument(repository, {
        bookingNumber: "ANRDUB2790203",
        containerNumber: "PVDU3013260",
      });

      expect(repository.findManyByBookingNumber).not.toHaveBeenCalled();
    });

    it("does not match a Trip that has no container", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: null })]),
        {
          bookingNumber: "ANRDUB2790203",
          containerNumber: "EUCU4532322",
        },
      );

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });
  });

  describe("when the document prints no container", () => {
    it("matches the single Trip holding the booking", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: null })]),
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    /**
     * THE CASE THIS PHASE EXISTS FOR. The operator typed a container in after
     * the Trip was created; the cancellation still prints none. Under strict
     * identity this found nothing and vanished.
     */
    it("matches a Trip whose container was entered later", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: "EUCU4532322" })]),
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    it("finds nothing when the booking is not held", async () => {
      const match = await resolveTripForDocument(repositoryOf([]), {
        bookingNumber: "ANRDUB2790203",
        containerNumber: null,
      });

      expect(match.kind).toBe("NO_MATCHING_TRIP");
    });

    /** Two Trips, one booking, nothing to tell them apart. Nobody chooses. */
    it("refuses as ambiguous when the booking holds several Trips", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([
          buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
          buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
        ]),
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
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
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
      );

      expect(match).not.toMatchObject({ kind: "MATCHED", trip: { id } });
    });
  });

  /**
   * A DELETED Trip never answers for a live document: it is outside the status
   * set, so it neither matches nor counts towards an ambiguity.
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
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });

    it("matches a CLOSED Trip, so its own state can refuse the document", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ status: TripStatus.CLOSED })]),
        { bookingNumber: "ANRDUB2790203", containerNumber: null },
      );

      expect(match).toMatchObject({ kind: "MATCHED" });
    });
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

    it("matches by booking alone when the container is blank", async () => {
      const match = await resolveTripForDocument(
        repositoryOf([buildTrip({ containerNumber: "EUCU4532322" })]),
        { bookingNumber: "ANRDUB2790203", containerNumber: "   " },
      );

      expect(match).toMatchObject({ kind: "MATCHED", method: "BOOKING_ONLY" });
    });
  });
});
