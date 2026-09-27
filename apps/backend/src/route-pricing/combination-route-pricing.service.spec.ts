import { Prisma, RoutePricing } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "./combination-route-pricing.service";
import { CreateRoutePricingDto } from "./dto/create-route-pricing.dto";
import {
  CombinationLegNotSeparatelyRemovableException,
  CombinationRouteGroupNotFoundException,
  DuplicateActiveRouteException,
  DuplicateCombinationRouteException,
  InvalidCombinationLegCountException,
} from "./exceptions/route-pricing.exceptions";

const GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const OUTBOUND_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const RETURN_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";

/**
 * A Combination route configuration is TWO legs, or it does not exist.
 *
 * ── WHAT THIS SERVICE IS FOR ────────────────────────────────────────────────
 * Antwerp to Kallo at 100 over 25 km, and Kallo back to Antwerp at 80 over the
 * same 25 km, is ONE thing an operator configures. The two legs legitimately
 * cost different amounts, which is precisely why each is its own record — and
 * why the pair needs an identity of its own rather than a convention that two
 * loose routes belong together.
 *
 * ── NOT A TRIP GROUP ────────────────────────────────────────────────────────
 * Nothing here touches the group an operator makes in the Rittenlijst. That
 * group decides which Trips carry the €50 Backload; this decides what the two
 * legs of a Combination COST. These tests assert that separation explicitly,
 * because the two are easy to confuse by name alone.
 *
 * ── WHAT IS PROVED HERE ─────────────────────────────────────────────────────
 * That anything but two legs is refused; that both legs are written inside ONE
 * transaction, so a Combination with a single leg cannot be stored; that each
 * leg keeps its own Tarief, distance and position; and that removing a
 * Combination removes the pair rather than a leg.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** One leg, as an operator configured it. */
function leg(overrides: Partial<CreateRoutePricingDto> = {}): CreateRoutePricingDto {
  return {
    routeName: "Antwerp - Kallo",
    departure: "Antwerp",
    destination: "Kallo",
    basePrice: 100,
    kilometres: 25,
    ...overrides,
  };
}

/** The outbound and the return, priced differently as they really are. */
function bothLegs(): CreateRoutePricingDto[] {
  return [
    leg(),
    leg({
      routeName: "Kallo - Antwerp",
      departure: "Kallo",
      destination: "Antwerp",
      basePrice: 80,
    }),
  ];
}

function storedLeg(
  id: string,
  position: number,
  overrides: Partial<RoutePricing> = {},
): RoutePricing {
  return {
    id,
    routeName: "Antwerp - Kallo",
    departure: "Antwerp",
    destination: "Kallo",
    basePrice: new Prisma.Decimal("100.00"),
    kilometres: new Prisma.Decimal("25.00"),
    combinationGroupId: GROUP_ID,
    combinationLegPosition: position,
    // A leg's own mark is never read: the group carries it.
    reviewed: false,
    notes: null,
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
  };
}

function storedPair(): RoutePricing[] {
  return [
    storedLeg(OUTBOUND_ID, 1),
    storedLeg(RETURN_ID, 2, {
      routeName: "Kallo - Antwerp",
      departure: "Kallo",
      destination: "Antwerp",
      basePrice: new Prisma.Decimal("80.00"),
    }),
  ];
}

const GROUP = {
  id: GROUP_ID,
  notes: null,
  reviewed: false,
  createdAt: new Date("2026-09-26T00:00:00Z"),
  updatedAt: new Date("2026-09-26T00:00:00Z"),
};

