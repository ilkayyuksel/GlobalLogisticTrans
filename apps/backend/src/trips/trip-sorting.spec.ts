import { buildOrderBy, DEFAULT_TRIP_SORT_FIELD } from "./trip.repository";

/**
 * The order a planning list is read in.
 *
 * These assert the SHAPE of the order Prisma is given, which is what decides
 * both what the page shows and which Trips land on which page. The rules they
 * pin down are operational, not cosmetic:
 *
 *   - a day is the unit of planning, so the date can never stop being first;
 *   - the planner chooses whether the day reads TRUCK BY TRUCK or AS IT
 *     HAPPENS — which is the choice this file gained;
 *   - a Trip with no time is unknown, not early;
 *   - the order is total, so paging cannot repeat or drop a row.
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────
 * The plate used to be key 2 unconditionally, ahead of the time and not
 * adjustable, so choosing a time only ordered Trips WITHIN one truck and the
 * day could not be read chronologically at all. The plate is now a field a
 * planner can choose, and choosing it is the default — so the ordinary reading
 * is unchanged and the other one became possible.
 */
describe("buildOrderBy", () => {
  const DATE_KEY = 0;
  const TIE_BREAK_KEY = 3;

  /** Every ordering this function can be asked for. */
  const EVERY_SORT = [
    undefined,
    { field: "licensePlate" as const, direction: "asc" as const },
    { field: "licensePlate" as const, direction: "desc" as const },
    { field: "startTime" as const, direction: "asc" as const },
    { field: "startTime" as const, direction: "desc" as const },
    { field: "endTime" as const, direction: "asc" as const },
    { field: "endTime" as const, direction: "desc" as const },
  ];

  describe("the shape of the order", () => {
    /** Truck by truck, which is how the list has always read. */
    it("defaults to date, plate, start time, id", () => {
      expect(buildOrderBy(undefined)).toEqual([
        { planningDate: "desc" },
        { vehicle: { licensePlate: "asc" } },
        { startTime: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ]);
    });

    /** The default is the plate, stated once and shared with the frontend. */
    it("names the plate as the default field", () => {
      expect(DEFAULT_TRIP_SORT_FIELD).toBe("licensePlate");
    });

    /** Chronological: the time first, the plate breaking ties beneath it. */
    it("puts the time first when a time is chosen", () => {
      expect(buildOrderBy({ field: "startTime", direction: "asc" })).toEqual([
        { planningDate: "desc" },
        { startTime: { sort: "asc", nulls: "last" } },
        { vehicle: { licensePlate: "asc" } },
        { id: "asc" },
      ]);
    });

    it("uses the end time when that is chosen", () => {
      expect(buildOrderBy({ field: "endTime", direction: "desc" })).toEqual([
        { planningDate: "desc" },
        { endTime: { sort: "desc", nulls: "last" } },
        { vehicle: { licensePlate: "asc" } },
        { id: "asc" },
      ]);
    });

    it("always ends with a total order, so paging is stable", () => {
      for (const sort of EVERY_SORT) {
        expect(buildOrderBy(sort)[TIE_BREAK_KEY]).toEqual({ id: "asc" });
      }
    });

    it("always uses exactly four keys", () => {
      for (const sort of EVERY_SORT) {
        expect(buildOrderBy(sort)).toHaveLength(4);
      }
    });
  });

  /**
   * The Day, Week and Month views are built from date sections. Sorting
   * globally by time would scatter one day's work across the whole period, so
   * the date stays the first key no matter what the operator chose.
   */
  describe("the date stays primary", () => {
    it("keeps the date first for every ordering", () => {
      for (const sort of EVERY_SORT) {
        expect(buildOrderBy(sort)[DATE_KEY]).toEqual({ planningDate: "desc" });
      }
    });

    it("never lets the chosen direction reach the date", () => {
      for (const sort of EVERY_SORT) {
        expect(buildOrderBy(sort)[DATE_KEY]).toEqual({ planningDate: "desc" });
      }
    });
  });

  /**
   * Grouping is achieved by ORDERING, never by a second query or a physical
   * grouping in the database: Trips on one truck simply become adjacent.
   */
  describe("sorting by licence plate", () => {
    it("groups by plate before it sorts by time", () => {
      const [, second, third] = buildOrderBy({
        field: "licensePlate",
        direction: "asc",
      });

      expect(Object.keys(second)).toEqual(["vehicle"]);
      expect(Object.keys(third)).toEqual(["startTime"]);
    });

    /**
     * By plate rather than by id: a UUID groups just as well but presents the
     * trucks in an order nobody recognises. Ascending also puts the Trips with
     * NO vehicle last, because Postgres sorts NULLs last in ASC — which is
     * exactly the wanted "unassigned at the bottom", and is the default.
     */
    it("orders the trucks by plate, which also puts unassigned Trips last", () => {
      expect(buildOrderBy({ field: "licensePlate", direction: "asc" })[1]).toEqual(
        { vehicle: { licensePlate: "asc" } },
      );
    });

    it("reverses the plates when asked", () => {
      expect(
        buildOrderBy({ field: "licensePlate", direction: "desc" })[1],
      ).toEqual({ vehicle: { licensePlate: "desc" } });
    });

    /**
     * A truck's own day always reads forwards. The direction the planner chose
     * belongs to the PLATE here; the time underneath is the tiebreaker, and
     * reversing it would present one truck's day backwards for no reason
     * anybody asked for.
     */
    it("keeps a truck's own Trips in forward time order whichever way the plates run", () => {
      for (const direction of ["asc", "desc"] as const) {
        expect(buildOrderBy({ field: "licensePlate", direction })[2]).toEqual({
          startTime: { sort: "asc", nulls: "last" },
        });
      }
    });
  });

  describe("sorting by a time", () => {
    it("sorts by start time when asked", () => {
      expect(buildOrderBy({ field: "startTime", direction: "asc" })[1]).toEqual({
        startTime: { sort: "asc", nulls: "last" },
      });
    });

    it("sorts by end time when asked", () => {
      expect(buildOrderBy({ field: "endTime", direction: "asc" })[1]).toEqual({
        endTime: { sort: "asc", nulls: "last" },
      });
    });

    it("reverses within the day when asked", () => {
      expect(buildOrderBy({ field: "startTime", direction: "desc" })[1]).toEqual(
        { startTime: { sort: "desc", nulls: "last" } },
      );
    });

    /**
     * The point of the whole change: a Trip that HAS a plate is ordered by its
     * time like any other. The plate no longer sits in front of the time and
     * can no longer prevent the day being read chronologically.
     */
    it("does not let the plate outrank the chosen time", () => {
      for (const field of ["startTime", "endTime"] as const) {
        const [, second, third] = buildOrderBy({ field, direction: "asc" });

        expect(Object.keys(second)).toEqual([field]);
        expect(Object.keys(third)).toEqual(["vehicle"]);
      }
    });

    /** The plate still keeps simultaneous Trips of one truck together. */
    it("keeps the plate as the tiebreaker beneath the time", () => {
      expect(buildOrderBy({ field: "startTime", direction: "desc" })[2]).toEqual(
        { vehicle: { licensePlate: "asc" } },
      );
    });

    /**
     * A Trip without a time is not early and not late — it is unknown. Pinning
     * nulls last in BOTH directions is the only reading that stays honest:
     * floating them to the top of a descending list would present them as the
     * latest work of the day.
     */
    it.each([
      ["startTime", "asc"],
      ["startTime", "desc"],
      ["endTime", "asc"],
      ["endTime", "desc"],
    ] as const)("keeps untimed Trips last for %s %s", (field, direction) => {
      const [, timeKey] = buildOrderBy({ field, direction });

      expect(Object.values(timeKey)[0]).toMatchObject({ nulls: "last" });
    });
  });

  /**
   * The status is not an ordering key and never was. A CLOSED Trip sorts by
   * exactly the same rules as an OPEN one — the list is filtered by status,
   * never ordered by it — so choosing a time orders finished work too.
   */
  it("orders by nothing but the date, the choice, the tiebreaker and the id", () => {
    for (const sort of EVERY_SORT) {
      const keys = buildOrderBy(sort).flatMap((entry) => Object.keys(entry));

      expect(keys).not.toContain("status");
      expect(keys).not.toContain("isPaid");
    }
  });
});
