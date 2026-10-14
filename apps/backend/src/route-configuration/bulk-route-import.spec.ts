import { AppLoggerService } from "../logger/app-logger.service";
import { DuplicateActiveRouteException } from "../route-pricing/exceptions/route-pricing.exceptions";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  BulkRouteImportRefusedException,
  BulkRouteImportService,
  describeImportProblem,
} from "./bulk-route-import.service";
import { byEntry } from "./bulk-route-import.entries";
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
 * and there is no pricing logic of its own: the Toll and the Tunnel are stored
 * as the amounts given, as they are for any route.
 *
 * ── THE PROMISE THESE TESTS GUARD ───────────────────────────────────────────
 * Twenty valid routes and one broken one: the twenty are imported and the broken
 * one is SKIPPED, with its number and every reason. No rule is relaxed for it.
 * Each entry is written in its own transaction, so a Combination is never half
 * saved. Only a document that cannot be read refuses everything.
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
    toll: 25,
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
    toll: 25,
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
        toll: 30,
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
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };
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

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

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
  const importResult = (routes: unknown[]) => service.import({ routes });
  /** What an import created. */
  const importRoutes = async (routes: unknown[]) => (await importResult(routes)).imported;
  const checkRoutes = (routes: unknown[]) => service.check({ routes });

  /**
   * Why an import did not take entries, as readable lines: the document's own
   * refusal, or the reasons of every skipped entry in document order.
   */
  async function refusalOf(routes: unknown[]): Promise<string[]> {
    try {
      const { skipped } = await importResult(routes);
      const lines = skipped.flatMap((entry) => entry.reasons).sort(byEntry).map(describeImportProblem);

      if (lines.length === 0) {
        throw new Error("nothing was skipped");
      }

      return lines;
    } catch (error: unknown) {
      if (error instanceof BulkRouteImportRefusedException) {
        const payload = error.getResponse() as { details: string[] };

        return payload.details;
      }

      throw error;
    }
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
          toll: 25,
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
        normalRoute({ tarief: 520.55, toll: 31.5, tunnel: 12.75 }),
      ]);

      expect(configurationServices.routes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tarief: 520.55,
          toll: 31.5,
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

    it("keeps each leg's own Toll", async () => {
      await importRoutes([combinationRoute()]);

      const [dto] = configurationServices.combinations.create.mock.calls[0];

      expect(
        dto.legs.map((each: { toll: number }) => each.toll),
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
        { departure: "Antwerp", destination: "Kallo", tarief: 1, toll: 1, tunnel: 0 },
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
      ["toll", "toll"],
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
      ["toll", { toll: -1 }],
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
     * ── NO DISTANCE IN THE DOCUMENT ───────────────────────────────────────
     * A route carries its Toll as an AMOUNT now. An older file still naming a
     * distance is refused rather than silently converted or dropped, so an
     * operator never believes a distance was used.
     */
    it("refuses an older entry that names a distance", async () => {
      const messages = await refusalOf([normalRoute({ kilometres: 18 })]);

      expect(messages.join(" ")).toContain("kilometres");
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
      delete (entry as Record<string, unknown>).toll;

      expect(await refusalOf([entry])).toEqual([
        "route 1: toll is required",
      ]);
    });

    /** A value that is present but wrong still reports each rule it broke. */
    it("reports every rule a present value breaks", async () => {
      const messages = await refusalOf([normalRoute({ toll: -1 })]);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((message) => message.includes("toll"))).toBe(
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
        normalRoute({ departure: "Gent", destination: "Lille", toll: -2 }),
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

  describe("skipping what is invalid, importing the rest", () => {
    /**
     * ── THE HEADLINE PROMISE ───────────────────────────────────────────────
     * One broken entry no longer blocks twenty valid ones.
     */
    it("2/14. imports the twenty valid entries and skips the invalid one", async () => {
      const result = await importResult([
        ...Array.from({ length: 20 }, (_value, index) => normalRoute({ destination: `Kallo ${index}` })),
        normalRoute({ departure: "Gent", destination: "Lille", tarief: -1 }),
      ]);

      expect(result.outcome).toBe("PARTIAL");
      expect(result.imported.normalRoutes).toBe(20);
      expect(result.skipped).toEqual([
        expect.objectContaining({ routeNumber: 21, type: "NORMAL", route: "Gent to Lille" }),
      ]);
      expect(configurationServices.routes.create).toHaveBeenCalledTimes(20);
    });

    it("1. a document of valid entries only is COMPLETED", async () => {
      const result = await importResult([normalRoute(), combinationRoute()]);

      expect(result).toMatchObject({ outcome: "COMPLETED", skipped: [], stoppedAt: null, notAttempted: 0 });
      expect(result.imported.totalRoutes).toBe(3);
    });

    /** The two Combinations the owner's file was refused for. */
    it("3/4. skips routes 15 and 29, whose legs are one road, and imports the rest", async () => {
      const sameRoadTwice = combinationRoute({ legs: [leg(), leg({ tarief: 80 })] });
      const document = Array.from({ length: 30 }, (_v, index) =>
        index === 14 || index === 28 ? sameRoadTwice : normalRoute({ destination: `Kallo ${index}` }),
      );

      const result = await importResult(document);

      expect(result.outcome).toBe("PARTIAL");
      expect(result.imported.normalRoutes).toBe(28);
      expect(result.skipped.map((entry) => [entry.routeNumber, entry.reasons[0].code])).toEqual([
        [15, "SAME_ROUTE_LEGS"],
        [29, "SAME_ROUTE_LEGS"],
      ]);
      expect(result.skipped[0].reasons[0].message).toBe(
        "the two legs of a Combination must be different routes",
      );
      expect(configurationServices.combinations.create).not.toHaveBeenCalled();
    });

    it("5. imports a Combination of two different roads beside a skipped one", async () => {
      const result = await importResult([
        combinationRoute({ legs: [leg(), leg()] }),
        combinationRoute(),
      ]);

      expect(result.imported.combinationGroups).toBe(1);
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(1);
    });

    it("9. skips an entry with a missing required field and keeps the others", async () => {
      const { tarief: _missing, ...withoutTarief } = normalRoute({ destination: "Lille" });
      const result = await importResult([normalRoute(), withoutTarief]);

      expect(result.imported.normalRoutes).toBe(1);
      expect(result.skipped[0]).toMatchObject({
        routeNumber: 2,
        reasons: [expect.objectContaining({ field: "tarief", message: "tarief is required", code: "INVALID" })],
      });
    });

    it("says NOTHING_IMPORTED when every entry is skipped", async () => {
      const result = await importResult([normalRoute({ tarief: -1 })]);

      expect(result.outcome).toBe("NOTHING_IMPORTED");
      expect(transactions).toBe(0);
    });

    /** Each entry its own transaction: one failure cannot undo another. */
    it("writes every entry in its own transaction", async () => {
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

      expect(transactions).toBe(3);
    });

    /**
     * Taken between the check and the write: the database refuses it as a
     * duplicate. That entry is skipped — the others still go in.
     */
    it("skips an entry the database refuses as already configured while importing", async () => {
      configurationServices.routes.create.mockImplementation(async (route: { destination: string }) => {
        if (route.destination === "Lille") {
          throw new DuplicateActiveRouteException("Gent", "Lille");
        }
        return {};
      });

      const result = await importResult([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille" }),
        normalRoute({ departure: "Gent", destination: "Brugge" }),
      ]);

      expect(result.outcome).toBe("PARTIAL");
      expect(result.imported.normalRoutes).toBe(2);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          routeNumber: 2,
          reasons: [expect.objectContaining({ code: "ALREADY_CONFIGURED" })],
        }),
      ]);
    });

    /**
     * ── 11. AN UNEXPLAINED FAILURE IS NOT A BAD ROUTE ───────────────────────
     * It stops the import there and says so; it is not reported as one more
     * skipped entry, and nothing after it is attempted.
     */
    it("11. stops at an unexpected database failure instead of skipping past it", async () => {
      configurationServices.routes.create.mockImplementation(async (route: { destination: string }) => {
        if (route.destination === "Lille") {
          throw new Error("connection terminated unexpectedly");
        }
        return {};
      });

      const result = await importResult([
        normalRoute(),
        normalRoute({ departure: "Gent", destination: "Lille" }),
        normalRoute({ departure: "Gent", destination: "Brugge" }),
      ]);

      expect(result).toMatchObject({
        outcome: "ABORTED",
        stoppedAt: { routeNumber: 2 },
        notAttempted: 1,
        skipped: [],
      });
      expect(result.imported.normalRoutes).toBe(1);
      expect(configurationServices.routes.create).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        "Bulk route import stopped by an unexpected error",
        expect.objectContaining({ routeNumber: 2, error: "connection terminated unexpectedly" }),
      );
    });

    it("15. still refuses a document it cannot read, creating nothing", async () => {
      await expect(service.import({ prices: [] })).rejects.toThrow(/nothing was created/);

      expect(transactions).toBe(0);
    });

    it("6. keeps the FIRST of two identical routes in one document and skips the later", async () => {
      const result = await importResult([
        normalRoute({ tarief: 100 }),
        normalRoute({ departure: "Gent", destination: "Lille" }),
        // Same road, other amounts: still the same route, never imported twice.
        normalRoute({ tarief: 140 }),
      ]);

      expect(result.imported.normalRoutes).toBe(2);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          routeNumber: 3,
          reasons: [
            expect.objectContaining({
              code: "DUPLICATE_IN_IMPORT",
              message: "this route is already configured by route 1 of this import: Antwerp to Kallo",
            }),
          ],
        }),
      ]);
      expect(configurationServices.routes.create.mock.calls.map(([route]) => route.tarief)).toEqual([100, 0 + 100]);
    });

    it("7. skips a route that is already configured and imports the rest", async () => {
      routePricing.findConfiguredRoute.mockImplementation(async (departure: string) =>
        departure === "Antwerp" ? { id: "stored" } : null,
      );

      const result = await importResult([normalRoute(), normalRoute({ departure: "Gent", destination: "Lille" })]);

      expect(result.imported.normalRoutes).toBe(1);
      expect(result.skipped[0].reasons[0]).toMatchObject({
        code: "ALREADY_CONFIGURED",
        message: "this route is already configured: Antwerp to Kallo",
      });
      expect(configurationServices.routes.create).toHaveBeenCalledTimes(1);
    });

    it("8. skips a Combination whose pair is already configured and keeps the others", async () => {
      combinationPricing.findConfiguredCombination.mockImplementation(
        async (roads: { departure: string }[]) => (roads[0].departure === "Antwerp" ? { id: "stored" } : null),
      );

      const result = await importResult([
        combinationRoute(),
        combinationRoute({
          legs: [
            leg({ departure: "Gent", destination: "Zeebrugge" }),
            leg({ departure: "Zeebrugge", destination: "Gent" }),
          ],
        }),
      ]);

      expect(result.imported.combinationGroups).toBe(1);
      expect(result.skipped[0]).toMatchObject({
        routeNumber: 1,
        type: "COMBINATION",
        route: "Antwerp to Kallo and Kallo to Antwerp",
        reasons: [expect.objectContaining({ code: "ALREADY_CONFIGURED" })],
      });
    });

    it("12. reports counts, entry numbers, identities and reasons together", async () => {
      const result = await importResult([
        normalRoute(),
        combinationRoute({ legs: [leg(), leg()] }),
        { type: "NORMAL", departure: "Gent", destination: "Lille", tarief: "veel", toll: 0, tunnel: 0 },
      ]);

      expect(result).toEqual({
        outcome: "PARTIAL",
        imported: { normalRoutes: 1, combinationGroups: 0, combinationLegs: 0, totalRoutes: 1 },
        skipped: [
          expect.objectContaining({ routeNumber: 2, type: "COMBINATION", route: "Antwerp to Kallo and Antwerp to Kallo" }),
          expect.objectContaining({ routeNumber: 3, type: "NORMAL", route: "Gent to Lille" }),
        ],
        stoppedAt: null,
        notAttempted: 0,
      });
      expect(result.skipped[1].reasons[0]).toMatchObject({ field: "tarief", code: "INVALID" });
    });

    it("previews the same split before anything is written", async () => {
      const check = await checkRoutes([normalRoute(), combinationRoute({ legs: [leg(), leg()] })]);

      expect(check).toMatchObject({ isValid: false, summary: { normalRoutes: 1, totalRoutes: 1 } });
      expect(check.skipped.map((entry) => entry.routeNumber)).toEqual([2]);
      expect(transactions).toBe(0);
    });

    it("numbers skipped entries by their place in the document, not among the valid ones", async () => {
      routePricing.findConfiguredRoute.mockImplementation(async (_departure: string, destination: string) =>
        destination === "Lille" ? { id: "stored" } : null,
      );

      const result = await importResult([
        normalRoute({ tarief: -1 }),
        normalRoute({ departure: "Gent", destination: "Lille" }),
      ]);

      expect(result.skipped.map((entry) => entry.routeNumber)).toEqual([1, 2]);
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
  /**
   * Over ST travels with its Combination (14 October 2026). Without it an
   * imported Combination never owed Over ST or the surcharge.
   */
  describe("Over ST", () => {
    it("imports a Combination's Over ST with it", async () => {
      await importRoutes([
        combinationRoute({ overSt: { tarief: 40, toll: 10, tunnel: null } }),
      ]);

      expect(configurationServices.combinations.create).toHaveBeenCalledWith({
        legs: expect.any(Array),
        overSt: expect.objectContaining({ tarief: 40, toll: 10, tunnel: null }),
      });
    });

    it("keeps an explicit 0.00 as configured", async () => {
      await importRoutes([combinationRoute({ overSt: { tarief: 0, toll: null, tunnel: null } })]);

      expect(configurationServices.combinations.create.mock.calls[0][0].overSt).toMatchObject({
        tarief: 0,
      });
    });

    it("imports none when the entry names none", async () => {
      await importRoutes([combinationRoute()]);

      expect(configurationServices.combinations.create.mock.calls[0][0].overSt).toBeUndefined();
    });

    it("31. skips a Combination with an invalid Over ST amount and keeps the rest", async () => {
      const result = await importResult([
        normalRoute(),
        combinationRoute({ overSt: { tarief: -5, toll: null, tunnel: null } }),
      ]);

      expect(result.imported.normalRoutes).toBe(1);
      expect(result.skipped[0]).toMatchObject({ routeNumber: 2, reasons: [expect.objectContaining({ field: "tarief" })] });
    });
  });

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
    it("imports 209 Combinations sharing legs", async () => {
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
      expect(transactions).toBe(209);
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(
        209,
      );
    });

    /** One broken entry among shared legs is skipped; its sibling goes in. */
    it("imports the valid shared-leg Combination beside an invalid one", async () => {
      const [valid, second] = sharingLegOne(2);

      const result = await importResult([valid, { ...second, legs: [second.legs[0]] }]);

      expect(result.imported.combinationGroups).toBe(1);
      expect(result.skipped.map((entry) => entry.routeNumber)).toEqual([2]);
      expect(configurationServices.combinations.create).toHaveBeenCalledTimes(1);
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
            leg({ departure: "Kallo", destination: "Antwerp", toll: -1 }),
          ],
        }),
      ]);

      expect(errors[0]).toMatchObject({
        routeNumber: 1,
        legNumber: 2,
        field: "toll",
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

      expect(logged).toContain("Bulk route import finished");
      expect(logged).not.toContain("1234.56");
    });

    it("says which entries were skipped, without the amounts", async () => {
      await refusalOf([normalRoute({ tarief: -9999.99 })]);

      expect(logger.log).toHaveBeenCalledWith(
        "Bulk route import finished",
        expect.objectContaining({ skippedRouteNumbers: [1] }),
      );
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("9999.99");
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
          toll: 310.25,
          tunnel: 0,
        },
        {
          type: "NORMAL",
          departure: "Gent",
          destination: "Lille",
          tarief: 120,
          toll: 55,
          tunnel: 12.5,
        },
        {
          type: "COMBINATION",
          legs: [
            {
              departure: "Antwerp",
              destination: "Kallo",
              tarief: 100,
              toll: 25,
              tunnel: 0,
            },
            {
              departure: "Kallo",
              destination: "Antwerp",
              tarief: 80,
              toll: 30,
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
          toll: 310.25,
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
          toll: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          toll: 30,
          tunnel: 15,
        },
      ]);
    });

    /**
     * The toll is an AMOUNT and is required like the tunnel: zero states "no
     * toll", and null is not a value this document can carry.
     */
    it("refuses a null toll", async () => {
      const { isValid } = await service.check({
        routes: [
          {
            type: "NORMAL",
            departure: "Aalst",
            destination: "Ninove",
            tarief: 50,
            toll: null,
            tunnel: 0,
          },
        ],
      });

      expect(isValid).toBe(false);
    });

    it("still refuses a route with no toll field at all", async () => {
      const entry = {
        type: "NORMAL",
        departure: "Aalst",
        destination: "Ninove",
        tarief: 50,
        tunnel: 0,
      };

      expect(await refusalOf([entry])).toEqual([
        "route 1: toll is required",
      ]);
    });

    it("writes an empty configuration as a document that imports nothing", async () => {
      const { errors } = await service.check({ routes: [] });

      expect(errors[0].message).toBe("routes must not be empty");
    });
  });

  /**
   * A bound on how much work one request may carry, enforced when the document
   * is read.
   */
  it("bounds how many routes one import may carry", () => {
    expect(MAX_IMPORT_ROUTES).toBe(500);
  });
});
