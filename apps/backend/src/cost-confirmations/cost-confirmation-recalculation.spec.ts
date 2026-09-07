import { CostConfirmation, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingEngineErrorCode } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DOCUMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

/**
 * Recording a Cost Confirmation reprices the Trip.
 *
 * ── WHY IT MUST ─────────────────────────────────────────────────────────────
 * The confirmed amount IS the Trip's EK line, and EK is one of the seven that
 * make up Totaal. A confirmation recorded without repricing would leave the
 * Trip's stored total describing a Trip that no longer exists.
 *
 * ── AND WHY ONLY ON A REAL WRITE ────────────────────────────────────────────
 * A Trip may hold several confirmations and is worth their sum, so every NEW
 * one reprices. The same message arriving twice writes nothing — the reference
 * is already on the Trip — and repricing it would burn a calculation to
 * produce the snapshot that is already stored.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildRow(overrides: Partial<CostConfirmation> = {}): CostConfirmation {
  return {
    id: "cc-1",
    tripId: TRIP_ID,
    pdfDocumentId: DOCUMENT_ID,
    ccNumber: "4139505",
    costCode: "WAIT",
    amount: new Prisma.Decimal("165.00"),
    currency: "EUR",
    receivedAt: new Date("2026-08-17T00:00:00Z"),
    createdAt: new Date("2026-08-17T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
    ...overrides,
  };
}

const COMMAND = {
  tripId: TRIP_ID,
  pdfDocumentId: DOCUMENT_ID,
  ccNumber: "4139505",
  costCode: "WAIT",
  amount: "165.00",
  currency: "EUR",
  receivedAt: new Date("2026-08-17T00:00:00Z"),
};

/** A breakdown carrying an EK line, as the shared effective read produces one. */
function pricingWithEk(ek: string) {
  return toEffectivePricingDto(
    resolveEffectivePricing(
      [
        {
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("520.00"),
          customPropertyId: null,
          description: "Base",
          unitPrice: null,
        },
        {
          componentCode: "COST_CONFIRMATION",
          amount: new Prisma.Decimal(ek),
          customPropertyId: null,
          description: "EK",
          unitPrice: null,
        },
      ],
      [],
    ),
  );
}

describe("recording a Cost Confirmation reprices the Trip", () => {
  let repository: {
    create: jest.Mock;
    findAllByTrip: jest.Mock;
    findForTrips: jest.Mock;
  };
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let service: CostConfirmationService;

  function serviceAnswering(
    outcome: Parameters<typeof stubPricingRecalculation>[0],
  ): CostConfirmationService {
    recalculation = stubPricingRecalculation(outcome);

    return new CostConfirmationService(
      repository as unknown as CostConfirmationRepository,
      recalculation,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  }

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(buildRow()),
      findAllByTrip: jest.fn().mockResolvedValue([]),
      findForTrips: jest.fn().mockResolvedValue([]),
    };

    service = serviceAnswering({
      pricing: pricingWithEk("165.00"),
      reasonCode: null,
    });
  });

  describe("a first confirmation", () => {
    it("writes the row before it asks for a price", async () => {
      const order: string[] = [];

      repository.create.mockImplementation(async () => {
        order.push("write");

        return buildRow();
      });
      recalculation.recalculate.mockImplementation(async () => {
        order.push("recalculate");

        return { pricing: null, reasonCode: null };
      });

      await service.record(COMMAND);

      expect(order).toEqual(["write", "recalculate"]);
    });

    it("reprices exactly the Trip it was recorded against, once", async () => {
      await service.record(COMMAND);

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    it("waits for the recalculation before it answers", async () => {
      let hasFinished = false;

      recalculation.recalculate.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        hasFinished = true;

        return { pricing: pricingWithEk("165.00"), reasonCode: null };
      });

      const result = await service.record(COMMAND);

      expect(hasFinished).toBe(true);
      expect(result.pricing?.ek).toBe("165.00");
    });

    /** The confirmed amount becomes EK, and Totaal counts it exactly once. */
    it("answers with an EK equal to the confirmed amount", async () => {
      const result = await service.record(COMMAND);

      expect(result.outcome).toBe("RECORDED");
      expect(result.pricing?.ek).toBe("165.00");
      expect(result.pricing?.totaal).toBe("685.00");
      expect(result.reasonCode).toBeNull();
    });

    it("moves Totaal with the amount when a later confirmation differs", async () => {
      service = serviceAnswering({
        pricing: pricingWithEk("200.00"),
        reasonCode: null,
      });

      const result = await service.record({ ...COMMAND, amount: "200.00" });

      expect(result.pricing?.ek).toBe("200.00");
      expect(result.pricing?.totaal).toBe("720.00");
    });
  });

  describe("a message that writes nothing", () => {
    it("does not reprice when the same confirmation arrives again", async () => {
      repository.findAllByTrip.mockResolvedValue([buildRow()]);

      const result = await service.record(COMMAND);

      expect(result.outcome).toBe("ALREADY_RECORDED");
      expect(recalculation.recalculate).not.toHaveBeenCalled();
      expect(result.pricing).toBeNull();
    });

  });

  /**
   * A SECOND, different confirmation used to be refused and repriced nothing.
   * It is recorded now — the Trip is worth the sum of its confirmations — so it
   * follows the ordinary write contract: one row, then one recalculation.
   */
  describe("a second, different confirmation", () => {
    beforeEach(() => {
      repository.findAllByTrip.mockResolvedValue([
        buildRow({ ccNumber: "4139999" }),
      ]);
    });

    it("is recorded", async () => {
      expect((await service.record(COMMAND)).outcome).toBe("RECORDED");
    });

    it("reprices the Trip exactly once", async () => {
      await service.record(COMMAND);

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    /** The row is written BEFORE the price, so the Engine reads it. */
    it("writes the row before it asks for a price", async () => {
      await service.record(COMMAND);

      expect(repository.create.mock.invocationCallOrder[0]).toBeLessThan(
        recalculation.recalculate.mock.invocationCallOrder[0],
      );
    });
  });

  /**
   * ── THE FAILURE CONTRACT ──────────────────────────────────────────────────
   * A confirmation is a statement by somebody else and it arrived. A Trip whose
   * route is not configured cannot be priced yet, and that is a configuration
   * gap to fill — never a reason to discard evidence.
   */
  describe("when the Trip cannot be priced", () => {
    beforeEach(() => {
      service = serviceAnswering({
        pricing: null,
        reasonCode: PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      });
    });

    it("keeps the confirmation", async () => {
      const result = await service.record(COMMAND);

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe("RECORDED");
      expect(result.confirmation).not.toBeNull();
    });

    it("returns no pricing and says why", async () => {
      const result = await service.record(COMMAND);

      expect(result.pricing).toBeNull();
      expect(result.reasonCode).toBe(
        PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      );
    });
  });
});
