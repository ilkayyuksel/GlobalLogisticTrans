import { Trip, TripStatus } from "@prisma/client";

import { bookingNumberDigits } from "../common/booking-digits";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * How a Cost Confirmation finds the Trip it belongs to.
 *
 * ── A DIFFERENT RULE FROM TRIP IDENTITY, ON PURPOSE ─────────────────────────
 * A transport order is matched on booking + container + original transport
 * date. A confirmation is matched on the BOOKING NUMBER ALONE, and these tests
 * hold that separation in place: it uses no date, no container, and none of the
 * Trip-identity lookups.
 *
 * ── THE FALLBACK ────────────────────────────────────────────────────────────
 * The confirmation is produced by another system, which does not always print
 * the booking number in full: `ANRDUB2793554` can arrive as `DUB2793554` or as
 * `2793554`. When the exact lookup finds nothing, the digits are compared — by
 * exact equality, never as a substring.
 *
 * The COUNT remains the answer. One is a match; several is an ambiguity the
 * caller refuses rather than resolves, because a confirmation carries money and
 * attaching it to the wrong leg of a booking is a silent invoicing error.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FULL_BOOKING = "ANRDUB2793554";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: FULL_BOOKING,
    containerNumber: null,
    originalPlanningDate: new Date("2026-08-31T00:00:00.000Z"),
    planningDate: new Date("2026-08-31T00:00:00.000Z"),
    ...overrides,
  } as unknown as Trip;
}

/**
 * The two booking lookups, over an in-memory set, behaving like the real ones.
 *
 * Every Trip-identity lookup is present but wired to reject: a confirmation
 * must never reach one, and a test below proves it does not.
 */
