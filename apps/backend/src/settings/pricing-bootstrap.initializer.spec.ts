import { AppLoggerService } from "../logger/app-logger.service";
import { PricingBootstrapInitializer } from "./pricing-bootstrap.initializer";
import {
  PricingBootstrapPlan,
  PricingBootstrapService,
} from "./pricing-bootstrap.service";

/**
 * The step that makes initialization happen without anybody remembering.
 *
 * ── WHAT WENT WRONG WITHOUT IT ──────────────────────────────────────────────
 * The bootstrap endpoint already existed and was never called. A deployment ran
 * its migrations, started, served an API that answered `pricing: null` for
 * every Trip, and reported nothing unusual — because from the schema's point of
 * view nothing was wrong.
 * ────────────────────────────────────────────────────────────────────────────
 */

function completePlan(
  overrides: Partial<PricingBootstrapPlan> = {},
): PricingBootstrapPlan {
  return {
    components: [{ code: "BASE_PRICE", isPresent: true }],
    componentsMissingCount: 0,
    automaticProperty: {
      name: "TAR",
      id: "tar-id",
      isPresent: true,
      willCreate: false,
    },
    routePricedProperties: [
      {
        name: "Toll",
        componentCode: "TOLL",
        isPresent: true,
        willCreate: false,
        blockedReason: null,
      },
    ],
    settings: [],
    missingCount: 0,
    creatableCount: 0,
    blockedCount: 0,
    ...overrides,
  };
}

describe("PricingBootstrapInitializer", () => {
  let bootstrap: { apply: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let initializer: PricingBootstrapInitializer;

  beforeEach(() => {
    bootstrap = { apply: jest.fn().mockResolvedValue(completePlan()) };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    initializer = new PricingBootstrapInitializer(
      bootstrap as unknown as PricingBootstrapService,
      logger as unknown as AppLoggerService,
    );
  });

  it("ensures the pricing foundation as the application starts", async () => {
    await initializer.onApplicationBootstrap();

    expect(bootstrap.apply).toHaveBeenCalledTimes(1);
  });

  it("says so when everything is in place", async () => {
    await initializer.onApplicationBootstrap();

    expect(logger.log).toHaveBeenCalledWith(
      "Pricing foundation verified at startup",
      expect.objectContaining({ automaticPropertyPresent: true }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * A gap that survives the run is one an operator has to decide about — a
   * setting they switched off. Warning is the whole point: the state that
   * caused this work was silent.
   */
  it("warns loudly when something is still missing afterwards", async () => {
    bootstrap.apply.mockResolvedValue(
      completePlan({ missingCount: 1, blockedCount: 1 }),
    );

    await initializer.onApplicationBootstrap();

    expect(logger.warn).toHaveBeenCalledWith(
      "Pricing configuration is still incomplete",
      expect.objectContaining({ settingsMissing: 1, blocked: 1 }),
    );
  });

  it("warns when the catalog could not be completed", async () => {
    bootstrap.apply.mockResolvedValue(
      completePlan({ componentsMissingCount: 2 }),
    );

    await initializer.onApplicationBootstrap();

    expect(logger.warn).toHaveBeenCalledWith(
      "Pricing configuration is still incomplete",
      expect.objectContaining({ componentsMissing: 2 }),
    );
  });

  /**
   * ── A FAILURE HERE MUST NOT STOP THE API ──────────────────────────────────
   * Two replicas starting together race for the same rows and one of them loses
   * on a unique index, having done no harm. Refusing to serve any request
   * because of that would turn a configuration hiccup into an outage.
   */
  describe("when initialization fails", () => {
    beforeEach(() => {
      bootstrap.apply.mockRejectedValue(new Error("unique constraint"));
    });

    it("does not prevent the application from starting", async () => {
      await expect(
        initializer.onApplicationBootstrap(),
      ).resolves.toBeUndefined();
    });

    it("logs the reason as an error", async () => {
      await initializer.onApplicationBootstrap();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Pricing initialization failed at startup"),
        expect.objectContaining({ reason: "unique constraint" }),
      );
    });
  });
});
