import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CustomPropertyService } from "./custom-property.service";
import { CreateCustomPropertyDto } from "./dto/create-custom-property.dto";
import { CustomPropertyIdParamDto } from "./dto/custom-property-id-param.dto";
import {
  CustomPropertyResponseDto,
  PaginatedCustomPropertiesDto,
} from "./dto/custom-property-response.dto";
import { ListCustomPropertiesQueryDto } from "./dto/list-custom-properties-query.dto";
import { UpdateCustomPropertyDto } from "./dto/update-custom-property.dto";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module stores configuration only. It never calculates a price and never
 * assigns a property to a Trip — those belong to the Pricing Engine and the
 * Trip module respectively.
 *
 * There is no DELETE endpoint by design — properties are never physically
 * removed, so historical Trips keep resolving the properties they carry.
 * Withdrawing a property from use is expressed as deactivation.
 */
@ApiTags("Custom properties")
@Controller("custom-properties")
export class CustomPropertyController {
  constructor(
    private readonly customPropertyService: CustomPropertyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List custom properties",
    description:
      "Paginated, ordered by display order. Returns both active and inactive properties unless isActive is supplied. Search matches name and description.",
  })
  @ApiOkResponse({ type: PaginatedCustomPropertiesDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(
    @Query() query: ListCustomPropertiesQueryDto,
  ): Promise<PaginatedCustomPropertiesDto> {
    return this.customPropertyService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one custom property",
    description: "Returns the property regardless of its active state.",
  })
  @ApiOkResponse({ type: CustomPropertyResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No custom property with that id." })
  findById(
    @Param() params: CustomPropertyIdParamDto,
  ): Promise<CustomPropertyResponseDto> {
    return this.customPropertyService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a custom property",
    description:
      "Properties are created active. The name must be free among active properties. Omitting displayOrder appends the property to the end of the list.",
  })
  @ApiCreatedResponse({ type: CustomPropertyResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, price or colour.",
  })
  @ApiConflictResponse({
    description: "An active property already uses this name.",
  })
  create(
    @Body() dto: CreateCustomPropertyDto,
  ): Promise<CustomPropertyResponseDto> {
    return this.customPropertyService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a custom property",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear description, price or colour. Name and display order cannot be cleared. Active state is changed through the activate and deactivate endpoints.",
  })
  @ApiOkResponse({ type: CustomPropertyResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field, UUID, price or colour." })
  @ApiNotFoundResponse({ description: "No custom property with that id." })
  @ApiConflictResponse({
    description: "Another active property already uses the new name.",
  })
  update(
    @Param() params: CustomPropertyIdParamDto,
    @Body() dto: UpdateCustomPropertyDto,
  ): Promise<CustomPropertyResponseDto> {
    return this.customPropertyService.update(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path, matching the pattern used by
   * Driver, Vehicle and RoutePricing.
   */
  @Patch(":id/activation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a custom property",
    description:
      "Makes the property selectable for new Trips. Idempotent. Fails if another active property now uses the same name.",
  })
  @ApiOkResponse({ type: CustomPropertyResponseDto })
  @ApiNotFoundResponse({ description: "No custom property with that id." })
  @ApiConflictResponse({
    description: "Another active property already uses this name.",
  })
  activate(
    @Param() params: CustomPropertyIdParamDto,
  ): Promise<CustomPropertyResponseDto> {
    return this.customPropertyService.activate(params.id);
  }

  @Patch(":id/deactivation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a custom property",
    description:
      "Soft delete. The record is retained so Trips already carrying this property keep resolving it; it simply stops being selectable. Never blocked by existing Trip assignments. Idempotent.",
  })
  @ApiOkResponse({ type: CustomPropertyResponseDto })
  @ApiNotFoundResponse({ description: "No custom property with that id." })
  deactivate(
    @Param() params: CustomPropertyIdParamDto,
  ): Promise<CustomPropertyResponseDto> {
    return this.customPropertyService.deactivate(params.id);
  }
}
