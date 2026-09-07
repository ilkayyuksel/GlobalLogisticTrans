import { CostConfirmation, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

const TRIP_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TRIP_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

/**
 * A Trip may hold SEVERAL cost confirmations.
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────
 * `cost_confirmation.trip_id` was UNIQUE and a second, different confirmation
 * was refused — the first one stood, and the later money was lost along with
 * its evidence. Eucon confirms in instalments, so every arrival is now kept and
 * the Trip is worth their SUM.
 *
 * These tests cover the two halves that follow from that and nothing else:
 *
 *   WHICH IS LATEST — the Ritten row shows one confirmation, and it must be the
 *     most recently RECEIVED. Ordering is by the importer's own `received_at`
 *     with `created_at` and the primary key behind it, so two arriving in the
 *     same millisecond still order deterministically;
 *   WHAT COUNTS TWICE — nothing. `cc_number` is Eucon's own reference, and the
 *     same one arriving again writes no row, so a resent message cannot double
 *     an amount.
 *
 * The aggregation itself is the read side's, and is tested in
 * `cost-confirmation-read.service.spec.ts` where the Decimal arithmetic lives.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildRow(
  ccNumber: string,
  amount: string,
  overrides: Partial<CostConfirmation> = {},
): CostConfirmation {
  return {
    id: `cc-${ccNumber}`,
    tripId: TRIP_A,
    pdfDocumentId: `pdf-${ccNumber}`,
    ccNumber,
    costCode: "WAIT",
    amount: new Prisma.Decimal(amount),
    currency: "EUR",
    receivedAt: new Date("2026-08-17T10:00:00Z"),
    createdAt: new Date("2026-08-17T10:00:00Z"),
    updatedAt: new Date("2026-08-17T10:00:00Z"),
    ...overrides,
  };
}

describe("several cost confirmations on one Trip", () => {
  let stored: CostConfirmation[];
  let repository: {
    create: jest.Mock;
    findAllByTrip: jest.Mock;
    findForTrips: jest.Mock;
  };
  let service: CostConfirmationService;

  /** Newest first, as the real repository's ordering guarantees. */
  function newestFirst(rows: CostConfirmation[]): CostConfirmation[] {
    return [...rows].sort(
      (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
    );
  }

  beforeEach(() => {
    stored = [];

    repository = {
      create: jest.fn((data: CostConfirmation) => {
        const row = buildRow(data.ccNumber, String(data.amount), {
          tripId: data.tripId,
          pdfDocumentId: data.pdfDocumentId,
          receivedAt: data.receivedAt,
        });

        stored.push(row);

        return Promise.resolve(row);
      }),
      findAllByTrip: jest.fn((tripId: string) =>
        Promise.resolve(
          newestFirst(stored.filter((row) => row.tripId === tripId)),
        ),
      ),
      findForTrips: jest.fn((tripIds: readonly string[]) =>
        Promise.resolve(
          newestFirst(stored.filter((row) => tripIds.includes(row.tripId))),
        ),
      ),
    };

    service = new CostConfirmationService(
      repository as unknown as CostConfirmationRepository,
      { recalculate: jest.fn().mockResolvedValue({ pricing: null, reasonCode: null }) } as never,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  /** Arrival N, one minute after the last, as a real sequence would be. */
  function arrival(ccNumber: string, amount: string, minute: number) {
    return {
      tripId: TRIP_A,
      pdfDocumentId: `pdf-${ccNumber}`,
      ccNumber,
      costCode: "WAIT",
      amount,
      currency: "EUR",
      receivedAt: new Date(`2026-08-17T1${minute}:00:00Z`),
    };
  }

  describe("every arrival is kept", () => {
    it("stores the first", async () => {
      await service.record(arrival("100001", "100.00", 0));

      expect(stored).toHaveLength(1);
    });

    it("stores a second, different one beside it", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));

      expect(stored.map((row) => row.ccNumber)).toEqual(["100001", "100002"]);
    });

    it("stores a third, and the first two survive", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));
      await service.record(arrival("100003", "40.00", 2));

      expect(stored.map((row) => row.ccNumber)).toEqual([
        "100001",
        "100002",
        "100003",
      ]);
    });

    /** Each keeps its OWN document — the earlier PDFs are never replaced. */
    it("keeps a document per confirmation", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));
      await service.record(arrival("100003", "40.00", 2));

      expect(new Set(stored.map((row) => row.pdfDocumentId)).size).toBe(3);
    });

    /** Nothing is ever updated or deleted: a correction is a new row. */
    it("offers no way to change or remove one", () => {
      expect(repository).not.toHaveProperty("update");
      expect(repository).not.toHaveProperty("delete");
    });
  });

  describe("the same confirmation arriving again", () => {
    it("writes no second row", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100001", "100.00", 1));

      expect(stored).toHaveLength(1);
    });

    it("is reported as already recorded", async () => {
      await service.record(arrival("100001", "100.00", 0));

      const result = await service.record(arrival("100001", "100.00", 1));

      expect(result.outcome).toBe("ALREADY_RECORDED");
    });

    /** The reference is what identifies it, not the amount it happens to carry. */
    it("is refused even when the repeat states another amount", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100001", "999.00", 1));

      expect(stored).toHaveLength(1);
      expect(stored[0].amount.toFixed(2)).toBe("100.00");
    });

    /** A repeat of the FIRST, after a second has arrived, is still a repeat. */
    it("recognises a repeat of an earlier one", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));

      const result = await service.record(arrival("100001", "100.00", 2));

      expect(result.outcome).toBe("ALREADY_RECORDED");
      expect(stored).toHaveLength(2);
    });
  });

  /**
   * The Ritten row shows ONE confirmation, and it is the latest received. The
   * older ones stay stored — this is a display rule, not a retention rule.
   */
  describe("which one the Ritten list shows", () => {
    async function latestFor(tripId: string): Promise<string | undefined> {
      return (await service.findForTrips([tripId])).get(tripId)?.ccNumber;
    }

    it("is the only one, at first", async () => {
      await service.record(arrival("100001", "100.00", 0));

      expect(await latestFor(TRIP_A)).toBe("100001");
    });

    it("becomes the second once it arrives", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));

      expect(await latestFor(TRIP_A)).toBe("100002");
    });

    it("becomes the third once it arrives", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));
      await service.record(arrival("100003", "40.00", 2));

      expect(await latestFor(TRIP_A)).toBe("100003");
    });

    /** Showing one does not remove the others. */
    it("leaves every earlier confirmation stored and queryable", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));
      await service.record(arrival("100003", "40.00", 2));

      const all = await repository.findAllByTrip(TRIP_A);

      expect(all).toHaveLength(3);
      expect(await latestFor(TRIP_A)).toBe("100003");
    });

    /** One batched query for a page, whatever each Trip holds. */
    it("asks once for a whole page of Trips", async () => {
      await service.record(arrival("100001", "100.00", 0));
      await service.record(arrival("100002", "25.00", 1));

      repository.findForTrips.mockClear();
      await service.findForTrips([TRIP_A, TRIP_B]);

      expect(repository.findForTrips).toHaveBeenCalledTimes(1);
      expect(repository.findForTrips).toHaveBeenCalledWith([TRIP_A, TRIP_B]);
    });

    it("answers nothing for a Trip with no confirmation", async () => {
      expect(await latestFor(TRIP_B)).toBeUndefined();
    });
  });
});
