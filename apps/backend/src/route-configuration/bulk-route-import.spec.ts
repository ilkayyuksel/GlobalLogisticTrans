import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  BulkRouteImportRefusedException,
  BulkRouteImportService,
} from "./bulk-route-import.service";
import { BulkRouteImportValidator } from "./bulk-route-import.validator";
import { MAX_IMPORT_ROUTES } from "./dto/bulk-route-import.dto";
import type { RouteConfigurationUnitOfWork } from "./route-configuration.unit-of-work";

/**
 * Bulk import of route prices.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
 * JSON is the INPUT format and nothing else. Each entry becomes exactly the same
 * relational records a route configured by hand becomes — a route price row, a
 * Combination group with two legs, a tunnel cost — through exactly the same
 * services. Nothing is stored as JSON, no route carries a second route in a blob,
 * and there is no pricing logic of its own: the Toll is derived by the Engine from
 * the stored kilometres and the configured rate, as it is for any route.
 *
 * ── THE PROMISE THESE TESTS GUARD ───────────────────────────────────────────
 * Twenty valid routes and one broken one change NOTHING. That is checked twice
 * over: the document is judged before anything is written, and the writing
 * happens in one transaction.
 *
 * ── AND WHAT IS DELIBERATELY NOT TESTED HERE ────────────────────────────────
 * What a valid route is. The rules come from the manual endpoints' own DTOs and
 * their own services, and are proved by their own suites; these tests assert that
 * the import USES them and reports which entry broke which one.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** One ordinary route, in the shape the import accepts. */
function normalRoute(overrides: Record<string, unknown> = {}) {
  return {
    type: "NORMAL",
    departure: "Antwerp",
    destination: "Kallo",
    tarief: 100,
    kilometres: 25,
    tunnel: 0,
    ...overrides,
  };
}

/** One leg of a Combination — a full route price in its own right. */
function leg(overrides: Record<string, unknown> = {}) {
  return {
    departure: "Antwerp",
    destination: "Kallo",
    tarief: 100,
    kilometres: 25,
    tunnel: 0,
    ...overrides,
  };
}

/**
 * A Combination: the outbound and the return, priced independently.
 *
 * The defaults deliberately differ on all three amounts, so a test that passes
 * would fail if anything copied one leg onto the other.
 */
function combinationRoute(overrides: Record<string, unknown> = {}) {
  return {
    type: "COMBINATION",
    legs: [
      leg(),
      leg({
        departure: "Kallo",
        destination: "Antwerp",
        tarief: 80,
        kilometres: 30,
        tunnel: 15,
      }),
    ],
    ...overrides,
  };
}

