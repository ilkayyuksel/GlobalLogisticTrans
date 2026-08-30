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
  let prisma: { costConfirmation: { findUnique: jest.Mock } };
  let repository: CostConfirmationReadRepository;

  beforeEach(() => {
    prisma = { costConfirmation: { findUnique: jest.fn().mockResolvedValue(null) } };

    repository = new CostConfirmationReadRepository(
      prisma as unknown as PrismaService,
    );
  });

  /** `trip_id` is unique: the question is never "which confirmation". */
  it("looks the confirmation up by Trip, reading only the pricing columns", async () => {
    await repository.findByTrip(TRIP_ID);

    expect(prisma.costConfirmation.findUnique).toHaveBeenCalledWith({
      where: { tripId: TRIP_ID },
      select: { ccNumber: true, amount: true },
    });
  });

  it("offers no way to write one", () => {
    expect(repository).not.toHaveProperty("create");
    expect(repository).not.toHaveProperty("update");
    expect(repository).not.toHaveProperty("delete");
  });
});

describe("CostConfirmationReadService", () => {
  let repository: { findByTrip: jest.Mock };
  let service: CostConfirmationReadService;

  beforeEach(() => {
    repository = {
      findByTrip: jest.fn().mockResolvedValue({
        ccNumber: "4139505",
        amount: new Prisma.Decimal("165.00"),
      }),
    };

    service = new CostConfirmationReadService(
      repository as unknown as CostConfirmationReadRepository,
    );
  });

  it("returns the reference and the amount as exact decimal text", async () => {
    expect(await service.findForTrip(TRIP_ID)).toEqual({
      ccNumber: "4139505",
      amount: "165.00",
    });
  });

  it("keeps the two decimals a whole amount would otherwise lose", async () => {
    repository.findByTrip.mockResolvedValue({
      ccNumber: "4139505",
      amount: new Prisma.Decimal("200"),
    });

    expect((await service.findForTrip(TRIP_ID))?.amount).toBe("200.00");
  });

  /**
   * Null is an ordinary answer and is NOT an EK of zero: a Trip with no
   * confirmation prices without an EK line at all, which is a different
   * breakdown from one charged nothing.
   */
  it("answers null for a Trip with no confirmation", async () => {
    repository.findByTrip.mockResolvedValue(null);

    expect(await service.findForTrip(TRIP_ID)).toBeNull();
  });
});
