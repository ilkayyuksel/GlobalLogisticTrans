import { Prisma, PricingCalculationStatus, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  TRIP_CLOSED_EVENT,
  TripClosedEvent,
} from "../trips/events/trip-closed.event";
import {
  MissingPricingSettingException,
  MissingRouteCostException,
  TripNotPriceableException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingEngineService } from "./pricing-engine.service";
import { TripClosedPricingListener } from "./trip-closed-pricing.listener";

const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const CALCULATION_RESULT = {
  tripId: TRIP_ID,
  isReprocess: false,
  lines: [{ amount: new Prisma.Decimal("380.00") }],
  totalPrice: new Prisma.Decimal("380.00"),
  calculationStatus: PricingCalculationStatus.CALCULATED,
};

describe("TripClosedPricingListener", () => {
  let eventBus: { subscribe: jest.Mock; publish: jest.Mock };
  let pricingEngine: { calculateAndStore: jest.Mock; reprocess: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let listener: TripClosedPricingListener;

  /** The handler the listener registered, as the bus would invoke it. */
  function registeredHandler(): (event: TripClosedEvent) => Promise<void> {
    return eventBus.subscribe.mock.calls[0][1];
  }

  beforeEach(() => {
    eventBus = { subscribe: jest.fn(), publish: jest.fn() };
    pricingEngine = {
      calculateAndStore: jest.fn().mockResolvedValue(CALCULATION_RESULT),
      reprocess: jest.fn(),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    listener = new TripClosedPricingListener(
      eventBus as unknown as DomainEventBus,
      pricingEngine as unknown as PricingEngineService,
      logger as unknown as AppLoggerService,
    );
    listener.onModuleInit();
  });

  describe("subscription", () => {
    it("subscribes to TripClosed on start-up", () => {
      expect(eventBus.subscribe).toHaveBeenCalledTimes(1);
      expect(eventBus.subscribe.mock.calls[0][0]).toBe(TRIP_CLOSED_EVENT);
    });

    it("never publishes anything of its own", async () => {
      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe("a Trip that can be priced", () => {
    it("calculates and stores the snapshot", async () => {
      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      expect(pricingEngine.calculateAndStore).toHaveBeenCalledWith(TRIP_ID);
      expect(pricingEngine.calculateAndStore).toHaveBeenCalledTimes(1);
    });

    /**
     * A Trip that has just closed is normally being priced for the first time,
     * and reprocess would refuse that. calculateAndStore also covers the repeat
     * case, which is what makes a duplicated event harmless.
     */
    it("never calls reprocess", async () => {
      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      expect(pricingEngine.reprocess).not.toHaveBeenCalled();
    });

    it("stays harmless when the same event arrives twice", async () => {
      const handler = registeredHandler();
      const closed = new TripClosedEvent(TRIP_ID);

      await handler(closed);
      await handler(closed);
      await handler(closed);

      // Three calls to one idempotent operation: the snapshot is replaced
      // atomically each time, so the database still holds exactly one.
      expect(pricingEngine.calculateAndStore).toHaveBeenCalledTimes(3);
      expect(
        pricingEngine.calculateAndStore.mock.calls.every(
          ([tripId]) => tripId === TRIP_ID,
        ),
      ).toBe(true);
    });

    it("logs the outcome with identifiers and counts only", async () => {
      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      expect(logger.log).toHaveBeenCalledWith("Automatic pricing completed", {
        eventName: TRIP_CLOSED_EVENT,
        tripId: TRIP_ID,
        isReprocess: false,
        lineCount: 1,
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("380.00");
    });
  });

  /**
   * The Trip is already CLOSED and committed. A pricing problem cannot un-close
   * it, so nothing may escape this handler.
   */
  describe("a Trip that cannot be priced", () => {
    it.each([
      [
        "a missing route cost",
        new MissingRouteCostException(TRIP_ID, "component-toll", "A", "B"),
        "PRICING_MISSING_ROUTE_COST",
      ],
      [
        "an unusable Setting",
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
        "PRICING_MISSING_SETTING",
      ],
      [
        "a Trip that is not priceable",
        new TripNotPriceableException(
          TRIP_ID,
          TripStatus.OPEN,
          TripStatus.CLOSED,
        ),
        "PRICING_TRIP_NOT_CLOSED",
      ],
    ])("swallows %s but logs its code", async (_case, failure, code) => {
      pricingEngine.calculateAndStore.mockRejectedValue(failure);

      await expect(
        registeredHandler()(new TripClosedEvent(TRIP_ID)),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Automatic pricing could not price the Trip",
        {
          eventName: TRIP_CLOSED_EVENT,
          tripId: TRIP_ID,
          pricingErrorCode: code,
        },
      );
    });

    it("never rethrows, so the Trip cannot be reopened by a pricing failure", async () => {
      pricingEngine.calculateAndStore.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      await expect(
        registeredHandler()(new TripClosedEvent(TRIP_ID)),
      ).resolves.toBeUndefined();
    });

    it("logs an unexpected failure as an error rather than a warning", async () => {
      pricingEngine.calculateAndStore.mockRejectedValue(
        new Error("database on fire"),
      );

      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      expect(logger.error).toHaveBeenCalledWith(
        "Automatic pricing failed unexpectedly",
        {
          eventName: TRIP_CLOSED_EVENT,
          tripId: TRIP_ID,
          reason: "database on fire",
        },
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("swallows an unexpected failure too", async () => {
      pricingEngine.calculateAndStore.mockRejectedValue(new Error("boom"));

      await expect(
        registeredHandler()(new TripClosedEvent(TRIP_ID)),
      ).resolves.toBeUndefined();
    });

    it("never logs an amount when reporting a failure", async () => {
      pricingEngine.calculateAndStore.mockRejectedValue(
        new MissingRouteCostException(TRIP_ID, "component-toll", "A", "B"),
      );

      await registeredHandler()(new TripClosedEvent(TRIP_ID));

      const logged = JSON.stringify([
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]);

      expect(logged).not.toMatch(/\d+\.\d{2}/);
    });
  });

  it("adapts, and does nothing else", () => {
    const source = TripClosedPricingListener.prototype.constructor.toString();

    // No validation, no calculation, no persistence, and no HTTP. The status
    // check belongs to the Engine, so no TripStatus is consulted here.
    expect(source).not.toContain("TripStatus");
    expect(source).not.toContain("Decimal");
    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("HttpException");
    expect(source).not.toContain("prisma");
  });
});
