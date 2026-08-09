import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import { SettingCategoryGroupDto } from "./dto/setting-category-group.dto";
import { SettingParamsDto } from "./dto/setting-params.dto";
import { SettingResponseDto } from "./dto/setting-response.dto";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import { SettingsService } from "./settings.service";

/**
 * Responses are returned as plain data; ResponseInterceptor applies the standard
 * envelope and AllExceptionsFilter renders the error shape.
 */
@ApiTags("Settings")
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "List settings" })
  @ApiOkResponse({ type: [SettingResponseDto] })
  findAll(@Query() query: ListSettingsQueryDto): Promise<SettingResponseDto[]> {
    return this.settingsService.findAll(query);
  }

  /**
   * Declared before the two-segment route below; Nest matches in declaration
   * order and "grouped" would otherwise be a valid category segment.
   */
  @Get("grouped")
  @ApiOperation({ summary: "List settings grouped by category" })
  @ApiOkResponse({ type: [SettingCategoryGroupDto] })
  findGroupedByCategory(
    @Query() query: ListSettingsQueryDto,
  ): Promise<SettingCategoryGroupDto[]> {
    return this.settingsService.findGroupedByCategory(query);
  }

  @Get(":category/:key")
  @ApiOperation({
    summary: "Get one setting",
    description:
      "Both category and key are required: keys are unique only within a category.",
  })
  @ApiOkResponse({ type: SettingResponseDto })
  @ApiNotFoundResponse({ description: "No such setting in that category." })
  findOne(@Param() params: SettingParamsDto): Promise<SettingResponseDto> {
    return this.settingsService.findOne(params.category, params.key);
  }

  @Patch(":category/:key")
  @ApiOperation({
    summary: "Update a setting value",
    description:
      "Only the value can change. The value is validated against the setting's configured valueType.",
  })
  @ApiOkResponse({ type: SettingResponseDto })
  @ApiNotFoundResponse({ description: "No such setting in that category." })
  @ApiBadRequestResponse({
    description: "The value does not match the configured valueType.",
  })
  update(
    @Param() params: SettingParamsDto,
    @Body() dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    return this.settingsService.update(params.category, params.key, dto);
  }
}
