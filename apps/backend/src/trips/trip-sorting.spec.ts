import { buildOrderBy } from "./trip.repository";

/**
 * The order a planning list is read in.
 *
 * These assert the SHAPE of the order Prisma is given, which is what decides
 * both what the page shows and which Trips land on which page. The rules they
 * pin down are operational, not cosmetic:
 *
 *   - a day is the unit of planning, so the date can never stop being first;
 *   - one truck's work reads as a block;
 *   - a Trip with no time is unknown, not early;
 *   - the order is total, so paging cannot repeat or drop a row.
 */
describe("buildOrderBy", () => {
  const DATE_KEY = 0;
  const VEHICLE_KEY = 1;
  const TIME_KEY = 2;
  const TIE_BREAK_KEY = 3;

  describe("the shape of the order", () => {
    it("orders by date, then vehicle, then time, then id", () => {
      expect(buildOrderBy(undefined)).toEqual([
        { planningDate: "desc" },
        { vehicle: { licensePlate: "asc" } },
        { startTime: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ]);
    });

    it("always ends with a total order, so paging is stable", () => {
      for (const sort of [
        undefined,
        { field: "startTime" as const, direction: "asc" as const },
        { field: "startTime" as const, direction: "desc" as const },
        { field: "endTime" as const, direction: "asc" as const },
        { field: "endTime" as const, direction: "desc" as const },
      ]) {
        expect(buildOrderBy(sort)[TIE_BREAK_KEY]).toEqual({ id: "asc" });
      }
    });
  });

  /**
   * The Day, Week and Month views are built from date sections. Sorting
   * globally by time would scatter one day's work across the whole period, so
   * the date stays the first key no matter what the operator chose.
   */
  describe("the date stays primary", () => {
    it.each([
      ["startTime", "asc"],
      ["startTime", "desc"],
      ["endTime", "asc"],
      ["endTime", "desc"],
    ] as const)("keeps the date first when sorting by %s %s", (field, direction) => {
      const order = buildOrderBy({ field, direction });

      expect(order[DATE_KEY]).toEqual({ planningDate: "desc" });
    });

    it("never lets the chosen direction reach the date", () => {
      const order = buildOrderBy({ field: "startTime", direction: "desc" });

      expect(order[DATE_KEY]).toEqual({ planningDate: "desc" });
    });
  });

  /**
   * Grouping is achieved by ORDERING, never by a second query or a physical
   * grouping in the database: Trips on one truck simply become adjacent.
   */
  describe("grouping by vehicle", () => {
    it.each([
      ["startTime", "asc"],
      ["startTime", "desc"],
      ["endTime", "asc"],
      ["endTime", "desc"],
    ] as const)("keeps one truck together when sorting by %s %s", (field, direction) => {
      const order = buildOrderBy({ field, direction });

      expect(order[VEHICLE_KEY]).toEqual({ vehicle: { licensePlate: "asc" } });
    });

    /**
     * By plate rather than by id: a UUID groups just as well but presents the
     * trucks in an order nobody recognises. Ascending also puts the Trips with
     * no vehicle last, because Postgres sorts NULLs last in ASC.
     */
    it("orders the trucks by plate, which also puts unassigned Trips last", () => {
      const [, vehicleKey] = buildOrderBy(undefined);

      expect(vehicleKey).toEqual({ vehicle: { licensePlate: "asc" } });
    });

    it("groups by vehicle before it sorts by time", () => {
      const order = buildOrderBy({ field: "startTime", direction: "asc" });

      expect(Object.keys(order[VEHICLE_KEY])).toEqual(["vehicle"]);
      expect(Object.keys(order[TIME_KEY])).toEqual(["startTime"]);
    });
  });

  describe("the chosen time", () => {
    it("sorts by start time when asked", () => {
      expect(buildOrderBy({ field: "startTime", direction: "asc" })[TIME_KEY]).toEqual(
        { startTime: { sort: "asc", nulls: "last" } },
      );
    });

    it("sorts by end time when asked", () => {
      expect(buildOrderBy({ field: "endTime", direction: "asc" })[TIME_KEY]).toEqual({
        endTime: { sort: "asc", nulls: "last" },
      });
    });

    it("reverses within the day when asked", () => {
      expect(buildOrderBy({ field: "startTime", direction: "desc" })[TIME_KEY]).toEqual(
        { startTime: { sort: "desc", nulls: "last" } },
      );
    });

    it("defaults to ascending start time", () => {
      expect(buildOrderBy(undefined)[TIME_KEY]).toEqual({
        startTime: { sort: "asc", nulls: "last" },
      });
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
      const [, , timeKey] = buildOrderBy({ field, direction });

      expect(Object.values(timeKey)[0]).toMatchObject({ nulls: "last" });
    });
  });
});
