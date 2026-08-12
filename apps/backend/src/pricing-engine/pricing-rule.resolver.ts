import { Injectable, NotFoundException } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { SettingsService } from "../settings/settings.service";
import { SettingResponseDto } from "../settings/dto/setting-response.dto";
import {
  InvalidPricingSettingException,
  MissingPricingSettingException,
  UnsupportedPricingStrategyException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingRuleConfiguration } from "./pricing-calculation-context";
import {
  PRICING_SETTINGS_CATEGORY,
  PricingSettingKey,
  PricingStrategy,
  SUPPORTED_PRICING_STRATEGIES,
  isDecimalSettingValue,
  isNonNegativeIntegerSettingValue,
  isPricingStrategy,
} from "./pricing-settings";

/**
 * Resolves the configured pricing rules from Settings.
 *
 * This resolver answers "what are the rules right now" and nothing else. It
 * does not know about a Trip, a route or a price — that separation is what lets
 * the rules be read once and applied to many Trips later.
 *
 * pricing_rules.md requires the current Settings to be read on every
 * calculation, so nothing here is cached. A Setting changed between two
 * calculations legitimately produces two different results; what must never
 * change is an already-stored snapshot.
 *
 * Setting VALUES are never logged. A fuel percentage and a combination
 * surcharge are commercial configuration; only keys appear in the log.
 */
@Injectable()
export class PricingRuleResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingRuleResolver.name);
  }

  async resolve(): Promise<PricingRuleConfiguration> {
    const strategy = await this.resolveStrategy();

    return {
      strategy,
      fuelPercentage: await this.requireNonNegativeDecimal(
        PricingSettingKey.FUEL_PERCENTAGE,
      ),
      combinationSurcharge: await this.requireNonNegativeDecimal(
        PricingSettingKey.COMBINATION_SURCHARGE,
      ),
      waitingTimeFreeMinutes: await this.requireWholeMinutes(
        PricingSettingKey.WAITING_TIME_FREE_MINUTES,
      ),
      waitingTimeBlockMinutes: await this.requirePositiveWholeMinutes(
        PricingSettingKey.WAITING_TIME_BLOCK_MINUTES,
      ),
      waitingTimeBlockPrice: await this.requireNonNegativeDecimal(
        PricingSettingKey.WAITING_TIME_BLOCK_PRICE,
      ),
      ruleVersion: await this.requireNonEmptyText(
        PricingSettingKey.RULE_VERSION,
      ),
    };
  }

  /**
   * The distance rate, required only by the distance-based strategy.
   *
   * Kept separate from `resolve` so a route-based system is never forced to
   * configure a rate it does not use.
   */
  async resolveDistanceRatePerKm(): Promise<string> {
    return this.requireNonNegativeDecimal(PricingSettingKey.DISTANCE_RATE_PER_KM);
  }

  private async resolveStrategy(): Promise<PricingStrategy> {
    const setting = await this.requireSetting(PricingSettingKey.STRATEGY);
    const configured = setting.value.trim();

    if (!isPricingStrategy(configured)) {
      this.logger.warn("Rejected unsupported pricing strategy", {
        settingKey: PricingSettingKey.STRATEGY,
      });

      throw new UnsupportedPricingStrategyException(
        configured,
        SUPPORTED_PRICING_STRATEGIES,
      );
    }

    return configured;
  }

  /**
   * A pricing amount: a percentage, a surcharge, a rate or a block price.
   *
   * Every decimal this Engine reads feeds an amount directly, and
   * pricing_rules.md § Business Constraints states that negative pricing is not
   * supported — so a negative value here would produce a negative pricing line
   * and could drive a total below the non-negative CHECK on trip_pricing.
   * Zero stays valid and means the component charges nothing.
   *
   * The Settings module rejects a negative value when it is updated. This is
   * the Engine's defensive safeguard for configuration that reached the
   * database by some other route — a manual SQL edit, a restored backup, an
   * older seed.
   *
   * The sign is checked numerically rather than by pattern, so it agrees
   * exactly with the bound the Settings module applies: "-0" is zero to both.
   */
  private async requireNonNegativeDecimal(
    settingKey: string,
  ): Promise<string> {
    const setting = await this.requireSetting(settingKey);
    const value = setting.value.trim();

    if (!isDecimalSettingValue(value)) {
      this.rejectSetting(settingKey, "a decimal with at most two decimals");
    }

    if (Number(value) < 0) {
      this.rejectSetting(settingKey, "a decimal that is zero or greater");
    }

    return value;
  }

  /**
   * A free-text Setting that must actually say something.
   *
   * Used for the rule version, which is stamped onto every snapshot. A blank
   * value would store an empty version string and quietly destroy the audit
   * trail the field exists for, so it is refused like any other unusable
   * configuration. The value itself is never logged.
   */
  private async requireNonEmptyText(settingKey: string): Promise<string> {
    const setting = await this.requireSetting(settingKey);
    const value = setting.value.trim();

    if (value.length === 0) {
      this.rejectSetting(settingKey, "a non-empty value");
    }

    return value;
  }

  private async requireWholeMinutes(settingKey: string): Promise<number> {
    const setting = await this.requireSetting(settingKey);
    const value = setting.value.trim();

    if (!isNonNegativeIntegerSettingValue(value)) {
      this.rejectSetting(settingKey, "a whole number of minutes, zero or more");
    }

    return Number(value);
  }

  /**
   * A minute count that may not be zero.
   *
   * The Engine's defensive safeguard for the block size. pricing_rules.md makes
   * a positive block size a configuration validation rule, not a business rule:
   * it is the divisor that converts billable minutes into blocks, so zero
   * leaves the calculation undefined. The Settings module rejects zero when the
   * value is updated; this catches configuration that reached the database by
   * some other route — a manual SQL edit, a restored backup, an old seed.
   *
   * Refusing to calculate is the only safe response. Producing a price from an
   * undefined formula would be worse than producing none.
   */
  private async requirePositiveWholeMinutes(
    settingKey: string,
  ): Promise<number> {
    const minutes = await this.requireWholeMinutes(settingKey);

    if (minutes === 0) {
      this.rejectSetting(
        settingKey,
        "a whole number of minutes, greater than zero",
      );
    }

    return minutes;
  }

  /**
   * Reads one pricing Setting.
   *
   * An inactive Setting counts as missing: database_schema.md §7.2 states the
   * application ignores inactive Settings, and silently pricing with a
   * withdrawn value would be worse than refusing to price at all.
   *
   * SettingsService reports absence as an HTTP 404. It is translated here so
   * the Engine's callers never receive a transport-level error from a domain
   * service.
   */
  private async requireSetting(
    settingKey: string,
  ): Promise<SettingResponseDto> {
    const setting = await this.findSetting(settingKey);

    if (!setting || !setting.isActive) {
      this.logger.warn("Pricing setting missing or inactive", {
        category: PRICING_SETTINGS_CATEGORY,
        settingKey,
      });

      throw new MissingPricingSettingException(
        PRICING_SETTINGS_CATEGORY,
        settingKey,
      );
    }

    return setting;
  }

  private async findSetting(
    settingKey: string,
  ): Promise<SettingResponseDto | null> {
    try {
      return await this.settingsService.findOne(
        PRICING_SETTINGS_CATEGORY,
        settingKey,
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  private rejectSetting(settingKey: string, expectation: string): never {
    this.logger.warn("Pricing setting is not usable", {
      category: PRICING_SETTINGS_CATEGORY,
      settingKey,
    });

    throw new InvalidPricingSettingException(
      PRICING_SETTINGS_CATEGORY,
      settingKey,
      expectation,
    );
  }
}
