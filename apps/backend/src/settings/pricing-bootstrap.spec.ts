import { SettingValueType } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  PRICING_SETTINGS_CATEGORY,
  PricingSettingKey,
} from "../pricing-engine/pricing-settings";
import { PricingBootstrapService } from "./pricing-bootstrap.service";
import { PRICING_COMPONENT_CATALOG } from "./pricing-component.catalog";
import { PricingComponentRepository } from "./pricing-component.repository";
import {
  AUTOMATIC_CUSTOM_PROPERTY_DEFAULT_PRICE,
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
  let customProperties: { findActiveByName: jest.Mock; create: jest.Mock };
  let components: { findActiveCodes: jest.Mock; createMany: jest.Mock };
  let service: PricingBootstrapService;

  /*
   * The two doubles below are STATEFUL on purpose. Bootstrapping re-reads the
   * database between its steps — it has to, because creating the TAR property
   * is what produces the id the last step must store — and a double that
   * answered the same way before and after a write could not show that the
   * sequence works.
   */
  let storedProperty: { id: string; name: string } | null;
  let storedCodes: string[];

  beforeEach(() => {
    // A fresh database: no property, no catalog, no settings.
    storedProperty = null;
    storedCodes = [];

    settings = { upsert: jest.fn().mockResolvedValue({}) };
    repository = { findMany: jest.fn().mockResolvedValue([]) };

    customProperties = {
      findActiveByName: jest.fn(() => Promise.resolve(storedProperty)),
      create: jest.fn((dto: { name: string }) => {
        storedProperty = { id: TAR_ID, name: dto.name };

        return Promise.resolve(storedProperty);
      }),
    };

    components = {
      findActiveCodes: jest.fn(() => Promise.resolve([...storedCodes])),
      createMany: jest.fn((rows: readonly { code: string }[]) => {
        storedCodes = [...storedCodes, ...rows.map((row) => row.code)];

        return Promise.resolve({ count: rows.length });
      }),
    };

    service = new PricingBootstrapService(
      settings as unknown as SettingsService,
      repository as unknown as SettingsRepository,
      customProperties as unknown as CustomPropertyService,
      components as unknown as PricingComponentRepository,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  /** Everything already there. Used by the "changes nothing" cases. */
  function databaseIsFullyConfigured(): void {
    storedProperty = { id: TAR_ID, name: "TAR" };
    storedCodes = PRICING_COMPONENT_CATALOG.map((component) => component.code);
    repository.findMany.mockResolvedValue(
      PRICING_SETTING_CATALOG.map((setting) =>
        storedSetting(setting.key, setting.defaultValue ?? TAR_ID),
      ),
    );
  }

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
      databaseIsFullyConfigured();
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

  /**
   * ── RUNNING IT TWICE IS RUNNING IT ONCE ───────────────────────────────────
   * This is what makes it safe on every boot. The second pass sees the state
   * the first one left and writes nothing at all — not a component, not the
   * property, not a setting.
   */
  it("is idempotent across all three layers", async () => {
    await service.apply();

    const componentsFirstPass = components.createMany.mock.calls.length;
    const propertiesFirstPass = customProperties.create.mock.calls.length;
    const settingsFirstPass = settings.upsert.mock.calls.length;

    // The settings double is the one part that cannot update itself.
    repository.findMany.mockResolvedValue(
      PRICING_SETTING_CATALOG.map((setting) =>
        storedSetting(setting.key, setting.defaultValue ?? TAR_ID),
      ),
    );
    components.createMany.mockClear();
    customProperties.create.mockClear();
    settings.upsert.mockClear();

    await service.apply();

    expect(componentsFirstPass).toBe(1);
    expect(propertiesFirstPass).toBe(1);
    expect(settingsFirstPass).toBe(PRICING_SETTING_CATALOG.length);

    expect(components.createMany).not.toHaveBeenCalled();
    expect(customProperties.create).not.toHaveBeenCalled();
    expect(settings.upsert).not.toHaveBeenCalled();
  });

  /**
   * ── THE CATALOG EVERY PRICING ITEM POINTS AT ──────────────────────────────
   * A calculated breakdown cannot be STORED without it. This is the layer whose
   * absence made a deployed database answer `pricing: null` for every Trip
   * while the Engine was working perfectly.
   */
  describe("the pricing component catalog", () => {
    it("reports every component as absent on a fresh database", async () => {
      const plan = await service.plan();

      expect(plan.componentsMissingCount).toBe(
        PRICING_COMPONENT_CATALOG.length,
      );
      expect(plan.components.every((component) => !component.isPresent)).toBe(
        true,
      );
    });

    it("writes nothing while planning", async () => {
      await service.plan();

      expect(components.createMany).not.toHaveBeenCalled();
    });

    it("creates the whole catalog when applied", async () => {
      const applied = await service.apply();

      expect(components.createMany).toHaveBeenCalledTimes(1);
      expect(storedCodes.sort()).toEqual(
        PRICING_COMPONENT_CATALOG.map((component) => component.code).sort(),
      );
      expect(applied.componentsMissingCount).toBe(0);
    });

    it("gives each one its catalog name, description and position", async () => {
      await service.apply();

      expect(components.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          {
            code: "BASE_PRICE",
            name: "Base Price",
            description: expect.stringContaining("Base transport price"),
            displayOrder: 1,
          },
        ]),
      );
    });

    /** The state the real database was found in: one component, eight absent. */
    it("creates only the components that are absent", async () => {
      storedCodes = ["COST_CONFIRMATION"];

      await service.apply();

      const created = (
        components.createMany.mock.calls[0]?.[0] as { code: string }[]
      ).map((row) => row.code);

      expect(created).toHaveLength(PRICING_COMPONENT_CATALOG.length - 1);
      expect(created).not.toContain("COST_CONFIRMATION");
    });

    it("touches nothing when the catalog is already complete", async () => {
      databaseIsFullyConfigured();

      await service.apply();

      expect(components.createMany).not.toHaveBeenCalled();
    });

    /**
     * A deactivated component is somebody's decision. Reported as absent so an
     * operator sees it, but never reactivated behind their back — and the code
     * is recreated as a new active row, which is what the partial unique index
     * on (code) WHERE is_active permits.
     */
    it("does not count an inactive component as present", async () => {
      storedCodes = [];

      const plan = await service.plan();

      expect(
        plan.components.find((component) => component.code === "TOLL")
          ?.isPresent,
      ).toBe(false);
    });
  });

  /**
   * ── THE PROPERTY NOTHING USED TO CREATE ───────────────────────────────────
   * Not the seed, not a migration, not the API. `prisma/seed-dev.ts` makes one,
   * but that is development-only fake data. So every fresh deployment had no
   * TAR, `AUTOMATIC_CUSTOM_PROPERTY_ID` could not be resolved, and the Engine
   * refused with PRICING_MISSING_SETTING.
   */
  describe("the automatic Custom Property", () => {
    it("is reported as absent, and as something bootstrapping will create", async () => {
      const plan = await service.plan();

      expect(plan.automaticProperty).toEqual({
        name: "TAR",
        id: null,
        isPresent: false,
        willCreate: true,
      });
    });

    it("writes nothing while planning", async () => {
      await service.plan();

      expect(customProperties.create).not.toHaveBeenCalled();
    });

    it("is created as an ordinary Custom Property, priced at the standing rate", async () => {
      await service.apply();

      expect(customProperties.create).toHaveBeenCalledTimes(1);
      expect(customProperties.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "TAR",
          defaultPrice: AUTOMATIC_CUSTOM_PROPERTY_DEFAULT_PRICE,
        }),
      );
      expect(AUTOMATIC_CUSTOM_PROPERTY_DEFAULT_PRICE).toBe(20);
    });

    /**
     * The sequence that makes this one operation rather than three. The setting
     * holds an id that does not exist until the step before it has run.
     */
    it("is created BEFORE the setting that points at it", async () => {
      await service.apply();

      expect(settings.upsert).toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "AUTOMATIC_CUSTOM_PROPERTY_ID",
        { value: TAR_ID },
      );
    });

    it("leaves an existing one alone, whatever it is priced at", async () => {
      storedProperty = { id: "an-existing-tar", name: "TAR" };

      await service.apply();

      expect(customProperties.create).not.toHaveBeenCalled();
      expect(settings.upsert).toHaveBeenCalledWith(
        PRICING_CATEGORY,
        "AUTOMATIC_CUSTOM_PROPERTY_ID",
        { value: "an-existing-tar" },
      );
    });

    it("never creates a second one", async () => {
      await service.apply();
      await service.apply();

      expect(customProperties.create).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * ── A FRESH DATABASE ENDS UP ABLE TO PRICE ────────────────────────────────
   * The whole point, asserted as one statement: after a single run nothing the
   * Engine requires is missing and nothing is blocked.
   */
  it("leaves a fresh database with a complete pricing foundation", async () => {
    const applied = await service.apply();

    // The settings double cannot update itself, so this is what was written.
    expect(settings.upsert).toHaveBeenCalledTimes(
      PRICING_SETTING_CATALOG.length,
    );
    expect(applied.componentsMissingCount).toBe(0);
    expect(applied.automaticProperty.isPresent).toBe(true);
    expect(applied.automaticProperty.id).toBe(TAR_ID);
    expect(applied.blockedCount).toBe(0);
  });

  /**
   * ── AND IT STILL NEVER INVENTS AN ID ──────────────────────────────────────
   * The id is resolved from THIS database, never carried in the code. What
   * changed is that a missing property is no longer a dead end: it is created
   * first, and the id recorded is the one it was actually given.
   */
  describe("planning, before the property exists", () => {
    it("proposes no value for the id it cannot yet know", async () => {
      const plan = await service.plan();
      const automatic = plan.settings.find(
        (setting) => setting.key === "AUTOMATIC_CUSTOM_PROPERTY_ID",
      );

      expect(automatic?.proposedValue).toBeNull();
    });

    /** Nothing blocks initialization any more: the run creates its own way out. */
    it("reports nothing as blocked", async () => {
      const plan = await service.plan();

      expect(plan.blockedCount).toBe(0);
    });
  });

  /**
   * "Blocked" now means the one thing bootstrapping genuinely must not do:
   * reverse somebody's decision to switch a setting off.
   */
  it("reports a deactivated setting as blocked", async () => {
    repository.findMany.mockResolvedValue([
      storedSetting("FUEL_PERCENTAGE", "15", false),
    ]);

    const plan = await service.plan();

    expect(plan.blockedCount).toBe(1);
    expect(
      plan.settings.find((setting) => setting.key === "FUEL_PERCENTAGE")
        ?.blockedReason,
    ).toMatch(/switched off/);
  });

  /**
   * It holds no Engine, no Trip service and no snapshot writer, so no
   * historical Trip can be repriced by bootstrapping configuration. Creating a
   * component, a property or a setting is configuration; producing a snapshot
   * is a different operation, and this service cannot reach it.
   */
  it("has no route to a Trip or to the Pricing Engine", () => {
    expect(Object.keys(service as unknown as object)).toEqual([
      "settings",
      "repository",
      "customProperties",
      "components",
      "logger",
    ]);
  });
});
