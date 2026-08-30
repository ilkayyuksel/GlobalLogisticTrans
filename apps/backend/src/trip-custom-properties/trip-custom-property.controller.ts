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
import { TripCustomPropertyMutationDto } from "./dto/trip-custom-property-mutation.dto";
import { TripCustomPropertiesDto } from "./dto/trip-custom-property-response.dto";
import { TripCustomPropertyService } from "./trip-custom-property.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module records which Custom Properties a Trip carries. It prices
 * nothing itself and never changes the Trip's status — a CLOSED Trip stays
 * CLOSED — but a priced property changes what the Trip is worth, so both write
 * operations recalculate through the Pricing Engine and answer with the
 * complete effective pricing. A recalculation that cannot produce a figure does
 * not undo the write: the response is still a success, with `pricing: null` and
 * a reason code.
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
      "The Trip and the property must exist, the property must still be active, and it must not already be assigned to that Trip. The Trip is then priced again and the response carries its complete effective pricing — Others and Totaal included. The Trip's status never changes. If the Trip cannot be priced against the current configuration the assignment is still kept and the response carries pricing: null with a reason code.",
  })
  @ApiCreatedResponse({ type: TripCustomPropertyMutationDto })
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
  ): Promise<TripCustomPropertyMutationDto> {
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
      "Physically removes the assignment, then prices the Trip again so the response carries its complete effective pricing without the property. Never blocked by an existing pricing snapshot. Neither the Trip nor the property itself is modified, and the Trip's status never changes. If the Trip cannot be priced the removal is still kept and the response carries pricing: null with a reason code.",
  })
  @ApiOkResponse({
    type: TripCustomPropertyMutationDto,
    description:
      "The assignment that was removed, with the Trip's recalculated pricing.",
  })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No assignment with that id." })
  remove(
    @Param() params: TripCustomPropertyIdParamDto,
  ): Promise<TripCustomPropertyMutationDto> {
    return this.tripCustomPropertyService.remove(params.id);
  }
}
