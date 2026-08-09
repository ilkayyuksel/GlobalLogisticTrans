import { Injectable } from "@nestjs/common";
import { Setting } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
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

  async update(
    category: string,
    key: string,
    dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    const setting = await this.requireSetting(category, key);

    const result = this.valueValidator.validate(dto.value, setting.valueType);

    if (!result.valid) {
      // Warn rather than error: a rejected value is a client mistake, not a
      // system failure.
      this.logger.warn("Rejected setting value", {
        category,
        key,
        valueType: setting.valueType,
        reason: result.reason,
      });

      throw new InvalidSettingValueException(
        category,
        key,
        setting.valueType,
        result.reason ?? "value is not valid for this type",
      );
    }

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
