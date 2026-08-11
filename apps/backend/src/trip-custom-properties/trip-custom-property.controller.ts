import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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

import { AssignCustomPropertyDto } from "./dto/assign-custom-property.dto";
import {
  TripCustomPropertyIdParamDto,
  TripIdParamDto,
} from "./dto/trip-custom-property-params.dto";
import {
  TripCustomPropertiesDto,
  TripCustomPropertyResponseDto,
} from "./dto/trip-custom-property-response.dto";
import { TripCustomPropertyService } from "./trip-custom-property.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module records which Custom Properties a Trip carries. It never prices
 * one, never touches the Trip's pricing snapshot and never changes the Trip's
 * status.
 *
 * Unlike every other module here it does expose a DELETE, and that is correct:
 * an assignment is a current fact rather than a historical record, and the
 * pricing consequence of a removed property is already frozen in its pricing
 * item.
 */
@ApiTags("Trip custom properties")
@Controller("trip-custom-properties")
export class TripCustomPropertyController {
  constructor(
    private readonly tripCustomPropertyService: TripCustomPropertyService,
  ) {}

  /**
   * Declared before any ":id" route for readability; the two-segment path could
   * not collide with one in any case.
   */
  @Get("trip/:tripId")
  @ApiOperation({
    summary: "Get the Custom Properties assigned to a Trip",
    description:
      "Every assignment the Trip carries, in the properties' configured display order, each with the property as it is configured now. Deliberately not paginated: the set is small, bounded, and only correct when read as a whole. Returns an empty list when the Trip carries none.",
  })
  @ApiOkResponse({ type: TripCustomPropertiesDto })
  @ApiBadRequestResponse({ description: "The Trip id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  findByTripId(
    @Param() params: TripIdParamDto,
  ): Promise<TripCustomPropertiesDto> {
    return this.tripCustomPropertyService.findByTripId(params.tripId);
  }

  @Post()
  @ApiOperation({
    summary: "Assign a Custom Property to a Trip",
    description:
      "The Trip and the property must exist, the property must still be active, and it must not already be assigned to that Trip. Assigning a property records a planning decision only — no price is calculated and no pricing snapshot is touched.",
  })
  @ApiCreatedResponse({ type: TripCustomPropertyResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, or a malformed UUID.",
  })
  @ApiNotFoundResponse({
    description: "The referenced Trip or Custom Property does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The property is inactive, or it is already assigned to that Trip.",
  })
  assign(
    @Body() dto: AssignCustomPropertyDto,
  ): Promise<TripCustomPropertyResponseDto> {
    return this.tripCustomPropertyService.assign(dto);
  }

  /**
   * Returns 200 with the removed assignment rather than 204.
   *
   * Every response in this API carries the standard envelope, and a 204 may not
   * have a body. Returning the row that disappeared also tells the caller
   * exactly which property left the Trip.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove a Custom Property from a Trip",
    description:
      "Physically removes the assignment. Never blocked by an existing pricing snapshot: the amount the property contributed was frozen into its pricing item when the calculation ran, so historical pricing stays complete and only future calculations see the change. Neither the Trip nor the property itself is modified.",
  })
  @ApiOkResponse({
    type: TripCustomPropertyResponseDto,
    description: "The assignment that was removed.",
  })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No assignment with that id." })
  remove(
    @Param() params: TripCustomPropertyIdParamDto,
  ): Promise<TripCustomPropertyResponseDto> {
    return this.tripCustomPropertyService.remove(params.id);
  }
}
