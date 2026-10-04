import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationLegSyncService, findSyncTargets } from "./combination-leg-sync.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import type {
  CombinationRouteConfigurationDto,
  RouteConfigurationDto,
  SaveCombinationRouteConfigurationDto,
} from "./dto/route-configuration.dto";
import { RouteConfigurationUnitOfWork } from "./route-configuration.unit-of-work";

/**
 * Copying one Combination leg's prices to every other Combination that runs the
 * same leg in the same position.
 *
 * ── THE DATABASE, IN MEMORY, WITH A REAL ROLLBACK ───────────────────────────
 * The unit of work's `run` is replaced by one that snapshots an in-memory store
 * and restores it when the work throws — what a transaction does. What is under
 * test is that the sync does all of its reading and writing inside that one run,
 * through the Combination update an inline edit uses, and touches nothing else.
 * The atomicity of the real transaction is Prisma's.
 */

function leg(
  departure: string,
  destination: string,
  prices: { tarief: string; kilometres: string | null; tunnel: string },
  combinationGroupId: string,
  position: 1 | 2,
): RouteConfigurationDto {
  return {
    id: `${combinationGroupId}-leg-${position}`,
    departure,
    destination,
    tarief: prices.tarief,
    kilometres: prices.kilometres,
    tunnel: prices.tunnel,
    hasTunnel: prices.tunnel !== "0.00",
    type: "COMBINATION",
    combinationGroupId,
    reviewed: false,
  } as RouteConfigurationDto;
}

function combination(
  id: string,
  first: [string, string, { tarief: string; kilometres: string | null; tunnel: string }],
  second: [string, string, { tarief: string; kilometres: string | null; tunnel: string }],
  reviewed = false,
): CombinationRouteConfigurationDto {
  return {
    id,
    reviewed,
    legs: [
      leg(first[0], first[1], first[2], id, 1),
      leg(second[0], second[1], second[2], id, 2),
    ],
  };
}

const QUAY = "PSA Quay 869";
const prices = (tarief: string, kilometres: string | null, tunnel: string) => ({
  tarief,
  kilometres,
  tunnel,
});

/** The example from the specification, plus a second Leg-1 target. */
function theExample(): CombinationRouteConfigurationDto[] {
  return [
    combination("A", [QUAY, "GENT", prices("100.00", "25.00", "10.00")], ["GENT", "LESSINES", prices("80.00", "30.00", "0.00")]),
    combination("B", [QUAY, "GENT", prices("120.00", "25.00", "15.00")], ["GENT", "BRUSSELS", prices("90.00", "40.00", "0.00")], true),
    combination("C", ["ANTWERP", "GENT", prices("70.00", "20.00", "0.00")], ["GENT", "LESSINES", prices("60.00", "30.00", "0.00")]),
    combination("D", ["GENT", "ZEMST", prices("55.00", "15.00", "0.00")], [QUAY, "GENT", prices("99.00", "99.00", "9.00")]),
    combination("E", [QUAY, "GENT", prices("140.00", null, "0.00")], ["GENT", "AALST", prices("75.00", "28.00", "0.00")]),
  ];
}

