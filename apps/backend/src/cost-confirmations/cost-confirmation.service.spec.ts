import { CostConfirmation } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

/**
 * ONE confirmed cost per Trip.
 *
 * Eucon confirms a Trip's waiting time once. The first confirmation is the
 * authoritative one, and everything below is a way of saying that: the same
 * one again writes nothing, a different one is refused, and neither of them
 * touches the amount already recorded.
 *
 * The database says the same thing independently — `cost_confirmation.trip_id`
 * is unique — so this check is the polite refusal, not the guarantee.
 */

const TRIP_ID = "trip-1";

function buildRow(overrides: Partial<CostConfirmation> = {}): CostConfirmation {
  return {
    id: "cc-1",
    tripId: TRIP_ID,
    pdfDocumentId: "pdf-1",
    ccNumber: "4132482",
    costCode: "WAIT",
    amount: { toFixed: () => "25.00" },
    currency: "EUR",
    receivedAt: new Date("2026-08-18T09:00:00.000Z"),
    createdAt: new Date("2026-08-18T09:00:00.000Z"),
    updatedAt: new Date("2026-08-18T09:00:00.000Z"),
    ...overrides,
  } as unknown as CostConfirmation;
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    tripId: TRIP_ID,
    pdfDocumentId: "pdf-2",
    ccNumber: "4132482",
    costCode: "WAIT",
    amount: "25.00",
    currency: "EUR",
    receivedAt: new Date("2026-08-18T09:00:00.000Z"),
    ...overrides,
  };
}

describe("CostConfirmationService", () => {
  let repository: {
    create: jest.Mock;
    findByTrip: jest.Mock;
    findForTrips: jest.Mock;
  };
  let service: CostConfirmationService;

  beforeEach(() => {
    repository = {
      create: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve(buildRow(data as Partial<CostConfirmation>)),
      ),
      findByTrip: jest.fn().mockResolvedValue(null),
      findForTrips: jest.fn().mockResolvedValue([]),
    };

    service = new CostConfirmationService(
      repository as unknown as CostConfirmationRepository,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("a Trip with no confirmation", () => {
    it("records it", async () => {
      const result = await service.record(command());

      expect(result.outcome).toBe("RECORDED");
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it("writes exactly what the document stated", async () => {
      await service.record(command());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: TRIP_ID,
          ccNumber: "4132482",
          costCode: "WAIT",
          amount: "25.00",
          currency: "EUR",
        }),
      );
    });
  });

  describe("the same confirmation again", () => {
    beforeEach(() => {
      repository.findByTrip.mockResolvedValue(buildRow());
    });

    it("is reported as already recorded", async () => {
      const result = await service.record(command());

      expect(result.outcome).toBe("ALREADY_RECORDED");
    });

    it("writes nothing a second time", async () => {
      await service.record(command());

      expect(repository.create).not.toHaveBeenCalled();
    });

    /** A second arrival of one message is ordinary, not an error. */
    it("returns the confirmation that already exists", async () => {
      const result = await service.record(command());

      expect(result.confirmation?.ccNumber).toBe("4132482");
    });
  });

  describe("a different confirmation for the same Trip", () => {
    beforeEach(() => {
      repository.findByTrip.mockResolvedValue(buildRow());
    });

    it("is refused", async () => {
      const result = await service.record(command({ ccNumber: "4139511" }));

      expect(result.outcome).toBe("CC_ALREADY_EXISTS");
    });

    it("creates no second confirmation", async () => {
      await service.record(command({ ccNumber: "4139511" }));

      expect(repository.create).not.toHaveBeenCalled();
    });

    /** The first one stands: not replaced, not summed, not adjusted. */
    it("leaves the existing confirmation authoritative", async () => {
      const result = await service.record(
        command({ ccNumber: "4139511", amount: "96.25" }),
      );

      expect(result.confirmation?.ccNumber).toBe("4132482");
      expect(result.confirmation?.amount.toFixed(2)).toBe("25.00");
    });
  });

  describe("what the service does not offer", () => {
    /**
     * There is no update and no delete, and that is the design: a confirmation
     * is somebody else's statement. A method to change one would be a way to
     * claim Eucon said something it did not.
     */
    it("exposes no way to change or remove a confirmation", () => {
      const methods = Object.getOwnPropertyNames(
        CostConfirmationService.prototype,
      );

      expect(methods).not.toContain("update");
      expect(methods).not.toContain("delete");
      expect(methods).not.toContain("remove");
      expect(methods).not.toContain("replace");
    });
  });

  describe("reading a page of Trips", () => {
    it("returns at most one confirmation per Trip", async () => {
      repository.findForTrips.mockResolvedValue([
        buildRow({ tripId: "trip-1", ccNumber: "4132482" }),
        buildRow({ id: "cc-2", tripId: "trip-2", ccNumber: "4139511" }),
      ]);

      const byTrip = await service.findForTrips(["trip-1", "trip-2"]);

      expect(byTrip.get("trip-1")?.ccNumber).toBe("4132482");
      expect(byTrip.get("trip-2")?.ccNumber).toBe("4139511");
      expect(byTrip.size).toBe(2);
    });

    it("has no entry for a Trip with none", async () => {
      const byTrip = await service.findForTrips(["trip-1"]);

      expect(byTrip.get("trip-1")).toBeUndefined();
    });

    /** Money leaves as a fixed-2 string; a JSON number would be a float. */
    it("returns the amount as a string", async () => {
      repository.findForTrips.mockResolvedValue([buildRow()]);

      const byTrip = await service.findForTrips([TRIP_ID]);

      expect(byTrip.get(TRIP_ID)?.amount).toBe("25.00");
      expect(typeof byTrip.get(TRIP_ID)?.amount).toBe("string");
    });
  });
});
