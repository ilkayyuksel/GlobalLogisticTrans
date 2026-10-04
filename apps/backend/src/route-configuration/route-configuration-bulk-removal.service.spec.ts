import { AppLoggerService } from "../logger/app-logger.service";
import { EmptyBulkRemovalException } from "./exceptions/route-configuration.exceptions";
import { RouteConfigurationBulkRemovalService } from "./route-configuration-bulk-removal.service";
import { RouteConfigurationUnitOfWork } from "./route-configuration.unit-of-work";

/**
 * Deleting a selection of routes and Combinations at once.
 *
 * ── THE DATABASE, IN MEMORY, WITH A REAL ROLLBACK ───────────────────────────
 * Each record is removed through the same service method a single delete uses,
 * and all of them inside ONE unit of work. That unit of work is replaced by one
 * that snapshots an in-memory store and restores it when the work throws — what
 * a transaction does — so "nothing is deleted when anything is refused" is
 * observable here. The atomicity of the real transaction is Prisma's.
 */
function harness(
  initial: { routes: string[]; combinations: string[]; legs: Record<string, string[]> },
) {
  let store = structuredClone(initial);

  const routes = {
    remove: jest.fn(async (id: string) => {
      if (Object.values(store.legs).some((legIds) => legIds.includes(id))) {
        // What the real service does: a leg is never removed as if it were a route.
        throw new Error(`Route ${id} is a Combination leg`);
      }

      if (!store.routes.includes(id)) {
        throw new Error(`Route ${id} not found`);
      }

      store = { ...store, routes: store.routes.filter((each) => each !== id) };
    }),
  };
  const combinations = {
    remove: jest.fn(async (id: string) => {
      if (!store.combinations.includes(id)) {
        throw new Error(`Combination ${id} not found`);
      }

      // Both legs with the group, in one statement — the database's cascade.
      const legs = { ...store.legs };
      delete legs[id];
      store = { ...store, combinations: store.combinations.filter((each) => each !== id), legs };
    }),
  };
  const unitOfWork = {
    run: jest.fn(async (work: (services: unknown) => Promise<unknown>) => {
      const before = structuredClone(store);

      try {
        return await work({ routes, combinations });
      } catch (error: unknown) {
        store = before;
        throw error;
      }
    }),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new RouteConfigurationBulkRemovalService(
    unitOfWork as unknown as RouteConfigurationUnitOfWork,
    logger as unknown as AppLoggerService,
  );

  return { service, routes, combinations, unitOfWork, store: () => store };
}

const SEEDED = {
  routes: ["r1", "r2", "r3"],
  combinations: ["c1", "c2"],
  legs: { c1: ["c1-leg-1", "c1-leg-2"], c2: ["c2-leg-1", "c2-leg-2"] },
};

describe("deleting a selection", () => {
  /** 1 */
  it("deletes one ordinary route", async () => {
    const { service, store } = harness(SEEDED);

    const result = await service.remove({ routeIds: ["r1"], combinationGroupIds: [] });

    expect(result).toEqual({ removedRoutes: 1, removedCombinations: 0 });
    expect(store().routes).toEqual(["r2", "r3"]);
  });

  /** 2 */
  it("deletes several ordinary routes", async () => {
    const { service, store } = harness(SEEDED);

    await service.remove({ routeIds: ["r1", "r3"], combinationGroupIds: [] });

    expect(store().routes).toEqual(["r2"]);
  });

  /** 3 + 9 — a Combination always goes whole: the group and both legs. */
  it("deletes several Combinations, each with both legs", async () => {
    const { service, store } = harness(SEEDED);

    await service.remove({ routeIds: [], combinationGroupIds: ["c1", "c2"] });

    expect(store().combinations).toEqual([]);
    expect(store().legs).toEqual({});
  });

  /** 6 — routes and Combinations in one selection. */
  it("deletes a mix of routes and Combinations together", async () => {
    const { service, store } = harness(SEEDED);

    const result = await service.remove({ routeIds: ["r2"], combinationGroupIds: ["c2"] });

    expect(result).toEqual({ removedRoutes: 1, removedCombinations: 1 });
    expect(store()).toEqual({
      routes: ["r1", "r3"],
      combinations: ["c1"],
      legs: { c1: ["c1-leg-1", "c1-leg-2"] },
    });
  });

  /** 8 — everything inside ONE unit of work. */
  it("removes the whole selection inside a single transaction", async () => {
    const { service, unitOfWork } = harness(SEEDED);

    await service.remove({ routeIds: ["r1", "r2"], combinationGroupIds: ["c1"] });

    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
  });

  /** 8 + 9 — one record refused: nothing is deleted, not even what came first. */
  it("deletes nothing when one record cannot be removed", async () => {
    const { service, store } = harness(SEEDED);

    await expect(
      service.remove({ routeIds: ["r1", "missing"], combinationGroupIds: ["c1"] }),
    ).rejects.toThrow("Route missing not found");
    expect(store()).toEqual(SEEDED);
  });

  /** 9 — half a Combination cannot even be asked for. */
  it("refuses a Combination leg named as a route, deleting nothing", async () => {
    const { service, store } = harness(SEEDED);

    await expect(
      service.remove({ routeIds: ["c1-leg-1"], combinationGroupIds: [] }),
    ).rejects.toThrow("is a Combination leg");
    expect(store()).toEqual(SEEDED);
  });

  it("removes a record named twice once", async () => {
    const { service, routes } = harness(SEEDED);

    const result = await service.remove({ routeIds: ["r1", "r1"], combinationGroupIds: [] });

    expect(routes.remove).toHaveBeenCalledTimes(1);
    expect(result.removedRoutes).toBe(1);
  });

  it("refuses a selection that names nothing", async () => {
    const { service, unitOfWork } = harness(SEEDED);

    await expect(service.remove({ routeIds: [], combinationGroupIds: [] })).rejects.toBeInstanceOf(
      EmptyBulkRemovalException,
    );
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  /**
   * 10 — pricing history: removal goes through the single-delete services only,
   * which never reach a TripPricing snapshot (a snapshot stores its amounts and
   * reads no configuration again). Nothing else is called.
   */
  it("uses nothing but the single-record deletions", async () => {
    const { service, routes, combinations } = harness(SEEDED);

    await service.remove({ routeIds: ["r1"], combinationGroupIds: ["c1"] });

    expect(routes.remove).toHaveBeenCalledWith("r1");
    expect(combinations.remove).toHaveBeenCalledWith("c1");
  });
});
