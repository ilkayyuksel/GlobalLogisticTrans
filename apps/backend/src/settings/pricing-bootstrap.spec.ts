import { SettingValueType } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  PRICING_SETTINGS_CATEGORY,
  PricingSettingKey,
} from "../pricing-engine/pricing-settings";
import { PricingBootstrapService } from "./pricing-bootstrap.service";
import {
  PRICING_CATEGORY,
  PRICING_SETTING_CATALOG,
} from "./pricing-settings.catalog";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

/**
 * Bringing an unconfigured database to the point where pricing can run.
 *
 * ── THE STATE THIS IS ABOUT ─────────────────────────────────────────────────
 * A fresh deployment has migrations but no pricing settings — the seed
 * deliberately writes none. The Engine then refuses every calculation, no
 * snapshot is written, and the pricing screen is empty. Nothing in the
 * application could fix it, because a setting could only be edited and never
 * created.
 *
 * These tests hold the fix to its two promises: it creates only what is
 * genuinely missing, and it never invents a value it cannot know.
 * ────────────────────────────────────────────────────────────────────────────
 */

function storedSetting(key: string, value: string, isActive = true) {
  return {
    id: `setting-${key}`,
    category: PRICING_CATEGORY,
    key,
    value,
    valueType: SettingValueType.STRING,
    description: "",
    defaultValue: null,
    isActive,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("the pricing settings catalog", () => {
  /**
   * ── THE CATALOG AND THE ENGINE MUST NOT DRIFT ─────────────────────────────
   * The catalog spells the keys out rather than importing `PricingSettingKey`,
   * because the Engine already depends on Settings and importing back would
   * close a cycle — the same reason `setting-value-bounds.ts` spells them out.
   *
   * Duplication forced by a dependency direction is fine only while something
   * binds the two copies together. This is that something: a key added to the
   * Engine and forgotten here would leave a fresh database unbootstrappable and
   * pricing broken, with no other test noticing.
   */
  it("covers exactly the keys the Pricing Engine reads", () => {
    expect(PRICING_SETTING_CATALOG.map((setting) => setting.key).sort()).toEqual(
      Object.values(PricingSettingKey).sort(),
    );
  });

  it("uses the Engine's own category", () => {
    expect(PRICING_CATEGORY).toBe(PRICING_SETTINGS_CATEGORY);
  });

  /**
   * The one value that is an id in the database it lives in. A default here
   * would be a UUID from another environment, pointing at nothing — or worse,
   * at some unrelated property, silently charging the wrong amount.
   */
  it("carries no default for the automatic property id", () => {
    const automatic = PRICING_SETTING_CATALOG.find(
      (setting) => setting.key === PricingSettingKey.AUTOMATIC_CUSTOM_PROPERTY_ID,
    );

    expect(automatic?.defaultValue).toBeNull();
  });

  it("carries a default for every other setting", () => {
    for (const setting of PRICING_SETTING_CATALOG) {
      if (setting.key === PricingSettingKey.AUTOMATIC_CUSTOM_PROPERTY_ID) {
        continue;
      }

      expect(setting.defaultValue).not.toBeNull();
    }
  });

  /** The verified working configuration, transcribed rather than invented. */
  it.each([
    ["PRICING_STRATEGY", "ROUTE_BASED"],
    ["FUEL_PERCENTAGE", "15"],
    ["COMBINATION_SURCHARGE", "50.00"],
    ["WAITING_TIME_FREE_MINUTES", "120"],
    ["WAITING_TIME_THRESHOLD_MINUTES", "150"],
    ["WAITING_TIME_BLOCK_MINUTES", "15"],
    ["WAITING_TIME_BLOCK_PRICE", "13.75"],
    ["DISTANCE_RATE_PER_KM", "2.75"],
    ["PRICING_RULE_VERSION", "2026.1"],
  ])("proposes %s = %s", (key, value) => {
    expect(
      PRICING_SETTING_CATALOG.find((setting) => setting.key === key)
        ?.defaultValue,
    ).toBe(value);
  });
});

describe("PricingBootstrapService", () => {
  let settings: { upsert: jest.Mock };
  let repository: { findMany: jest.Mock };
  let customProperties: { findActiveByName: jest.Mock };
  let service: PricingBootstrapService;

  beforeEach(() => {
    settings = { upsert: jest.fn().mockResolvedValue({}) };
    repository = { findMany: jest.fn().mockResolvedValue([]) };
    customProperties = {
      findActiveByName: jest.fn().mockResolvedValue({ id: TAR_ID }),
    };

    service = new PricingBootstrapService(
      settings as unknown as SettingsService,
      repository as unknown as SettingsRepository,
      customProperties as unknown as CustomPropertyService,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("on a database with no pricing settings at all", () => {
    it("reports every required setting as missing", async () => {
      const plan = await service.plan();

      expect(plan.missingCount).toBe(PRICING_SETTING_CATALOG.length);
      expect(plan.settings.every((setting) => !setting.isConfigured)).toBe(true);
    });

    /** The report an operator reads BEFORE anything is written. */
    it("says what each one would be created with", async () => {
      const plan = await service.plan();
      const fuel = plan.settings.find(
        (setting) => setting.key === "FUEL_PERCENTAGE",
      );

      expect(fuel).toMatchObject({
        value: null,
        isConfigured: false,
        proposedValue: "15",
        blockedReason: null,
      });
    });

    it("writes nothing while planning", async () => {
      await service.plan();

      expect(settings.upsert).not.toHaveBeenCalled();
    });

    it("creates them all when applied", async () => {
      await service.apply();

      expect(settings.upsert).toHaveBeenCalledTimes(
        PRICING_SETTING_CATALOG.length,
      );
      expect(settings.upsert).toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "PRICING_STRATEGY",
        { value: "ROUTE_BASED" },
      );
    });

    /** Resolved from THIS database, by name, never carried in the code. */
    it("resolves the automatic property's id from the database", async () => {
      await service.apply();

      expect(customProperties.findActiveByName).toHaveBeenCalledWith("TAR");
      expect(settings.upsert).toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "AUTOMATIC_CUSTOM_PROPERTY_ID",
        { value: TAR_ID },
      );
    });
  });

  /**
   * ── IT NEVER OVERWRITES ───────────────────────────────────────────────────
   * A configured setting is somebody's decision, including one that differs
   * from the catalog. Bootstrapping is for the state where no decision exists.
   */
  describe("on a database that is already configured", () => {
    beforeEach(() => {
      repository.findMany.mockResolvedValue(
        PRICING_SETTING_CATALOG.map((setting) =>
          storedSetting(setting.key, setting.defaultValue ?? TAR_ID),
        ),
      );
    });

    it("reports nothing missing", async () => {
      const plan = await service.plan();

      expect(plan.missingCount).toBe(0);
      expect(plan.creatableCount).toBe(0);
    });

    it("writes nothing when applied", async () => {
      await service.apply();

      expect(settings.upsert).not.toHaveBeenCalled();
    });

    it("leaves an operator's own value alone", async () => {
      repository.findMany.mockResolvedValue([
        storedSetting("FUEL_PERCENTAGE", "22"),
      ]);

      await service.apply();

      expect(settings.upsert).not.toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "FUEL_PERCENTAGE",
        expect.anything(),
      );
    });

    /**
     * An inactive row EXISTS. Treating it as missing would create a second row
     * for the same key — which the unique index would refuse, and which would
     * be the wrong intent anyway: somebody switched it off deliberately.
     */
    it("treats an inactive setting as existing rather than missing", async () => {
      repository.findMany.mockResolvedValue([
        storedSetting("FUEL_PERCENTAGE", "15", false),
      ]);

      await service.apply();

      expect(settings.upsert).not.toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "FUEL_PERCENTAGE",
        expect.anything(),
      );
    });
  });

  /** Running it twice is running it once. */
  it("is idempotent", async () => {
    await service.apply();

    const firstPass = settings.upsert.mock.calls.length;

    repository.findMany.mockResolvedValue(
      PRICING_SETTING_CATALOG.map((setting) =>
        storedSetting(setting.key, setting.defaultValue ?? TAR_ID),
      ),
    );
    settings.upsert.mockClear();

    await service.apply();

    expect(firstPass).toBe(PRICING_SETTING_CATALOG.length);
    expect(settings.upsert).not.toHaveBeenCalled();
  });

  /**
   * ── AND IT NEVER INVENTS AN ID ────────────────────────────────────────────
   * A database with no TAR property cannot have that setting filled in. The
   * honest answer is to say so and create the other nine, not to write a UUID
   * that points at nothing.
   */
  describe("when the automatic property does not exist", () => {
    beforeEach(() => {
      customProperties.findActiveByName.mockResolvedValue(null);
    });

    it("reports it as blocked, with a reason", async () => {
      const plan = await service.plan();
      const automatic = plan.settings.find(
        (setting) => setting.key === "AUTOMATIC_CUSTOM_PROPERTY_ID",
      );

      expect(automatic?.proposedValue).toBeNull();
      expect(automatic?.blockedReason).toMatch(/TAR/);
      expect(plan.blockedCount).toBe(1);
    });

    it("creates the others anyway", async () => {
      await service.apply();

      expect(settings.upsert).toHaveBeenCalledTimes(
        PRICING_SETTING_CATALOG.length - 1,
      );
      expect(settings.upsert).not.toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "AUTOMATIC_CUSTOM_PROPERTY_ID",
        expect.anything(),
      );
    });

    it("still reports it as missing afterwards", async () => {
      const applied = await service.apply();

      expect(applied.blockedCount).toBe(1);
    });
  });

  /**
   * It holds no Engine, no Trip service and no snapshot writer, so no
   * historical Trip can be repriced by bootstrapping configuration.
   */
  it("has no route to a Trip or to the Pricing Engine", () => {
    expect(Object.keys(service as unknown as object)).toEqual([
      "settings",
      "repository",
      "customProperties",
      "logger",
    ]);
  });
});