function serviceOver(stored: readonly Trip[]) {
  const eligible = (statuses: readonly TripStatus[]) =>
    stored.filter(
      (trip) =>
        trip.bookingNumber !== null && statuses.includes(trip.status),
    );

  const repository = {
    findManyByBookingNumber: jest.fn(
      ({
        bookingNumber,
        statuses,
      }: {
        bookingNumber: string;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          eligible(statuses).filter(
            (trip) => trip.bookingNumber === bookingNumber,
          ),
        ),
    ),
    findManyByBookingDigits: jest.fn(
      ({
        digits,
        statuses,
      }: {
        digits: string;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          eligible(statuses).filter(
            (trip) => bookingNumberDigits(trip.bookingNumber) === digits,
          ),
        ),
    ),
    findByIdentity: jest.fn(() =>
      Promise.reject(new Error("Trip identity, not a Cost Confirmation.")),
    ),
    findManyByBookingNumberAndOriginalDate: jest.fn(() =>
      Promise.reject(new Error("Date-scoped lookup, not a Cost Confirmation.")),
    ),
  };

  const service = new TripService(
    repository as unknown as TripRepository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as never,
  );

  return { service, repository };
}

describe("finding the Trips a Cost Confirmation's booking names", () => {
  describe("when the confirmation prints the booking in full", () => {
    it("matches it exactly", async () => {
      const { service } = serviceOver([buildTrip()]);

      const found = await service.findAllByBookingNumber(FULL_BOOKING);

      expect(found.map((trip) => trip.id)).toEqual(["trip-1"]);
    });

    /** The fallback is second, and an exact hit must never reach it. */
    it("does not fall back when the exact lookup succeeds", async () => {
      const { service, repository } = serviceOver([buildTrip()]);

      await service.findAllByBookingNumber(FULL_BOOKING);

      expect(repository.findManyByBookingDigits).not.toHaveBeenCalled();
    });

    /**
     * Two Trips on one booking stay two. The confirmation names no container
     * that could tell them apart, so the caller refuses on the count.
     */
    it("returns both when the booking holds two Trips", async () => {
      const { service } = serviceOver([
        buildTrip({ id: "a", containerNumber: "EUCU1111111" }),
        buildTrip({ id: "b", containerNumber: "PVDU2222222" }),
      ]);

      expect(await service.findAllByBookingNumber(FULL_BOOKING)).toHaveLength(2);
    });
  });

  describe("when the confirmation prints only part of the booking", () => {
    it.each(["DUB2793554", "2793554", " 2793554 ", "DUB-2793554"])(
      "finds the Trip from %p",
      async (printed) => {
        const { service } = serviceOver([buildTrip()]);

        const found = await service.findAllByBookingNumber(printed);

        expect(found.map((trip) => trip.id)).toEqual(["trip-1"]);
      },
    );

    it("reaches the fallback only after the exact lookup missed", async () => {
      const { service, repository } = serviceOver([buildTrip()]);

      await service.findAllByBookingNumber("2793554");

      expect(repository.findManyByBookingNumber).toHaveBeenCalled();
      expect(repository.findManyByBookingDigits).toHaveBeenCalledWith(
        expect.objectContaining({ digits: "2793554" }),
      );
    });

    /** Different digits are a different booking. */
    it.each(["2793555", "279355", "27935540", "12793554"])(
      "finds nothing for %p",
      async (printed) => {
        const { service } = serviceOver([buildTrip()]);

        expect(await service.findAllByBookingNumber(printed)).toEqual([]);
      },
    );

    /**
     * The property the whole rule rests on. `ANRDUB12793554` CONTAINS the
     * sequence `2793554`, and a substring test would match it. Exact equality
     * does not.
     */
    it("does not match a booking that merely contains the digits", async () => {
      const { service } = serviceOver([
        buildTrip({ bookingNumber: "ANRDUB12793554" }),
      ]);

      expect(await service.findAllByBookingNumber("2793554")).toEqual([]);
    });

    it("finds nothing when no Trip is held at all", async () => {
      const { service } = serviceOver([]);

      expect(await service.findAllByBookingNumber("2793554")).toEqual([]);
    });

    /**
     * Several Trips whose bookings reduce to the same digits. Nobody chooses —
     * the caller sees the count and refuses.
     */
    it("returns every candidate when the digits are ambiguous", async () => {
      const { service } = serviceOver([
        buildTrip({ id: "a", bookingNumber: "ANRDUB2793554" }),
        buildTrip({ id: "b", bookingNumber: "DUB2793554" }),
      ]);

      const found = await service.findAllByBookingNumber("2793554");

      expect(found.map((trip) => trip.id).sort()).toEqual(["a", "b"]);
    });

    it("picks neither the first nor the last of an ambiguous set", async () => {
      const { service } = serviceOver([
        buildTrip({ id: "a", bookingNumber: "ANRDUB2793554" }),
        buildTrip({ id: "b", bookingNumber: "DUB2793554" }),
      ]);

      expect(await service.findAllByBookingNumber("2793554")).toHaveLength(2);
    });

    /** A reference with no digits identifies nothing, and asks nothing. */
    it.each(["", "   ", "ANRDUB", "????"])(
      "does not run the fallback for %p",
      async (printed) => {
        const { service, repository } = serviceOver([buildTrip()]);

        expect(await service.findAllByBookingNumber(printed)).toEqual([]);
        expect(repository.findManyByBookingDigits).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * ── WHAT THE CONFIRMATION NEVER CONSULTS ──────────────────────────────────
   * Not the date, not the container, and none of the Trip-identity lookups.
   * Asserted directly because those lookups sit beside this one in the same
   * repository, and a date added to the wrong one would silently narrow which
   * Trips a confirmation can pay.
   */
  describe("what it never consults", () => {
    it("never uses the Trip-identity lookups", async () => {
      const { service, repository } = serviceOver([buildTrip()]);

      await service.findAllByBookingNumber(FULL_BOOKING);
      await service.findAllByBookingNumber("2793554");

      expect(repository.findByIdentity).not.toHaveBeenCalled();
      expect(
        repository.findManyByBookingNumberAndOriginalDate,
      ).not.toHaveBeenCalled();
    });

    it.each([
      ["the exact path", FULL_BOOKING],
      ["the fallback", "2793554"],
    ])("passes no date and no container through %s", async (_label, printed) => {
      const { service, repository } = serviceOver([buildTrip()]);

      await service.findAllByBookingNumber(printed);

      for (const lookup of [
        repository.findManyByBookingNumber,
        repository.findManyByBookingDigits,
      ]) {
        for (const [query] of lookup.mock.calls) {
          expect(query).not.toHaveProperty("originalPlanningDate");
          expect(query).not.toHaveProperty("planningDate");
          expect(query).not.toHaveProperty("containerNumber");
        }
      }
    });

    /** Trips on different dates are equally payable by one confirmation. */
    it("finds Trips whatever their original planning date", async () => {
      const { service } = serviceOver([
        buildTrip({
          id: "a",
          bookingNumber: "DUB2793554",
          originalPlanningDate: new Date("2026-08-24T00:00:00.000Z"),
        }),
      ]);

      expect(await service.findAllByBookingNumber("2793554")).toHaveLength(1);
    });
  });

  /**
   * A DELETED Trip holds no booking number, so it answers for nothing — through
   * the exact lookup or the fallback alike.
   */
  describe("which Trips may answer", () => {
    it("excludes a DELETED Trip from the exact lookup", async () => {
      const { service } = serviceOver([
        buildTrip({ status: TripStatus.DELETED }),
      ]);

      expect(await service.findAllByBookingNumber(FULL_BOOKING)).toEqual([]);
    });

    it("excludes a DELETED Trip from the fallback", async () => {
      const { service } = serviceOver([
        buildTrip({ status: TripStatus.DELETED }),
      ]);

      expect(await service.findAllByBookingNumber("2793554")).toEqual([]);
    });

    it("does not let a DELETED Trip create an ambiguity", async () => {
      const { service } = serviceOver([
        buildTrip({ id: "live", bookingNumber: "DUB2793554" }),
        buildTrip({
          id: "deleted",
          bookingNumber: "ANRDUB2793554",
          status: TripStatus.DELETED,
        }),
      ]);

      const found = await service.findAllByBookingNumber("2793554");

      expect(found.map((trip) => trip.id)).toEqual(["live"]);
    });

    it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
      "lets a %s Trip answer",
      async (status) => {
        const { service } = serviceOver([
          buildTrip({ status, bookingNumber: "DUB2793554" }),
        ]);

        expect(await service.findAllByBookingNumber("2793554")).toHaveLength(1);
      },
    );
  });
});
