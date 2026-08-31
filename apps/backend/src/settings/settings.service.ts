import { Injectable } from "@nestjs/common";
import { Setting, SettingValueType } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  maximumValueFor,
  minimumValueFor,
} from "./setting-value-bounds";
import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import { SettingCategoryGroupDto } from "./dto/setting-category-group.dto";
import {
  SettingResponseDto,
  toSettingResponse,
} from "./dto/setting-response.dto";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import {
  InvalidSettingValueException,
  SettingNotFoundException,
} from "./exceptions/setting.exceptions";
import {
  PRICING_CATEGORY,
  pricingSettingDefinition,
  type PricingSettingDefinition,
} from "./pricing-settings.catalog";
import { SettingsRepository } from "./settings.repository";
import { SettingValueValidator } from "./validators/setting-value.validator";

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly valueValidator: SettingValueValidator,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(SettingsService.name);
  }

  async findAll(query: ListSettingsQueryDto): Promise<SettingResponseDto[]> {
    const settings = await this.findSettings(query);
    return settings.map(toSettingResponse);
  }

  /**
   * Grouping is done in memory rather than with a database aggregate: the whole
   * settings table is small and already sorted by category, so a second query
   * would cost more than the loop.
   */
  async findGroupedByCategory(
    query: ListSettingsQueryDto,
  ): Promise<SettingCategoryGroupDto[]> {
    const settings = await this.findSettings(query);
    const groups = new Map<string, SettingResponseDto[]>();

    for (const setting of settings) {
      const existing = groups.get(setting.category);

      if (existing) {
        existing.push(toSettingResponse(setting));
      } else {
        groups.set(setting.category, [toSettingResponse(setting)]);
      }
    }

    return [...groups.entries()].map(([category, categorySettings]) => ({
      category,
      settings: categorySettings,
    }));
  }

  async findOne(category: string, key: string): Promise<SettingResponseDto> {
    return toSettingResponse(await this.requireSetting(category, key));
  }

  /**
   * Sets a setting's value, creating the row when it does not exist yet.
   *
   * ── WHY UPSERT RATHER THAN CREATE PLUS UPDATE ─────────────────────────────
   * The caller — the Configuration page — does not know or care whether a
   * setting has ever been configured. It knows what the value should be. Two
   * endpoints would push that distinction into the browser, where it would be
   * discovered as a 404 on a fresh deployment and worked around with a retry.
   *
   * Which is precisely what happened: the fuel percentage could only ever be
   * PATCHed, so on a database that had never been configured the Configuration
   * page could not configure it. One idempotent operation removes the state
   * the caller has to reason about.
   *
   * ── WHAT IT WILL NOT CREATE ───────────────────────────────────────────────
   * Only a key the pricing catalog declares. A setting is configuration the
   * application READS by name, so a row nobody reads is not configuration —
   * it is litter that looks like configuration. An unknown key is therefore
   * still a 404 rather than an invitation to invent one.
   *
   * The value is validated identically either way: same type check, same
   * bounds. Creating is not a way around the rules that govern editing.
   */
  async upsert(
    category: string,
    key: string,
    dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    const existing = await this.repository.findByCategoryAndKey(category, key);

    if (existing) {
      return this.update(category, key, dto);
    }

    const definition = requireCreatableSetting(category, key);

    this.assertValueIsUsable(category, key, dto.value, definition.valueType);

    const created = await this.repository.create({
      category,
      key,
      value: dto.value,
      valueType: definition.valueType,
      description: definition.description,
      defaultValue: definition.defaultValue,
    });

    // The value itself is never logged: settings are a generic key/value store
    // and may hold credentials.
    this.logger.log("Setting created", {
      category,
      key,
      valueType: definition.valueType,
    });

    return toSettingResponse(created);
  }

  async update(
    category: string,
    key: string,
    dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    const setting = await this.requireSetting(category, key);

    this.assertValueIsUsable(category, key, dto.value, setting.valueType);

    const updated = await this.repository.updateValue(setting.id, dto.value);

    // Configuration changes are worth an audit line, but the value itself is
    // never logged: settings are a generic key/value store and may hold
    // credentials such as an IMAP password.
    this.logger.log("Setting updated", {
      category,
      key,
      valueType: setting.valueType,
    });

    return toSettingResponse(updated);
  }

  /**
   * The one validation path, shared by creating and editing.
   *
   * Type first, bound second: a bound is only meaningful once the value is
   * known to be a number.
   */
  private assertValueIsUsable(
    category: string,
    key: string,
    value: string,
    valueType: SettingValueType,
  ): void {
    const result = this.valueValidator.validate(value, valueType);

    if (!result.valid) {
      this.rejectValue(
        category,
        key,
        valueType,
        result.reason ?? "value is not valid for this type",
      );
    }

    this.assertWithinBounds(category, key, value, valueType);
  }

  /**
   * Enforces a setting's numeric bound, where it has one.
   *
   * A handful of settings are unusable below a certain value however well they
   * parse — a divisor that may not be zero, for instance. The bound and its
   * reason live in setting-value-bounds.ts.
   */
  private assertWithinBounds(
    category: string,
    key: string,
    value: string,
    valueType: SettingValueType,
  ): void {
    const parsed = Number(value);
    const minimum = minimumValueFor(category, key);
    const maximum = maximumValueFor(category, key);

    if (minimum !== undefined && parsed < minimum) {
      this.rejectValue(
        category,
        key,
        valueType,
        `value must be at least ${minimum}`,
      );
    }

    if (maximum !== undefined && parsed > maximum) {
      this.rejectValue(
        category,
        key,
        valueType,
        `value must be at most ${maximum}`,
      );
    }
  }

  /** Warn rather than error: a rejected value is a client mistake, not a system failure. */
  private rejectValue(
    category: string,
    key: string,
    valueType: SettingValueType,
    reason: string,
  ): never {
    this.logger.warn("Rejected setting value", {
      category,
      key,
      valueType,
      reason,
    });

    throw new InvalidSettingValueException(category, key, valueType, reason);
  }

  private findSettings(query: ListSettingsQueryDto): Promise<Setting[]> {
    return this.repository.findMany({
      category: query.category,
      includeInactive: query.includeInactive,
    });
  }

  private async requireSetting(
    category: string,
    key: string,
  ): Promise<Setting> {
    const setting = await this.repository.findByCategoryAndKey(category, key);

    if (!setting) {
      throw new SettingNotFoundException(category, key);
    }

    return setting;
  }
}

/**
 * The definition a missing setting may be created from.
 *
 * Only the pricing catalog is creatable. Everything else in this table — IMAP
 * credentials among them — is provisioned by deployment rather than typed into
 * a screen, and an upsert that could conjure any key would be a way to write
 * rows the application never reads.
 */
function requireCreatableSetting(
  category: string,
  key: string,
): PricingSettingDefinition {
  const definition =
    category === PRICING_CATEGORY ? pricingSettingDefinition(key) : undefined;

  if (!definition) {
    throw new SettingNotFoundException(category, key);
  }

  return definition;
}