describe("CombinationRoutePricingService", () => {
  let repository: {
    runInTransaction: jest.Mock;
    createGroup: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findByRoute: jest.Mock;
    findGroupWithLegRoads: jest.Mock;
    findGroupById: jest.Mock;
    findGroups: jest.Mock;
    findLegsOfGroup: jest.Mock;
    deleteGroup: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: CombinationRoutePricingService;

  /** Records the order in which the repository was written to. */
  let writes: string[];

  beforeEach(() => {
    writes = [];

    repository = {
      /*
       * The real one hands `work` a repository bound to the transaction. The
       * double hands it THIS repository, which is the same thing for the purpose
       * of these tests: what matters is that every write happens inside the
       * callback, which the "transaction" tests below assert directly.
       */
      runInTransaction: jest.fn(
        async (work: (repository: unknown) => Promise<unknown>) => {
          writes.push("transaction:start");
          const result = await work(repository);
          writes.push("transaction:end");

          return result;
        },
      ),
      createGroup: jest.fn(async () => {
        writes.push("group");

        return GROUP;
      }),
      create: jest.fn(async (data: { combinationLegPosition: number }) => {
        writes.push(`leg:${data.combinationLegPosition}`);

        return storedLeg(OUTBOUND_ID, data.combinationLegPosition);
      }),
      update: jest.fn(async (id: string) => {
        writes.push(`update:${id}`);

        return storedLeg(id, 1);
      }),
      // Nothing else configures either road unless a test says so.
      findByRoute: jest.fn().mockResolvedValue(null),
      // And no Combination holds this pair of roads unless a test says so.
      findGroupWithLegRoads: jest.fn().mockResolvedValue(null),
      findGroupById: jest.fn().mockResolvedValue(GROUP),
      findGroups: jest.fn().mockResolvedValue([]),
      findLegsOfGroup: jest.fn().mockResolvedValue(storedPair()),
      deleteGroup: jest.fn().mockResolvedValue(GROUP),
    };

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new CombinationRoutePricingService(
      repository as never,
      logger as unknown as AppLoggerService,
    );
  });

  describe("exactly two legs", () => {
    /*
     * ── WHY A COUNT IS A BUSINESS RULE ────────────────────────────────────
     * One leg is not a partially configured Combination. It is a configuration
     * that prices one direction and silently charges nothing for the other, and
     * the operator would have no way of seeing that from the screen.
     */
    it.each([
      ["no legs", 0],
      ["one leg", 1],
      ["three legs", 3],
    ])("refuses %s", async (_name, count) => {
      const legs = Array.from({ length: count }, (_value, index) =>
        leg({ destination: `Kallo ${index}` }),
      );

      await expect(service.create(legs)).rejects.toBeInstanceOf(
        InvalidCombinationLegCountException,
      );
    });

    it.each([
      ["no legs", 0],
      ["one leg", 1],
      ["three legs", 3],
    ])("writes nothing when refusing %s", async (_name, count) => {
      const legs = Array.from({ length: count }, (_value, index) =>
        leg({ destination: `Kallo ${index}` }),
      );

      await expect(service.create(legs)).rejects.toThrow();

      expect(repository.runInTransaction).not.toHaveBeenCalled();
      expect(repository.createGroup).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("says how many legs it was given", async () => {
      await expect(service.create([leg()])).rejects.toThrow(
        "has exactly 2 legs, not 1",
      );
    });

    it("accepts exactly two", async () => {
      await expect(service.create(bothLegs())).resolves.toMatchObject({
        id: GROUP_ID,
      });
    });

    it("refuses an edit that is not two legs either", async () => {
      await expect(
        service.replaceLegs(GROUP_ID, [leg()]),
      ).rejects.toBeInstanceOf(InvalidCombinationLegCountException);
    });

    /**
     * A group that does not already hold two legs cannot be edited leg by leg.
     * It is not a state this service can produce, so it is reported rather than
     * repaired — repairing it would mean inventing a leg.
     */
    it("refuses to edit a group that does not hold two legs", async () => {
      repository.findLegsOfGroup.mockResolvedValue([storedLeg(OUTBOUND_ID, 1)]);

      await expect(
        service.replaceLegs(GROUP_ID, bothLegs()),
      ).rejects.toBeInstanceOf(InvalidCombinationLegCountException);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe("the transaction", () => {
    /**
     * ── BOTH LEGS OR NEITHER ────────────────────────────────────────────────
     * The group row and both legs are three writes. Outside a transaction a
     * failure on the second leg would leave a Combination with one, which is the
     * exact state the model exists to refuse.
     */
    it("writes the group and both legs inside one transaction", async () => {
      await service.create(bothLegs());

      expect(writes).toEqual([
        "transaction:start",
        "group",
        "leg:1",
        "leg:2",
        "transaction:end",
      ]);
    });

    it("writes both legs of an edit inside one transaction", async () => {
      await service.replaceLegs(GROUP_ID, bothLegs());

      expect(writes).toEqual([
        "transaction:start",
        `update:${OUTBOUND_ID}`,
        `update:${RETURN_ID}`,
        "transaction:end",
      ]);
    });

    /** The legs are bound to the group by a foreign key, not by a convention. */
    it("writes each leg against the group that was just created", async () => {
      await service.create(bothLegs());

      for (const [call] of repository.create.mock.calls) {
        expect(call.combinationGroupId).toBe(GROUP_ID);
      }
    });
  });

  describe("what each leg keeps", () => {
    it("stores each leg's own Tarief", async () => {
      await service.create(bothLegs());

      const prices = repository.create.mock.calls.map(
        ([call]) => call.basePrice,
      );

      expect(prices).toEqual([100, 80]);
    });

    it("stores each leg's own distance", async () => {
      await service.create([
        leg({ kilometres: 25 }),
        leg({ departure: "Kallo", destination: "Antwerp", kilometres: 31.5 }),
      ]);

      const distances = repository.create.mock.calls.map(
        ([call]) => call.kilometres,
      );

      expect(distances).toEqual([25, 31.5]);
    });

    /** A leg whose distance nobody stated charges no toll, like any route. */
    it("stores a blank distance as null rather than as zero", async () => {
      await service.create([
        leg({ kilometres: undefined }),
        leg({ departure: "Kallo", destination: "Antwerp" }),
      ]);

      expect(repository.create.mock.calls[0][0].kilometres).toBeNull();
    });

    /**
     * ── AND WHICH LEG IT IS ────────────────────────────────────────────────
     * `created_at` cannot say: both legs are written in one transaction and
     * therefore carry the same timestamp. The position is what makes Leg 1 and
     * Leg 2 come back in the order the operator configured them.
     */
    it("records which leg is the outbound and which the return", async () => {
      await service.create(bothLegs());

      const positions = repository.create.mock.calls.map(
        ([call]) => call.combinationLegPosition,
      );

      expect(positions).toEqual([1, 2]);
    });

    it("returns both legs, outbound first", async () => {
      const created = await service.create(bothLegs());

      expect(created.legs.map((each) => each.departure)).toEqual([
        "Antwerp",
        "Kallo",
      ]);
    });

    it("returns each leg's own price as exact decimal text", async () => {
      const created = await service.create(bothLegs());

      expect(created.legs.map((each) => each.basePrice)).toEqual([
        "100.00",
        "80.00",
      ]);
    });

    /** Every leg says which group it belongs to, so the relation is visible. */
    it("returns legs that name their group", async () => {
      const created = await service.create(bothLegs());

      for (const each of created.legs) {
        expect(each.combinationGroupId).toBe(GROUP_ID);
      }
    });
  });

  /**
   * ── WHAT MAY NOT EXIST TWICE IS THE PAIR ──────────────────────────────────
   * A Combination is identified by its two legs together. A single leg is not a
   * configuration — it has no meaning without its partner — so one road may be a
   * leg of as many Combinations as an operator has returns for it. This service
   * used to refuse the second use of a road, which made the real configuration
   * of this business impossible to enter.
   */
  describe("which roads a Combination may describe", () => {
    it("asks whether this PAIR of roads is already configured", async () => {
      await service.create(bothLegs());

      expect(repository.findGroupWithLegRoads).toHaveBeenCalledTimes(1);
      expect(repository.findGroupWithLegRoads.mock.calls[0][0]).toMatchObject([
        { departure: "Antwerp", destination: "Kallo" },
        { departure: "Kallo", destination: "Antwerp" },
      ]);
    });

    /**
     * ── A SHARED ROAD IS NOT A CONFLICT ────────────────────────────────────
     * Everything leaving one terminal shares its outbound. Nothing asks whether
     * a single road is taken, in either scope: an ordinary route on the same
     * road is not a conflict either, which is what the two scopes are for.
     */
    it("never refuses a Combination over a single road", async () => {
      repository.findByRoute.mockResolvedValue(storedLeg(OUTBOUND_ID, 1));

      await expect(service.create(bothLegs())).resolves.toMatchObject({
        id: GROUP_ID,
      });
      expect(repository.findByRoute).not.toHaveBeenCalled();
    });

    it("refuses a Combination whose pair is already configured", async () => {
      repository.findGroupWithLegRoads.mockResolvedValue({
        ...GROUP,
        legs: storedPair(),
      });

      await expect(service.create(bothLegs())).rejects.toBeInstanceOf(
        DuplicateCombinationRouteException,
      );
      expect(repository.runInTransaction).not.toHaveBeenCalled();
    });

    it("names both roads when refusing the pair", async () => {
      repository.findGroupWithLegRoads.mockResolvedValue({
        ...GROUP,
        legs: storedPair(),
      });

      await expect(service.create(bothLegs())).rejects.toThrow(
        "Antwerp to Kallo and Kallo to Antwerp",
      );
    });

    /** Two legs on one road would make the choice between them arbitrary. */
    it("refuses a Combination whose two legs are the same road", async () => {
      await expect(service.create([leg(), leg()])).rejects.toBeInstanceOf(
        DuplicateActiveRouteException,
      );
    });

    it("lets an edit keep its own pair", async () => {
      await service.replaceLegs(GROUP_ID, bothLegs());

      expect(repository.findGroupWithLegRoads).toHaveBeenCalledWith(
        expect.anything(),
        { excludeCombinationGroupId: GROUP_ID },
      );
    });

    /** The index is the real guard; its violation reads as the same conflict. */
    it("translates a unique-index violation into a route conflict", async () => {
      repository.runInTransaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "7.9.1",
        }),
      );

      await expect(service.create(bothLegs())).rejects.toBeInstanceOf(
        DuplicateActiveRouteException,
      );
    });

    it("lets any other failure through unchanged", async () => {
      const failure = new Error("connection lost");
      repository.runInTransaction.mockRejectedValue(failure);

      await expect(service.create(bothLegs())).rejects.toBe(failure);
    });
  });

  describe("removing a Combination", () => {
    /**
     * ── THE PAIR GOES, NEVER A LEG ─────────────────────────────────────────
     * One statement: the legs reference the group with ON DELETE CASCADE, so
     * there is no moment at which one leg survives. Deleting them one at a time
     * would create exactly that window.
     */
    it("removes the group, which takes both legs with it", async () => {
      await service.remove(GROUP_ID);

      expect(repository.deleteGroup).toHaveBeenCalledWith(GROUP_ID);
    });

    it("refuses a Combination that does not exist", async () => {
      repository.findGroupById.mockResolvedValue(null);

      await expect(service.remove(GROUP_ID)).rejects.toBeInstanceOf(
        CombinationRouteGroupNotFoundException,
      );
      expect(repository.deleteGroup).not.toHaveBeenCalled();
    });

    it("refuses to read a Combination that does not exist", async () => {
      repository.findGroupById.mockResolvedValue(null);

      await expect(service.findById(GROUP_ID)).rejects.toBeInstanceOf(
        CombinationRouteGroupNotFoundException,
      );
    });
  });

  describe("reading Combinations", () => {
    it("returns each Combination with both of its legs", async () => {
      repository.findGroups.mockResolvedValue([
        { ...GROUP, legs: storedPair() },
      ]);

      const [combination] = await service.findAll();

      expect(combination.id).toBe(GROUP_ID);
      expect(combination.legs).toHaveLength(2);
    });

    it("returns nothing when none is configured", async () => {
      expect(await service.findAll()).toEqual([]);
    });
  });

  /**
   * ── IT TOUCHES NO TRIP ────────────────────────────────────────────────────
   * Configuration is read when a Trip is priced; a Trip already priced keeps the
   * amounts it was priced with. The €50 Backload follows TripGroup membership
   * and is decided by the Engine, which this service cannot reach: it holds no
   * Trip service, no engine and no snapshot writer.
   */
  it("has no route to a Trip, a snapshot or the Engine", () => {
    expect(Object.keys(service as unknown as object)).toEqual([
      "repository",
      "logger",
    ]);
  });

  describe("logging", () => {
    it("names the Combination without logging a price", async () => {
      await service.create(bothLegs());

      expect(logger.log).toHaveBeenCalledWith(
        "Combination route configuration created",
        { combinationGroupId: GROUP_ID, legCount: 2 },
      );
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("100");
    });

    it("says why a Combination was refused, without the amounts", async () => {
      await expect(service.create([leg()])).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        "Rejected a Combination that is not two legs",
        { legCount: 1 },
      );
    });
  });
});

/**
 * The exception a single leg's deletion raises lives in the same module, and is
 * exercised where it is thrown — RoutePricingService.remove. Asserted here only
 * as a type, so this file documents the whole rule in one place.
 */
describe("a leg cannot be removed on its own", () => {
  it("names the group to remove instead", () => {
    expect(
      new CombinationLegNotSeparatelyRemovableException(
        OUTBOUND_ID,
        GROUP_ID,
      ).message,
    ).toContain(GROUP_ID);
  });
});
