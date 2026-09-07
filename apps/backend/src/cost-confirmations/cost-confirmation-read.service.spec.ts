import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CostConfirmationReadRepository } from "./cost-confirmation-read.repository";
import { CostConfirmationReadService } from "./cost-confirmation-read.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * The narrow Cost Confirmation read side.
 *
 * Two facts contribute to a price — the reference and the amount — and this
 * layer returns those two. The amount leaves as the fixed-2 STRING the NUMERIC
 * column holds: money is never a float in this system, and a Decimal serialised
 * through a JavaScript number would become one the moment it left.
 *
 * There is deliberately no write here. This is the half the Pricing Engine
 * reaches, and a repository that could create would let the Engine record an
 * amount with no document behind it.
 */
describe("CostConfirmationReadRepository", () => {
  let prisma: { costConfirmation: { findMany: jest.Mock } };
  let repository: CostConfirmationReadRepository;

  beforeEach(() => {
    prisma = { costConfirmation: { findMany: jest.fn().mockResolvedValue([]) } };

    repository = new CostConfirmationReadRepository(
      prisma as unknown as PrismaService,
    );
  });

  /**
   * EVERY confirmation of the Trip, newest first. `trip_id` used to be unique
   * and this was a `findUnique`; a Trip may now hold several and is worth
   * their sum, so the Engine reads them all in one query.
   */
  it("reads every confirmation of the Trip, newest first", async () => {
    await repository.findAllByTrip(TRIP_ID);

    expect(prisma.costConfirmation.findMany).toHaveBeenCalledWith({
      where: { tripId: TRIP_ID },
      orderBy: [
        { receivedAt: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: { ccNumber: true, amount: true },
    });
  });

  /** One query for the Trip being priced — never one per confirmation. */
  it("asks once", async () => {
    await repository.findAllByTrip(TRIP_ID);

    expect(prisma.costConfirmation.findMany).toHaveBeenCalledTimes(1);
  });

  it("offers no way to write one", () => {
    expect(repository).not.toHaveProperty("create");
    expect(repository).not.toHaveProperty("update");
    expect(repository).not.toHaveProperty("delete");
  });
});

describe("CostConfirmationReadService", () => {
  let repository: { findAllByTrip: jest.Mock };
  let service: CostConfirmationReadService;

  beforeEach(() => {
    repository = {
      findAllByTrip: jest.fn().mockResolvedValue([
        { ccNumber: "4139505", amount: new Prisma.Decimal("165.00") },
      ]),
    };

    service = new CostConfirmationReadService(
      repository as unknown as CostConfirmationReadRepository,
    );
  });

  it("returns the reference and the amount as exact decimal text", async () => {
    expect(await service.findForTrip(TRIP_ID)).toEqual({
      ccNumbers: ["4139505"],
      amount: "165.00",
    });
  });

  it("keeps the two decimals a whole amount would otherwise lose", async () => {
    repository.findAllByTrip.mockResolvedValue([
      { ccNumber: "4139505", amount: new Prisma.Decimal("200") },
    ]);

    expect((await service.findForTrip(TRIP_ID))?.amount).toBe("200.00");
  });

  /**
   * The rule this change exists for: a Trip confirmed in instalments is worth
   * the SUM of its confirmations.
   */
  describe("several confirmations", () => {
    function given(...amounts: readonly string[]): void {
      repository.findAllByTrip.mockResolvedValue(
        amounts.map((amount, index) => ({
          ccNumber: `41395${index}`,
          amount: new Prisma.Decimal(amount),
        })),
      );
    }

    it("adds two of them", async () => {
      given("100.00", "25.00");

      expect((await service.findForTrip(TRIP_ID))?.amount).toBe("125.00");
    });

    it("adds three of them", async () => {
      given("100.00", "25.00", "40.00");

      expect((await service.findForTrip(TRIP_ID))?.amount).toBe("165.00");
    });

    it("names every contributing confirmation, in the order read", async () => {
      given("100.00", "25.00", "40.00");

      expect((await service.findForTrip(TRIP_ID))?.ccNumbers).toEqual([
        "413950",
        "413951",
        "413952",
      ]);
    });

    /**
     * Added as Decimal, not as JS numbers. `0.1 + 0.2` is 0.30000000000000004
     * as a float and 0.30 as money, and this system stores money.
     */
    it("adds exactly, without float drift", async () => {
      given("0.10", "0.20");

      expect((await service.findForTrip(TRIP_ID))?.amount).toBe("0.30");
    });

    /** Existing amount semantics are untouched: nothing is validated here. */
    it("keeps a zero contributing nothing", async () => {
      given("100.00", "0.00");

      expect((await service.findForTrip(TRIP_ID))?.amount).toBe("100.00");
    });

    it("lets a negative confirmation reduce the total", async () => {
      given("100.00", "-25.00");

      expect((await service.findForTrip(TRIP_ID))?.amount).toBe("75.00");
    });

    /**
     * A total of zero is NOT the same as no confirmation: the documents exist,
     * so the line exists and says so.
     */
    it("still answers when the confirmations cancel out", async () => {
      given("100.00", "-100.00");

      const result = await service.findForTrip(TRIP_ID);

      expect(result).not.toBeNull();
      expect(result?.amount).toBe("0.00");
    });
  });

  /**
   * Null is an ordinary answer and is NOT an EK of zero: a Trip with no
   * confirmation prices without an EK line at all, which is a different
   * breakdown from one charged nothing.
   */
  it("answers null for a Trip with no confirmation", async () => {
    repository.findAllByTrip.mockResolvedValue([]);

    expect(await service.findForTrip(TRIP_ID)).toBeNull();
  });
});