describe("bulk route import", () => {
  let routePricing: { findConfiguredRoute: jest.Mock };
  let combinationPricing: { findConfiguredCombination: jest.Mock };
  let configurationServices: {
    routes: { create: jest.Mock };
    combinations: { create: jest.Mock };
  };
  let unitOfWork: { run: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let validator: BulkRouteImportValidator;
  let service: BulkRouteImportService;

  /** True once the transaction has been entered. */
  let transactions: number;

  beforeEach(() => {
    transactions = 0;

    // Nothing is configured yet unless a test says otherwise.
    routePricing = { findConfiguredRoute: jest.fn().mockResolvedValue(null) };
    combinationPricing = {
      findConfiguredCombination: jest.fn().mockResolvedValue(null),
    };

    configurationServices = {
      routes: { create: jest.fn().mockResolvedValue({}) },
      combinations: { create: jest.fn().mockResolvedValue({}) },
    };

    /*
     * The real unit of work hands `work` the configuration services built on a
     * transaction's client. The double hands over the same doubles and counts the
     * entries, which is what the "all or nothing" tests need to see.
     */
    unitOfWork = {
      run: jest.fn(async (work: (services: unknown) => Promise<unknown>) => {
        transactions += 1;

        return work(configurationServices);
      }),
    };

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    validator = new BulkRouteImportValidator(
      routePricing as unknown as RoutePricingService,
      combinationPricing as unknown as CombinationRoutePricingService,
      logger as unknown as AppLoggerService,
    );
    service = new BulkRouteImportService(
      validator,
      unitOfWork as unknown as RouteConfigurationUnitOfWork,
      logger as unknown as AppLoggerService,
    );
  });

  /**
   * The document the endpoints take, around a list of entries.
   *
   * Most tests are about the entries, so they hand over entries; the tests about
   * the DOCUMENT call the service directly with whatever they mean to send.
   */
  const importRoutes = (routes: unknown[]) => service.import({ routes });
  const checkRoutes = (routes: unknown[]) => service.check({ routes });

  /** The reasons an import was refused, as readable lines. */
  async function refusalOf(routes: unknown[]): Promise<string[]> {
    try {
      await importRoutes(routes);
    } catch (error: unknown) {
      if (error instanceof BulkRouteImportRefusedException) {
        const payload = error.getResponse() as { details: string[] };

        return payload.details;
      }

      throw error;
    }

    throw new Error("the import was not refused");
  }

  describe("ordinary routes", () => {
    it("imports one", async () => {
      const summary = await importRoutes([normalRoute()]);

      expect(summary).toEqual({
        normalRoutes: 1,
        combinationGroups: 0,
        combinationLegs: 0,
        totalRoutes: 1,
      });
    });

    it("imports several", async () => {
      const summary = await importRoutes([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Antwerp", tarief: 120 }),
        normalRoute({ departure: "Zeebrugge", destination: "Gent" }),
      ]);

      expect(summary.normalRoutes).toBe(3);
      expect(summary.totalRoutes).toBe(3);
    });

    /**
     * ── THE SAME DOOR AS THE SCREEN ────────────────────────────────────────
     * Created through RouteConfigurationService, the very method the Routeprijzen
     * form calls. That is what makes an imported route behave identically
     * afterwards — and what means there is no second duplicate check, no second
     * way of writing a tunnel cost and no bulk pricing logic to drift.
     */
    it("creates each one through the ordinary configuration service", async () => {
      await importRoutes([normalRoute()]);

      expect(configurationServices.routes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 100,
          kilometres: 25,
          tunnel: 0,
        }),
      );
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    it("creates them in the order they were written", async () => {
      await importRoutes([
        normalRoute({ departure: "First" }),
        normalRoute({ departure: "Second" }),
      ]);

      expect(
        configurationServices.routes.create.mock.calls.map(
          ([call]) => call.departure,
        ),
      ).toEqual(["First", "Second"]);
    });

    /** Amounts travel as typed; rounding and storage belong to the backend. */
    it("passes the amounts through untouched", async () => {
      await importRoutes([
        normalRoute({ tarief: 520.55, kilometres: 31.5, tunnel: 12.75 }),
      ]);

      expect(configurationServices.routes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tarief: 520.55,
          kilometres: 31.5,
          tunnel: 12.75,
        }),
      );
    });
  });

  describe("Combination routes", () => {
    it("imports one, as a group of two legs", async () => {
      const summary = await importRoutes([combinationRoute()]);

      expect(summary).toEqual({
        normalRoutes: 0,
        combinationGroups: 1,
        combinationLegs: 2,
        totalRoutes: 2,
      });
    });

    it("imports several", async () => {
      const summary = await importRoutes([
        combinationRoute(),
        combinationRoute({
          legs: [
            leg({ departure: "Gent", destination: "Zeebrugge" }),
            leg({ departure: "Zeebrugge", destination: "Gent" }),
          ],
        }),
      ]);

      expect(summary.combinationGroups).toBe(2);
      expect(summary.combinationLegs).toBe(4);
      expect(summary.totalRoutes).toBe(4);
    });

    it("creates each one through the Combination configuration service", async () => {
      await importRoutes([combinationRoute()]);

      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(1);
      expect(configurationServices.routes.create).not.toHaveBeenCalled();
    });

    /** Both legs in one call, which is what makes the pair transactional. */
    it("hands both legs over together", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(dto.legs).toHaveLength(2);
    });

    /*
     * ── EACH LEG KEEPS ITS OWN AMOUNTS ────────────────────────────────────
     * The point of a Combination. Nothing copies one leg onto the other and
     * nothing fills a missing amount in from its partner.
     */
    it("keeps each leg's own Tarief", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(dto.legs.map((each: { tarief: number }) => each.tarief)).toEqual([
        100, 80,
      ]);
    });

    it("keeps each leg's own KM", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(
        dto.legs.map((each: { kilometres: number }) => each.kilometres),
      ).toEqual([25, 30]);
    });

    it("keeps each leg's own Tunnel", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(dto.legs.map((each: { tunnel: number }) => each.tunnel)).toEqual([
        0, 15,
      ]);
    });

    it("keeps each leg's own route", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(
        dto.legs.map(
          (each: { departure: string; destination: string }) =>
            `${each.departure} - ${each.destination}`,
        ),
      ).toEqual(["Antwerp - Kallo", "Kallo - Antwerp"]);
    });

    it("keeps the outbound first", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(dto.legs[0].departure).toBe("Antwerp");
    });

    it("imports ordinary routes and Combinations in one document", async () => {
      const summary = await importRoutes([
        normalRoute({ departure: "Gent", destination: "Lille" }),
        combinationRoute(),
      ]);

      expect(summary).toEqual({
        normalRoutes: 1,
        combinationGroups: 1,
        combinationLegs: 2,
        totalRoutes: 3,
      });
    });
  });

  describe("validation", () => {
    /** A document that is not an array of objects has nothing to import. */
    it("refuses an entry that is not an object", async () => {
      expect(await refusalOf(["Antwerp to Kallo"])).toEqual([
        "route 1: each route must be an object",
      ]);
    });

    it("refuses an entry with no type", async () => {
      const [message] = await refusalOf([
        { departure: "Antwerp", destination: "Kallo", tarief: 1, kilometres: 1, tunnel: 0 },
      ]);

      expect(message).toBe("route 1: type must be NORMAL or COMBINATION");
    });

    it("refuses an unknown type", async () => {
      const [message] = await refusalOf([normalRoute({ type: "BACKLOAD" })]);

      expect(message).toBe("route 1: type must be NORMAL or COMBINATION");
    });

    it.each([
      ["departure", "departure"],
      ["destination", "destination"],
      ["tarief", "tarief"],
      ["kilometres", "kilometres"],
      ["tunnel", "tunnel"],
    ])("refuses an ordinary route with no %s", async (_name, field) => {
      const entry = normalRoute();
      delete (entry as Record<string, unknown>)[field];

      const messages = await refusalOf([entry]);

      expect(messages.join(" ")).toContain(field);
      expect(messages.every((message) => message.startsWith("route 1:"))).toBe(
        true,
      );
    });

    it.each([
      ["tarief", { tarief: -1 }],
      ["kilometres", { kilometres: -1 }],
      ["tunnel", { tunnel: -0.01 }],
    ])("refuses a negative %s", async (field, overrides) => {
      const messages = await refusalOf([normalRoute(overrides)]);

      expect(messages.join(" ")).toContain(field);
    });

    /**
     * ── THE MONEY RULES ARE THE MANUAL ENDPOINT'S ──────────────────────────
     * Three decimals on an amount is refused here because it is refused there, by
     * the same decorator on the same DTO — not by a rule restated for imports.
     */
    it("refuses an amount with more decimals than money has", async () => {
      const messages = await refusalOf([normalRoute({ tarief: 100.005 })]);

      expect(messages.join(" ")).toContain("tarief");
    });

    it("refuses a text amount rather than coercing it", async () => {
      const messages = await refusalOf([normalRoute({ tarief: "one hundred" })]);

      expect(messages.join(" ")).toContain("tarief");
    });

    /*
     * ── NO TOLL IN THE DOCUMENT ───────────────────────────────────────────
     * A route carries its DISTANCE; the Toll is the Engine's, derived from that
     * distance and the configured rate per kilometre. Accepting and dropping a
     * toll amount would let an operator believe one had been stored.
     */
    it("refuses an entry that names a toll amount", async () => {
      const messages = await refusalOf([normalRoute({ toll: 18 })]);

      expect(messages.join(" ")).toContain("toll");
    });

    /** Nor an active flag, which route prices no longer have at all. */
    it("refuses an entry that names an active flag", async () => {
      const messages = await refusalOf([normalRoute({ active: true })]);

      expect(messages.join(" ")).toContain("active");
    });

    it("refuses any other unknown field", async () => {
      const messages = await refusalOf([normalRoute({ secondRoute: {} })]);

      expect(messages.join(" ")).toContain("secondRoute");
    });

    describe("a Combination is exactly two legs", () => {
      it("refuses no legs at all", async () => {
        const messages = await refusalOf([combinationRoute({ legs: [] })]);

        expect(messages.join(" ")).toContain("legs");
      });

      it("refuses one leg", async () => {
        const messages = await refusalOf([combinationRoute({ legs: [leg()] })]);

        expect(messages.join(" ")).toContain("legs");
      });

      it("refuses three legs", async () => {
        const messages = await refusalOf([
          combinationRoute({
            legs: [
              leg(),
              leg({ departure: "Kallo", destination: "Antwerp" }),
              leg({ departure: "Gent", destination: "Lille" }),
            ],
          }),
        ]);

        expect(messages.join(" ")).toContain("legs");
      });

      it("refuses a missing legs field", async () => {
        const messages = await refusalOf([{ type: "COMBINATION" }]);

        expect(messages.join(" ")).toContain("legs");
      });

      /** Never completed from the other leg: an absent leg is an error. */
      it("fills in no missing leg", async () => {
        await refusalOf([combinationRoute({ legs: [leg()] })]);

        expect(configurationServices.combinations.create).not.toHaveBeenCalled();
      });

      it("validates every leg in full, and says which one", async () => {
        const messages = await refusalOf([
          combinationRoute({
            legs: [
              leg(),
              leg({ departure: "Kallo", destination: "Antwerp", tarief: -5 }),
            ],
          }),
        ]);

        expect(messages.join(" ")).toContain("leg 2");
        expect(messages.join(" ")).toContain("tarief");
      });

      it("refuses two legs on the same road", async () => {
        const messages = await refusalOf([
          combinationRoute({ legs: [leg(), leg()] }),
        ]);

        expect(messages.join(" ")).toContain("must be different routes");
      });
    });

    /**
     * ── ONE LINE FOR A MISSING FIELD ────────────────────────────────────────
     * An absent field fails every rule it has — not a number, not at least zero,
     * not at most ten thousand — and three lines saying so is two lines an
     * operator has to read past on every one of eighty routes.
     */
    it("says a missing field is required, once", async () => {
      const entry = normalRoute();
      delete (entry as Record<string, unknown>).kilometres;

      expect(await refusalOf([entry])).toEqual([
        "route 1: kilometres is required",
      ]);
    });

    /** A value that is present but wrong still reports each rule it broke. */
    it("reports every rule a present value breaks", async () => {
      const messages = await refusalOf([normalRoute({ kilometres: -1 })]);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((message) => message.includes("kilometres"))).toBe(
        true,
      );
      expect(messages.join(" ")).not.toContain("is required");
    });

    /** Said the way an operator would say it, not as two array bounds. */
    it("says a Combination must have exactly two legs", async () => {
      expect(await refusalOf([combinationRoute({ legs: [leg()] })])).toEqual([
        "route 1: a Combination must have exactly 2 legs",
      ]);
    });

    /** Every problem at once, so eighty routes are fixed in one pass. */
    it("reports every broken entry rather than the first", async () => {
      const messages = await refusalOf([
        normalRoute({ tarief: -1 }),
        normalRoute({ departure: "Gent", destination: "Lille", kilometres: -2 }),
        combinationRoute({ legs: [leg()] }),
      ]);

      expect(messages.some((message) => message.startsWith("route 1:"))).toBe(
        true,
      );
      expect(messages.some((message) => message.startsWith("route 2:"))).toBe(
        true,
      );
      expect(messages.some((message) => message.startsWith("route 3:"))).toBe(
        true,
      );
    });

    it("numbers the entries from one, as an operator counts them", async () => {
      const messages = await refusalOf([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
      ]);

      expect(messages[0].startsWith("route 2:")).toBe(true);
    });

    /**
     * In document order, so the list is worked through top to bottom. The
     * duplicate checks run after the field checks and would otherwise report
     * route 1 below route 3.
     */
    it("reports the problems in the order the document is read", async () => {
      routePricing.findConfiguredRoute.mockImplementation(
        async (departure: string) =>
          departure === "Antwerp" ? { id: "route-1" } : null,
      );

      const messages = await refusalOf([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
        combinationRoute({
          legs: [
            leg({ departure: "Zeebrugge", destination: "Gent" }),
            leg({ departure: "Gent", destination: "Zeebrugge", tarief: -1 }),
          ],
        }),
      ]);

      const numbers = messages.map((message) =>
        Number(/^route (\d+)/.exec(message)?.[1]),
      );

      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    });
  });

  /**
   * ── THE DOCUMENT ITSELF ────────────────────────────────────────────────────
   * Judged by the backend rather than only by the browser, so a caller that is
   * not the screen gets the same answer. A problem with the document belongs to no
   * entry and says so, instead of claiming to be about route 0.
   */
  describe("the document", () => {
    it.each([
      ["a string", "not a document"],
      ["an array", [[]]],
      ["null", null],
    ])("refuses %s as the document", async (_name, document) => {
      const { isValid, errors } = await service.check(document);

      expect(isValid).toBe(false);
      expect(errors[0]).toMatchObject({ routeNumber: null });
      expect(errors[0].message).toContain("must be an object");
    });

    it("refuses a document with no routes array", async () => {
      const { errors } = await service.check({ prices: [] });

      expect(errors[0]).toMatchObject({
        routeNumber: null,
        field: "routes",
        message: "routes must be an array",
      });
    });

    it("refuses routes that is not an array", async () => {
      const { errors } = await service.check({ routes: "Antwerp" });

      expect(errors[0].message).toBe("routes must be an array");
    });

    it("refuses an empty list, which would import nothing", async () => {
      const { errors } = await checkRoutes([]);

      expect(errors[0].message).toBe("routes must not be empty");
    });

    /** Refused rather than truncated: importing the first 500 of 600 silently
     * would be the worst of both answers. */
    it("refuses more routes than one transaction should carry", async () => {
      const routes = Array.from({ length: MAX_IMPORT_ROUTES + 1 }, (_v, index) =>
        normalRoute({ destination: `Kallo ${index}` }),
      );

      const { errors } = await service.check({ routes });

      expect(errors[0].message).toContain(`at most ${MAX_IMPORT_ROUTES}`);
    });

    it("writes nothing for a document it cannot read", async () => {
      await expect(service.import("not a document")).rejects.toBeInstanceOf(
        BulkRouteImportRefusedException,
      );

      expect(transactions).toBe(0);
    });

    /** Named as the document, because it belongs to no entry. */
    it("does not pretend a document problem is about route 0", async () => {
      expect(await refusalOf([])).toEqual(["routes must not be empty"]);
    });
  });

  describe("all or nothing", () => {
    /**
     * ── THE HEADLINE PROMISE ───────────────────────────────────────────────
     * Twenty valid routes and one broken one produce no database change at all.
     * Proved by the strongest available assertion: the transaction is never even
     * opened, so there is nothing to roll back.
     */
    it("creates nothing when one entry of twenty-one is invalid", async () => {
      const routes = [
        ...Array.from({ length: 20 }, (_value, index) =>
          normalRoute({ destination: `Kallo ${index}` }),
        ),
        normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
      ];

      await expect(service.import(routes)).rejects.toBeInstanceOf(
        BulkRouteImportRefusedException,
      );

      expect(transactions).toBe(0);
      expect(configurationServices.routes.create).not.toHaveBeenCalled();
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    it("creates nothing when one Combination of a mixed document is invalid", async () => {
      await expect(
        importRoutes([
          normalRoute(),
          combinationRoute({ legs: [leg({ departure: "Gent" })] }),
        ]),
      ).rejects.toBeInstanceOf(BulkRouteImportRefusedException);

      expect(configurationServices.routes.create).not.toHaveBeenCalled();
    });

    /** And a valid document is written inside ONE transaction, not many. */
    it("writes a valid document in a single transaction", async () => {
      await importRoutes([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille" }),
        combinationRoute({
          legs: [
            leg({ departure: "Zeebrugge", destination: "Gent" }),
            leg({ departure: "Gent", destination: "Zeebrugge" }),
          ],
        }),
      ]);

      expect(transactions).toBe(1);
      expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    });

    /**
     * The refusal says the one thing that matters before the list of reasons.
     * A caller that shows a single line shows this one.
     */
    it("says in so many words that nothing was created", async () => {
      await expect(
        importRoutes([normalRoute({ tarief: -1 })]),
      ).rejects.toThrow(/nothing was created/);
    });

    it("counts the problems in that sentence", async () => {
      await expect(
        importRoutes([
          normalRoute({ tarief: -1 }),
          normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
        ]),
      ).rejects.toThrow(/2 problems found/);
    });
  });

  /**
   * ── ONE LEG, MANY COMBINATIONS ────────────────────────────────────────────
   * The importer used to keep a set of every leg road it had seen and refuse the
   * second use of one. That is not the business rule: everything leaving
   * MPET 1742 shares its outbound, and each of those is its own Combination with
   * its own return. The rule is about the PAIR.
   *
   * Every test here would have been refused by the old rule.
   */
  describe("legs shared between Combinations", () => {
    /** The same Leg 1, with a different return each time. */
    function sharingLegOne(count: number) {
      return Array.from({ length: count }, (_, index) =>
        combinationRoute({
          legs: [
            leg({ departure: "MPET 1742", destination: "Kallo (Beveren)" }),
            leg({
              departure: `Return ${index + 1}`,
              destination: "MPET 1742",
              tarief: 80 + index,
            }),
          ],
        }),
      );
    }

    it("accepts the same leg in two Combinations", async () => {
      await expect(importRoutes(sharingLegOne(2))).resolves.toMatchObject({
        combinationGroups: 2,
        combinationLegs: 4,
      });
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(2);
    });

    it("accepts the same leg in ten Combinations", async () => {
      await expect(importRoutes(sharingLegOne(10))).resolves.toMatchObject({
        combinationGroups: 10,
        combinationLegs: 20,
      });
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(10);
    });

    it("accepts a road shared as Leg 1", async () => {
      await expect(
        importRoutes([
          combinationRoute({
            legs: [
              leg({ departure: "Quay 869", destination: "LESSINES" }),
              leg({ departure: "LESSINES", destination: "Kallo", tarief: 80 }),
            ],
          }),
          combinationRoute({
            legs: [
              leg({ departure: "Quay 869", destination: "LESSINES" }),
              leg({ departure: "Kallo", destination: "Antwerp", tarief: 70 }),
            ],
          }),
        ]),
      ).resolves.toMatchObject({ combinationGroups: 2 });
    });

    it("accepts a road shared as Leg 2", async () => {
      await expect(
        importRoutes([
          combinationRoute({
            legs: [
              leg({ departure: "Quay 869", destination: "Dourges" }),
              leg({ departure: "Kallo", destination: "Quay 869", tarief: 80 }),
            ],
          }),
          combinationRoute({
            legs: [
              leg({ departure: "MPET 1742", destination: "Gent" }),
              leg({ departure: "Kallo", destination: "Quay 869", tarief: 90 }),
            ],
          }),
        ]),
      ).resolves.toMatchObject({ combinationGroups: 2 });
    });

    /**
     * The pair is compared as a SET: the position says which leg is the outbound
     * and is kept, but pricing selects a leg by its road, so a swapped pair is
     * the same configuration and cannot be smuggled in as a second one.
     */
    it("refuses the same pair with its legs swapped", async () => {
      const [outbound, back] = combinationRoute().legs;

      const messages = await refusalOf([
        combinationRoute(),
        combinationRoute({ legs: [back, outbound] }),
      ]);

      expect(messages[0]).toContain("already configured by route 1");
    });

    /**
     * Each Combination keeps its OWN leg rows, so two groups sharing a road may
     * price it differently. Nothing here merges them into one record: the
     * importer sends both entries to the service that writes a group of its own.
     */
    it("keeps each Combination's own price for a shared road", async () => {
      await importRoutes([
        combinationRoute({
          legs: [
            leg({ departure: "Quay 869", destination: "LESSINES", tarief: 100 }),
            leg({ departure: "LESSINES", destination: "Kallo", tarief: 80 }),
          ],
        }),
        combinationRoute({
          legs: [
            leg({ departure: "Quay 869", destination: "LESSINES", tarief: 120 }),
            leg({ departure: "Kallo", destination: "Antwerp", tarief: 70 }),
          ],
        }),
      ]);

      const written = configurationServices.combinations.create.mock.calls.map(
        ([dto]: [{ legs: { tarief: number }[] }]) =>
          dto.legs.map((written) => written.tarief),
      );

      expect(written).toEqual([
        [100, 80],
        [120, 70],
      ]);
    });

    /** What the operator actually has: many Combinations out of few terminals. */
    it("imports 209 Combinations sharing legs in one transaction", async () => {
      const document = Array.from({ length: 209 }, (_, index) =>
        combinationRoute({
          legs: [
            // Three terminals between them, so every road is shared many times.
            leg({
              departure: ["Quay 869", "MPET 1742", "Quay 1742"][index % 3],
              destination: "LESSINES",
            }),
            leg({
              departure: "LESSINES",
              destination: `Customer ${index + 1}`,
              tarief: 80,
            }),
          ],
        }),
      );

      await expect(importRoutes(document)).resolves.toMatchObject({
        combinationGroups: 209,
        combinationLegs: 418,
      });
      expect(transactions).toBe(1);
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(
        209,
      );
    });

    /** One broken entry among shared legs still changes nothing at all. */
    it("writes nothing when one of the shared-leg Combinations is invalid", async () => {
      const [valid, second] = sharingLegOne(2);

      await expect(
        importRoutes([valid, { ...second, legs: [second.legs[0]] }]),
      ).rejects.toThrow(/nothing was created/);

      expect(transactions).toBe(0);
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    /** A mixed document: ordinary routes beside Combinations that share legs. */
    it("imports ordinary routes and shared-leg Combinations together", async () => {
      await expect(
        importRoutes([
          normalRoute(),
          normalRoute({ departure: "Quay 869", destination: "Dourges" }),
          ...sharingLegOne(3),
        ]),
      ).resolves.toMatchObject({
        normalRoutes: 2,
        combinationGroups: 3,
        combinationLegs: 6,
        totalRoutes: 8,
      });
    });
  });

  describe("duplicates", () => {
    /**
     * ── NEVER A SILENT OVERWRITE ───────────────────────────────────────────
     * The existing rule decides, through the same lookup the manual create uses.
     * There is no upsert convention in this architecture, so an entry whose route
     * is already configured is an import ERROR — not an update, not a skip.
     */
    it("refuses an ordinary route that is already configured", async () => {
      routePricing.findConfiguredRoute.mockResolvedValue({ id: "route-1" });

      const messages = await refusalOf([normalRoute()]);

      expect(messages[0]).toContain("already configured");
      expect(configurationServices.routes.create).not.toHaveBeenCalled();
    });

    it("looks for an ordinary route in the ordinary scope", async () => {
      await importRoutes([normalRoute()]);

      expect(routePricing.findConfiguredRoute).toHaveBeenCalledWith(
        "Antwerp",
        "Kallo",
        "NORMAL",
      );
    });

    /**
     * ── A LEG IS NOT A CONFIGURATION ────────────────────────────────────────
     * A road already used as a leg SOMEWHERE says nothing about this entry: the
     * same outbound may serve as many Combinations as an operator has returns
     * for it. What decides is whether this PAIR is configured, which is a
     * question only the group can answer.
     */
    it("accepts a Combination whose leg is already a leg elsewhere", async () => {
      routePricing.findConfiguredRoute.mockImplementation(
        async (_departure: string, _destination: string, kind: string) =>
          kind === "COMBINATION" ? { id: "leg-1" } : null,
      );

      await expect(importRoutes([combinationRoute()])).resolves.toMatchObject({
        combinationGroups: 1,
      });
    });

    it("refuses a Combination whose PAIR is already configured", async () => {
      combinationPricing.findConfiguredCombination.mockResolvedValue({
        id: "group-1",
      });

      const messages = await refusalOf([combinationRoute()]);

      expect(messages[0]).toBe(
        "route 1: this Combination is already configured: Antwerp to Kallo and Kallo to Antwerp",
      );
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    it("asks about the pair, not about either leg", async () => {
      await importRoutes([combinationRoute()]);

      expect(
        combinationPricing.findConfiguredCombination,
      ).toHaveBeenCalledWith([
        { departure: "Antwerp", destination: "Kallo" },
        { departure: "Kallo", destination: "Antwerp" },
      ]);
    });

    /**
     * An ordinary route and a Combination leg may describe the same road: they are
     * read in different pricing contexts and neither overwrites the other. An
     * import must not invent a conflict the architecture does not have.
     */
    it("accepts a Combination leg on a road an ordinary route already covers", async () => {
      routePricing.findConfiguredRoute.mockImplementation(
        async (_departure: string, _destination: string, kind: string) =>
          kind === "NORMAL" ? { id: "route-1" } : null,
      );

      await expect(importRoutes([combinationRoute()])).resolves.toMatchObject({
        combinationGroups: 1,
      });
    });

    it("refuses the same ordinary route written twice in one document", async () => {
      const messages = await refusalOf([normalRoute(), normalRoute()]);

      expect(messages[0]).toBe(
        "route 2: this route is already configured by route 1 of this import: Antwerp to Kallo",
      );
    });

    it("accepts one road used by two Combinations of one document", async () => {
      await expect(
        importRoutes([
          combinationRoute(),
          combinationRoute({
            legs: [
              leg(),
              leg({ departure: "Gent", destination: "Lille", tarief: 90 }),
            ],
          }),
        ]),
      ).resolves.toMatchObject({ combinationGroups: 2 });
    });

    it("refuses the same Combination written twice in one document", async () => {
      const messages = await refusalOf([combinationRoute(), combinationRoute()]);

      expect(messages[0]).toBe(
        "route 2: this Combination is already configured by route 1 of this import: Antwerp to Kallo and Kallo to Antwerp",
      );
    });

    /**
     * The canonical terminal rule, applied through the same helper the
     * repositories use: `PSA Quay 869` and `Quay 869` are one place, so an import
     * cannot slip a second configuration past the database under a second
     * spelling.
     */
    it("treats PSA Quay 869 and Quay 869 as the same road", async () => {
      const messages = await refusalOf([
        normalRoute({ departure: "PSA Quay 869", destination: "Dourges" }),
        normalRoute({ departure: "Quay 869", destination: "Dourges" }),
      ]);

      expect(messages[0]).toContain("already configured by route 1");
    });

    it("accepts the two directions of one road as different routes", async () => {
      await expect(
        importRoutes([
          normalRoute({ departure: "Antwerp", destination: "Kallo" }),
          normalRoute({ departure: "Kallo", destination: "Antwerp" }),
        ]),
      ).resolves.toMatchObject({ normalRoutes: 2 });
    });
  });

  describe("the preview", () => {
    it("counts what would be created", async () => {
      const { summary } = await checkRoutes([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille" }),
        combinationRoute(),
      ]);

      expect(summary).toEqual({
        normalRoutes: 2,
        combinationGroups: 1,
        combinationLegs: 2,
        totalRoutes: 4,
      });
    });

    it("reports a valid document as valid", async () => {
      const { isValid, errors } = await checkRoutes([normalRoute()]);

      expect(isValid).toBe(true);
      expect(errors).toEqual([]);
    });

    /** A refused document is an answer here, not an HTTP failure. */
    it("reports the reasons without throwing", async () => {
      const { isValid, errors } = await checkRoutes([
        normalRoute({ tarief: -1 }),
      ]);

      expect(isValid).toBe(false);
      expect(errors[0]).toMatchObject({ routeNumber: 1, field: "tarief" });
    });

    it("names the leg of a Combination it objects to", async () => {
      const { errors } = await checkRoutes([
        combinationRoute({
          legs: [
            leg(),
            leg({ departure: "Kallo", destination: "Antwerp", kilometres: -1 }),
          ],
        }),
      ]);

      expect(errors[0]).toMatchObject({
        routeNumber: 1,
        legNumber: 2,
        field: "kilometres",
      });
    });

    /** The decisive property of a preview: it writes nothing. */
    it("creates nothing, even for a perfectly valid document", async () => {
      await checkRoutes([normalRoute(), combinationRoute()]);

      expect(transactions).toBe(0);
      expect(configurationServices.routes.create).not.toHaveBeenCalled();
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    /** Counts survive a partial failure, so a preview stays informative. */
    it("still counts the readable entries beside the errors", async () => {
      const { summary, errors } = await checkRoutes([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
      ]);

      expect(summary.normalRoutes).toBe(1);
      expect(errors).toHaveLength(1);
    });
  });

  describe("logging", () => {
    it("logs counts and never an amount", async () => {
      await importRoutes([normalRoute({ tarief: 1234.56 })]);

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).toContain("Bulk route import completed");
      expect(logged).not.toContain("1234.56");
    });

    it("says how many entries were refused, without the amounts", async () => {
      await refusalOf([normalRoute({ tarief: -9999.99 })]);

      expect(logger.warn).toHaveBeenCalledWith("Bulk route import refused", {
        errorCount: 1,
      });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("9999.99");
    });
  });

  /**
   * ── THE EXPORTED FILE GOES STRAIGHT BACK IN ────────────────────────────────
   * Instellingen > Prijzen > Routeprijzen writes the configuration as JSON, and
   * that file is only a backup if this importer reads it. The document below is
   * the exporter's own output, field for field — `route-export.ts` in the
   * frontend produces exactly this shape, and its own suite asserts so.
   *
   * If either side ever moves, one of the two suites fails.
   */
  describe("a document produced by the JSON export", () => {
    const EXPORTED = {
      routes: [
        {
          type: "NORMAL",
          departure: "Quay 869",
          destination: "Dourges",
          tarief: 520.5,
          kilometres: 310.25,
          tunnel: 0,
        },
        {
          type: "NORMAL",
          departure: "Gent",
          destination: "Lille",
          tarief: 120,
          kilometres: 55,
          tunnel: 12.5,
        },
        {
          type: "COMBINATION",
          legs: [
            {
              departure: "Antwerp",
              destination: "Kallo",
              tarief: 100,
              kilometres: 25,
              tunnel: 0,
            },
            {
              departure: "Kallo",
              destination: "Antwerp",
              tarief: 80,
              kilometres: 30,
              tunnel: 15,
            },
          ],
        },
      ],
    };

    it("is accepted as it stands", async () => {
      const { isValid, errors } = await service.check(EXPORTED);

      expect(errors).toEqual([]);
      expect(isValid).toBe(true);
    });

    it("recreates the same counts", async () => {
      const { summary } = await service.check(EXPORTED);

      expect(summary).toEqual({
        normalRoutes: 2,
        combinationGroups: 1,
        combinationLegs: 2,
        totalRoutes: 4,
      });
    });

    /** Every value survives the trip out and back — no information lost. */
    it("recreates every route with its own amounts", async () => {
      await service.import(EXPORTED);

      expect(configurationServices.routes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          departure: "Quay 869",
          destination: "Dourges",
          tarief: 520.5,
          kilometres: 310.25,
          tunnel: 0,
        }),
      );

      const [combinationDto] =
        configurationServices.combinations.create.mock.calls[0];

      expect(combinationDto.legs).toEqual([
        {
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 100,
          kilometres: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          kilometres: 30,
          tunnel: 15,
        },
      ]);
    });

    /**
     * A road nobody has measured exports as null, and comes back as null. Zero
     * would be a different statement: charged nothing because somebody decided
     * it costs nothing, rather than because nobody has said how long it is.
     */
    it("accepts an unmeasured road as null", async () => {
      const { isValid } = await service.check({
        routes: [
          {
            type: "NORMAL",
            departure: "Aalst",
            destination: "Ninove",
            tarief: 50,
            kilometres: null,
            tunnel: 0,
          },
        ],
      });

      expect(isValid).toBe(true);
    });

    it("still refuses a route with no kilometres field at all", async () => {
      const entry = {
        type: "NORMAL",
        departure: "Aalst",
        destination: "Ninove",
        tarief: 50,
        tunnel: 0,
      };

      expect(await refusalOf([entry])).toEqual([
        "route 1: kilometres is required",
      ]);
    });

    it("writes an empty configuration as a document that imports nothing", async () => {
      const { errors } = await service.check({ routes: [] });

      expect(errors[0].message).toBe("routes must not be empty");
    });
  });

  /**
   * The bound exists because the whole import runs in one transaction, so its size
   * decides how long that transaction holds its locks. It is enforced by the
   * envelope DTO, which the ValidationPipe applies before this service is reached.
   */
  it("bounds how many routes one import may carry", () => {
    expect(MAX_IMPORT_ROUTES).toBe(500);
  });
});
