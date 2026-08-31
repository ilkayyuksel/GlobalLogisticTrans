import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import { SettingCategoryGroupDto } from "./dto/setting-category-group.dto";
import {
  PricingBootstrapPlanDto,
} from "./dto/pricing-bootstrap.dto";
import { SettingParamsDto } from "./dto/setting-params.dto";
import { SettingResponseDto } from "./dto/setting-response.dto";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import { PricingBootstrapService } from "./pricing-bootstrap.service";
import { SettingsService } from "./settings.service";

/**
 * Responses are returned as plain data; ResponseInterceptor applies the standard
 * envelope and AllExceptionsFilter renders the error shape.
 */
@ApiTags("Settings")
@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly bootstrap: PricingBootstrapService,
  ) {}

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

  /**
   * The pricing configuration the Engine requires, and what is missing from it.
   *
   * Read-only, and the report an operator sees BEFORE anything is created: a
   * fresh deployment has no pricing settings at all, and this says exactly
   * which ones and what each would be created with.
   *
   * Declared before the two-segment route below, for the same reason "grouped"
   * is: Nest matches in declaration order, and ":category/:key" reads this path
   * as the key "bootstrap" in a category called "pricing".
   */
  @Get("pricing/bootstrap")
  @ApiOperation({
    summary: "Report the pricing configuration and what bootstrapping would create",
    description:
      "Lists every setting the Pricing Engine requires with its current value, or null when it does not exist. `proposedValue` is what bootstrapping would write; `blockedReason` explains the ones it cannot determine — the automatic Custom Property's id, when no such property exists in this database. Writes nothing.",
  })
  @ApiOkResponse({ type: PricingBootstrapPlanDto })
  planPricingBootstrap(): Promise<PricingBootstrapPlanDto> {
    return this.bootstrap.plan();
  }

  /**
   * Creates the pricing settings that are missing, and only those.
   *
   * POST rather than PATCH: it creates rows. Idempotent all the same — a second
   * call finds nothing missing and writes nothing.
   */
  @Post("pricing/bootstrap")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Create the missing pricing settings",
    description:
      "Creates every required setting that has no row yet, using the canonical value for each. NEVER overwrites a setting that already exists — a configured value is somebody's decision. Prices no Trip and touches no existing snapshot: configuration becomes effective for the next calculation or an explicit reprocess. Returns the configuration as it stands afterwards.",
  })
  @ApiOkResponse({ type: PricingBootstrapPlanDto })
  applyPricingBootstrap(): Promise<PricingBootstrapPlanDto> {
    return this.bootstrap.apply();
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

  /**
   * Sets a setting's value, creating it when it does not exist yet.
   *
   * PUT rather than PATCH because it is idempotent in the HTTP sense: the same
   * request twice leaves the same state. The Configuration page uses this so it
   * does not have to know whether a setting has ever been configured — which it
   * could not know, and which used to make it fail on a fresh deployment.
   *
   * Only a key the pricing catalog declares may be CREATED. Everything else in
   * this table is provisioned by deployment, and an unknown key is still a 404.
   */
  @Put(":category/:key")
  @ApiOperation({
    summary: "Set a setting's value, creating it if necessary",
    description:
      "Updates the value when the setting exists, and creates it when it does not — with the same type check and the same bounds either way. Creating is limited to the pricing settings the application reads by name; any other unknown key is refused.",
  })
  @ApiOkResponse({ type: SettingResponseDto })
  @ApiBadRequestResponse({
    description: "The value is not valid for the setting's type, or is out of range.",
  })
  @ApiNotFoundResponse({
    description: "No such setting, and none that may be created under that key.",
  })
  upsert(
    @Param() params: SettingParamsDto,
    @Body() dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    return this.settingsService.upsert(params.category, params.key, dto);
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
