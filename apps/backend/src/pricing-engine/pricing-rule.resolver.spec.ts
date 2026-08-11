import { NotFoundException } from "@nestjs/common";
import { SettingValueType } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { SettingResponseDto } from "../settings/dto/setting-response.dto";
import { SettingsService } from "../settings/settings.service";
import {
  InvalidPricingSettingException,
  MissingPricingSettingException,
  UnsupportedPricingStrategyException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import {
  PRICING_SETTINGS_CATEGORY,
  PricingSettingKey,
  PricingStrategy,
} from "./pricing-settings";

/** The seeded pricing configuration, as SettingsService would return it. */
const SEEDED_VALUES: Record<string, string> = {
  [PricingSettingKey.STRATEGY]: PricingStrategy.ROUTE_BASED,
  [PricingSettingKey.FUEL_PERCENTAGE]: "15",
  [PricingSettingKey.COMBINATION_SURCHARGE]: "75",
  [PricingSettingKey.WAITING_TIME_FREE_MINUTES]: "60",
  [PricingSettingKey.WAITING_TIME_BLOCK_MINUTES]: "30",
  [PricingSettingKey.DISTANCE_RATE_PER_KM]: "1.85",
};

function buildSetting(
  key: string,
  overrides: Partial<SettingResponseDto> = {},
): SettingResponseDto {
  return {
    id: `setting-${key}`,
    category: PRICING_SETTINGS_CATEGORY,
    key,
    value: SEEDED_VALUES[key] ?? "",
    valueType: SettingValueType.STRING,
    description: "",
    defaultValue: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("PricingRuleResolver", () => {
  let settingsService: { findOne: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let resolver: PricingRuleResolver;

  /** Overrides one seeded setting; everything else resolves normally. */
  function overrideSetting(
    key: string,
    overrides: Partial<SettingResponseDto> | null,
  ): void {
    settingsService.findOne.mockImplementation(
      async (_category: string, requestedKey: string) => {
        if (requestedKey === key) {
          if (overrides === null) {
            throw new NotFoundException();
          }

          return buildSetting(requestedKey, overrides);
        }

        return buildSetting(requestedKey);
      },
    );
  }

  beforeEach(() => {
    settingsService = {
      findOne: jest
        .fn()
        .mockImplementation(async (_category: string, key: string) =>
          buildSetting(key),
        ),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    resolver = new PricingRuleResolver(
      settingsService as unknown as SettingsService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("resolve", () => {
    it("reads every rule from the PRICING settings category", async () => {
      const rules = await resolver.resolve();

      expect(rules).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        fuelPercentage: "15",
        combinationSurcharge: "75",
        waitingTimeFreeMinutes: 60,
        waitingTimeBlockMinutes: 30,
      });
    });

    it("asks Settings for each documented key, in the PRICING category", async () => {
      await resolver.resolve();

      const requested = settingsService.findOne.mock.calls.map(
        ([category, key]: [string, string]) => `${category}.${key}`,
      );

      expect(requested).toEqual([
        `${PRICING_SETTINGS_CATEGORY}.${PricingSettingKey.STRATEGY}`,
        `${PRICING_SETTINGS_CATEGORY}.${PricingSettingKey.FUEL_PERCENTAGE}`,
        `${PRICING_SETTINGS_CATEGORY}.${PricingSettingKey.COMBINATION_SURCHARGE}`,
        `${PRICING_SETTINGS_CATEGORY}.${PricingSettingKey.WAITING_TIME_FREE_MINUTES}`,
        `${PRICING_SETTINGS_CATEGORY}.${PricingSettingKey.WAITING_TIME_BLOCK_MINUTES}`,
      ]);
    });

    it("never reads the distance rate for a route-based system", async () => {
      await resolver.resolve();

      const requested = settingsService.findOne.mock.calls.map(
        ([, key]: [string, string]) => key,
      );

      expect(requested).not.toContain(PricingSettingKey.DISTANCE_RATE_PER_KM);
    });

    it("keeps decimals as exact strings rather than floats", async () => {
      overrideSetting(PricingSettingKey.FUEL_PERCENTAGE, { value: "15.50" });

      const rules = await resolver.resolve();

      expect(rules.fuelPercentage).toBe("15.50");
      expect(typeof rules.fuelPercentage).toBe("string");
    });

    it("parses whole minute counts as numbers", async () => {
      const rules = await resolver.resolve();

      expect(typeof rules.waitingTimeFreeMinutes).toBe("number");
      expect(typeof rules.waitingTimeBlockMinutes).toBe("number");
    });

    it("trims a padded setting value", async () => {
      overrideSetting(PricingSettingKey.COMBINATION_SURCHARGE, {
        value: "  75.00  ",
      });

      expect((await resolver.resolve()).combinationSurcharge).toBe("75.00");
    });

    it.each([
      PricingSettingKey.STRATEGY,
      PricingSettingKey.FUEL_PERCENTAGE,
      PricingSettingKey.COMBINATION_SURCHARGE,
      PricingSettingKey.WAITING_TIME_FREE_MINUTES,
      PricingSettingKey.WAITING_TIME_BLOCK_MINUTES,
    ])("fails when %s is missing", async (key) => {
      overrideSetting(key, null);

      await expect(resolver.resolve()).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
    });

    it("names the missing key in the failure, but never a value", async () => {
      overrideSetting(PricingSettingKey.FUEL_PERCENTAGE, null);

      await expect(resolver.resolve()).rejects.toMatchObject({
        settingKey: PricingSettingKey.FUEL_PERCENTAGE,
        category: PRICING_SETTINGS_CATEGORY,
      });
    });

    it.each([
      PricingSettingKey.STRATEGY,
      PricingSettingKey.FUEL_PERCENTAGE,
      PricingSettingKey.WAITING_TIME_FREE_MINUTES,
    ])("treats an inactive %s as missing", async (key) => {
      // database_schema.md §7.2: the application ignores inactive Settings.
      overrideSetting(key, { isActive: false });

      await expect(resolver.resolve()).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
    });

    it.each(["abc", "", "15.555", "1e3", "15%"])(
      "rejects the unusable decimal %p",
      async (value) => {
        overrideSetting(PricingSettingKey.FUEL_PERCENTAGE, { value });

        await expect(resolver.resolve()).rejects.toBeInstanceOf(
          InvalidPricingSettingException,
        );
      },
    );

    it.each(["-1", "1.5", "abc", ""])(
      "rejects the unusable minute count %p",
      async (value) => {
        overrideSetting(PricingSettingKey.WAITING_TIME_FREE_MINUTES, { value });

        await expect(resolver.resolve()).rejects.toBeInstanceOf(
          InvalidPricingSettingException,
        );
      },
    );

    it("accepts a zero free period, which disables the free allowance", async () => {
      overrideSetting(PricingSettingKey.WAITING_TIME_FREE_MINUTES, {
        value: "0",
      });

      expect((await resolver.resolve()).waitingTimeFreeMinutes).toBe(0);
    });

    it.each(["ROUTE", "route_based", "FIXED_PRICE", ""])(
      "rejects the unsupported strategy %p",
      async (value) => {
        overrideSetting(PricingSettingKey.STRATEGY, { value });

        await expect(resolver.resolve()).rejects.toBeInstanceOf(
          UnsupportedPricingStrategyException,
        );
      },
    );

    it("accepts the distance-based strategy", async () => {
      overrideSetting(PricingSettingKey.STRATEGY, {
        value: PricingStrategy.DISTANCE_BASED,
      });

      expect((await resolver.resolve()).strategy).toBe(
        PricingStrategy.DISTANCE_BASED,
      );
    });

    it("rethrows an unexpected Settings failure untouched", async () => {
      const failure = new Error("database unavailable");
      settingsService.findOne.mockRejectedValue(failure);

      await expect(resolver.resolve()).rejects.toBe(failure);
    });

    it("caches nothing, so a changed Setting takes effect immediately", async () => {
      await resolver.resolve();
      await resolver.resolve();

      // Five keys, read again on the second call.
      expect(settingsService.findOne).toHaveBeenCalledTimes(10);
    });
  });

  describe("resolveDistanceRatePerKm", () => {
    it("reads the distance rate", async () => {
      expect(await resolver.resolveDistanceRatePerKm()).toBe("1.85");
    });

    it("fails when the rate is not configured", async () => {
      overrideSetting(PricingSettingKey.DISTANCE_RATE_PER_KM, null);

      await expect(resolver.resolveDistanceRatePerKm()).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
    });
  });

  it("never logs a setting value", async () => {
    overrideSetting(PricingSettingKey.FUEL_PERCENTAGE, { value: "abc" });

    await expect(resolver.resolve()).rejects.toBeInstanceOf(
      InvalidPricingSettingException,
    );

    const logged = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.log.mock.calls,
    ]);

    expect(logged).not.toContain("abc");
    expect(logged).toContain(PricingSettingKey.FUEL_PERCENTAGE);
  });
});