/** An in-memory Combination store behind a unit of work that rolls back. */
function harness(initial: CombinationRouteConfigurationDto[], failOnUpdateOf?: string) {
  let store = structuredClone(initial);
  const routes = {
    // An ordinary route is never reached by a sync — any call is a failure.
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findAll: jest.fn(),
  };

  const combinations = {
    findAll: jest.fn(async () => structuredClone(store)),
    findById: jest.fn(async (id: string) => {
      const found = store.find((each) => each.id === id);

      if (!found) {
        throw new Error(`Combination ${id} not found`);
      }

      return structuredClone(found);
    }),
    // The update an inline leg edit goes through: replaces both legs' values.
    update: jest.fn(async (id: string, dto: SaveCombinationRouteConfigurationDto) => {
      if (id === failOnUpdateOf) {
        throw new Error("the database refused the write");
      }

      store = store.map((each) =>
        each.id !== id
          ? each
          : {
              ...each,
              legs: each.legs.map((stored, index) => ({
                ...stored,
                departure: dto.legs[index].departure,
                destination: dto.legs[index].destination,
                tarief: dto.legs[index].tarief.toFixed(2),
                kilometres:
                  dto.legs[index].kilometres === null ? null : dto.legs[index].kilometres!.toFixed(2),
                tunnel: dto.legs[index].tunnel.toFixed(2),
              })),
            },
      );

      return structuredClone(store.find((each) => each.id === id)!);
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
  const service = new CombinationLegSyncService(
    combinations as unknown as CombinationRouteConfigurationService,
    unitOfWork as unknown as RouteConfigurationUnitOfWork,
    logger as unknown as AppLoggerService,
  );

  return {
    service,
    routes,
    combinations,
    unitOfWork,
    store: () => store,
    get: (id: string) => store.find((each) => each.id === id)!,
  };
}

const pricesOf = (route: RouteConfigurationDto) => ({
  tarief: route.tarief,
  kilometres: route.kilometres,
  tunnel: route.tunnel,
});

describe("which legs are the same leg", () => {
  const all = theExample();
  const source = all[0];

  /** A — and P: every other Combination running it as Leg 1. */
  it("finds every other Combination running the same Leg 1", () => {
    expect(findSyncTargets(source, 1, all).map((each) => each.id)).toEqual(["B", "E"]);
  });

  /** C — the same From and To as LEG 2 of another Combination is not the same leg. */
  it("never finds the same road in the other position", () => {
    expect(findSyncTargets(source, 1, all).map((each) => each.id)).not.toContain("D");
  });

  /** E — From alone, or To alone, is not enough. */
  it("needs both From and To", () => {
    const fromOnly = combination("F", [QUAY, "KALLO", prices("1.00", "1.00", "0.00")], ["X", "Y", prices("1.00", "1.00", "0.00")]);
    const toOnly = combination("G", ["ANTWERP", "GENT", prices("1.00", "1.00", "0.00")], ["X", "Z", prices("1.00", "1.00", "0.00")]);

    expect(findSyncTargets(source, 1, [source, fromOnly, toOnly])).toEqual([]);
  });

  /** B — Leg 2 finds only other Leg 2s. */
  it("finds every other Combination running the same Leg 2", () => {
    expect(findSyncTargets(source, 2, all).map((each) => each.id)).toEqual(["C"]);
  });

  /** H — never the source itself. */
  it("never names the source Combination", () => {
    expect(findSyncTargets(source, 1, all).map((each) => each.id)).not.toContain("A");
  });
});

/**
 * The same road by the application's ONE road identity — `isSameRoad`, which
 * RoutePricing and RouteCost are matched by — never a rule of the sync's own.
 */
describe("which legs are the same road, by the shared route identity", () => {
  const leg = (departure: string, destination = "GENT") =>
    [departure, destination, prices("1.00", "1.00", "0.00")] as [
      string,
      string,
      { tarief: string; kilometres: string | null; tunnel: string },
    ];
  const other = (id: string) => leg(`OTHER-${id}`, `ELSEWHERE-${id}`);
  const source = combination("S", leg(QUAY), other("S"));

  /** A — `PSA Quay 869` and `Quay 869` are one terminal. */
  it("finds Quay 869 → GENT from PSA Quay 869 → GENT, same position", () => {
    const target = combination("T", leg("Quay 869"), other("T"));

    expect(findSyncTargets(source, 1, [source, target]).map((each) => each.id)).toEqual(["T"]);
  });

  /** A — and the other way round, as the shared rule is symmetric. */
  it("finds PSA Quay 869 → GENT from Quay 869 → GENT", () => {
    const plain = combination("P", leg("Quay 869"), other("P"));
    const prefixed = combination("Q", leg(QUAY), other("Q"));

    expect(findSyncTargets(plain, 1, [plain, prefixed]).map((each) => each.id)).toEqual(["Q"]);
  });

  /** B — the same road in the other leg position is still not the same leg. */
  it("never finds the same road identity in the other leg position", () => {
    const swapped = combination("W", other("W"), leg("Quay 869"));

    expect(findSyncTargets(source, 1, [source, swapped])).toEqual([]);
  });

  /** C — another terminal stays another terminal, however alike it reads. */
  it.each([
    ["another quay", "Quay 913", "GENT"],
    ["a longer quay number", "PSA Quay 8690", "GENT"],
    ["PSA not prefixing a quay", "PSA 869", "GENT"],
    ["another destination", "Quay 869", "GENTBRUGGE"],
    // The shared identity compares the DESTINATION exactly, as RoutePricing's
    // lookup does — so the sync must not call these the same either.
    ["the destination in another case", "Quay 869", "Gent"],
  ])("does not find %s", (_label, departure, destination) => {
    const near = combination("N", leg(departure, destination), other("N"));

    expect(findSyncTargets(source, 1, [source, near])).toEqual([]);
  });

  /** E — every spelling of the same road in the same position is reached. */
  it("reaches every Combination on the same normalised road and position", async () => {
    const all = [
      source,
      combination("T1", leg("Quay 869"), other("T1")),
      combination("T2", leg("psa quay 869"), other("T2")),
      combination("T3", leg("PSA   Quay 869"), other("T3")),
      combination("X", leg("Quay 913"), other("X")),
    ];
    const { service, get } = harness(
      all.map((each, index) =>
        index === 0
          ? { ...each, legs: [{ ...each.legs[0], tarief: "150.00", kilometres: "33.00", tunnel: "12.00" }, each.legs[1]] }
          : each,
      ),
    );

    const answer = await service.sync("S", 1);

    expect(answer.targetCombinationGroupIds).toEqual(["T1", "T2", "T3"]);
    for (const id of ["T1", "T2", "T3"]) {
      expect(pricesOf(get(id).legs[0])).toEqual(prices("150.00", "33.00", "12.00"));
    }
    // From and To are left as each Combination wrote them — never renamed.
    expect(get("T2").legs[0].departure).toBe("psa quay 869");
    expect(pricesOf(get("X").legs[0])).toEqual(prices("1.00", "1.00", "0.00"));
  });

  /** D — an ordinary route on the same normalised road is never reached. */
  it("never reaches an ordinary route on the same normalised road", async () => {
    const { service, routes } = harness([
      source,
      combination("T", leg("Quay 869"), other("T")),
    ]);
    routes.findAll.mockResolvedValue([
      { ...source.legs[0], id: "normal-1", departure: "Quay 869", type: "NORMAL", combinationGroupId: null },
    ]);

    await service.sync("S", 1);

    expect(routes.update).not.toHaveBeenCalled();
    expect(routes.create).not.toHaveBeenCalled();
    expect(routes.remove).not.toHaveBeenCalled();
  });
});

describe("synchronising a leg's prices", () => {
  /** A + F + P — every matching Leg 1, however many, gets exactly the source's three values. */
  it("copies Leg 1's Tarief, KM and Tunnel to every matching Leg 1", async () => {
    const { service, get } = harness(theExample());

    const answer = await service.sync("A", 1);

    expect(answer.targetCombinationGroupIds).toEqual(["B", "E"]);
    expect(pricesOf(get("B").legs[0])).toEqual(prices("100.00", "25.00", "10.00"));
    expect(pricesOf(get("E").legs[0])).toEqual(prices("100.00", "25.00", "10.00"));
  });

  /** B — and the other position is synchronised only from its own source. */
  it("copies Leg 2's values to every matching Leg 2", async () => {
    const { service, get } = harness(theExample());

    await service.sync("A", 2);

    expect(pricesOf(get("C").legs[1])).toEqual(prices("80.00", "30.00", "0.00"));
  });

  /** C — Combination D runs the road as Leg 2 and is untouched. */
  it("leaves the same road in the other position untouched", async () => {
    const { service, get } = harness(theExample());

    await service.sync("A", 1);

    expect(pricesOf(get("D").legs[1])).toEqual(prices("99.00", "99.00", "9.00"));
    expect(pricesOf(get("D").legs[0])).toEqual(prices("55.00", "15.00", "0.00"));
  });

  /** D — an ordinary route is never read, let alone written. */
  it("never touches an ordinary route", async () => {
    const { service, routes } = harness(theExample());

    await service.sync("A", 1);

    for (const call of Object.values(routes)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  /** G — nothing to reach: nothing written. */
  it("writes nothing when no other Combination runs the leg", async () => {
    const { service, combinations, store } = harness(theExample());
    const before = structuredClone(store());

    const answer = await service.sync("C", 1);

    expect(answer.targetCombinationGroupIds).toEqual([]);
    expect(combinations.update).not.toHaveBeenCalled();
    expect(store()).toEqual(before);
  });

  /** H — the source keeps exactly what it had. */
  it("leaves the source leg exactly as it was", async () => {
    const { service, get } = harness(theExample());

    await service.sync("A", 1);

    expect(pricesOf(get("A").legs[0])).toEqual(prices("100.00", "25.00", "10.00"));
  });

  /** J + L — only the three values move; From, To, the other leg and the pair stay. */
  it("changes nothing but the target leg's Tarief, KM and Tunnel", async () => {
    const { service, get } = harness(theExample());
    const before = structuredClone(get("B"));

    await service.sync("A", 1);

    const after = get("B");

    expect(after.id).toBe(before.id);
    expect(after.legs.map((each) => each.id)).toEqual(before.legs.map((each) => each.id));
    expect(after.legs[0].departure).toBe(before.legs[0].departure);
    expect(after.legs[0].destination).toBe(before.legs[0].destination);
    expect(after.legs[0].combinationGroupId).toBe("B");
    expect(after.legs[1]).toEqual(before.legs[1]);
  });

  /** K — the review mark is the group's and is never part of a sync. */
  it("keeps every review mark as it was", async () => {
    const { service, get } = harness(theExample());

    await service.sync("A", 1);

    expect(get("B").reviewed).toBe(true);
    expect(get("E").reviewed).toBe(false);
  });

  /** An unmeasured distance stays unmeasured on the way through. */
  it("carries an unmeasured source distance across as unmeasured", async () => {
    const { service, get } = harness(theExample());

    await service.sync("E", 1);

    expect(get("A").legs[0].kilometres).toBeNull();
    expect(get("B").legs[0].kilometres).toBeNull();
  });

  /** N — one target refused: none is written. */
  it("writes no target at all when one of them is refused", async () => {
    const { service, store } = harness(theExample(), "E");
    const before = structuredClone(store());

    await expect(service.sync("A", 1)).rejects.toThrow("the database refused the write");
    expect(store()).toEqual(before);
  });

  /** All of it inside ONE unit of work. */
  it("reads and writes inside a single transaction", async () => {
    const { service, unitOfWork } = harness(theExample());

    await service.sync("A", 1);

    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
  });

  /** O — the source's values are whatever it stores NOW, e.g. right after an inline edit. */
  it("uses the source leg's current stored values", async () => {
    const changed = theExample();
    changed[0].legs[0] = { ...changed[0].legs[0], tarief: "125.00", kilometres: "32.00", tunnel: "8.00" };
    const { service, get } = harness(changed);

    await service.sync("A", 1);

    expect(pricesOf(get("B").legs[0])).toEqual(prices("125.00", "32.00", "8.00"));
  });

  /** I + M — the toll rate and pricing history are outside a sync's reach entirely. */
  it("writes through the Combination update and nothing else", async () => {
    const { service, combinations } = harness(theExample());

    await service.sync("A", 1);

    // Only Combination updates — no setting (the global toll rate per km),
    // no TripPricing: the service has no way to reach either.
    expect(combinations.update).toHaveBeenCalledTimes(2);
    for (const [, dto] of combinations.update.mock.calls) {
      expect(Object.keys(dto)).toEqual(["legs"]);
      for (const payload of (dto as SaveCombinationRouteConfigurationDto).legs) {
        expect(Object.keys(payload).sort()).toEqual(["departure", "destination", "kilometres", "tarief", "tunnel"]);
      }
    }
  });

  it("previews exactly what a sync reaches, writing nothing", async () => {
    const { service, combinations, unitOfWork } = harness(theExample());

    const preview = await service.preview("A", 1);

    expect(preview).toMatchObject({
      combinationGroupId: "A",
      legPosition: 1,
      departure: QUAY,
      destination: "GENT",
      prices: { tarief: "100.00", kilometres: "25.00", tunnel: "10.00" },
      targetCombinationGroupIds: ["B", "E"],
    });
    expect(combinations.update).not.toHaveBeenCalled();
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });
});
