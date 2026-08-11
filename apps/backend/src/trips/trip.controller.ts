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

import { ChangeTripStatusDto } from "./dto/change-trip-status.dto";
import { CreateTripDto } from "./dto/create-trip.dto";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto";
import { TripIdParamDto } from "./dto/trip-id-param.dto";
import { PaginatedTripsDto, TripResponseDto } from "./dto/trip-response.dto";
import { UpdateTripDto } from "./dto/update-trip.dto";
import { TripService } from "./trip.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * There is no DELETE endpoint by design — Trips are never physically removed,
 * so deletion is expressed as a reversible status change and lives at
 * /trips/{id}/deletion alongside its counterpart /trips/{id}/restoration.
 *
 * This phase covers manual Trip management only. Import, parsing, pricing,
 * grouping, history and export are separate concerns and separate phases.
 */
@ApiTags("Trips")
@Controller("trips")
export class TripController {
  constructor(private readonly tripService: TripService) {}

  @Get()
  @ApiOperation({
    summary: "List Trips",
    description:
      "Paginated, most recent planning date first. DELETED Trips are hidden unless status=DELETED is requested, because they must not appear in normal planning views.",
  })
  @ApiOkResponse({ type: PaginatedTripsDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(@Query() query: ListTripsQueryDto): Promise<PaginatedTripsDto> {
    return this.tripService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one Trip",
    description: "Returns the Trip whatever its status, including DELETED.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  findById(@Param() params: TripIdParamDto): Promise<TripResponseDto> {
    return this.tripService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a Trip manually",
    description:
      "Trips are created OPEN. Every Trip originates from exactly one PDF, so an existing pdfDocumentId is required. The booking number must be free, and an assigned Vehicle must be active and not already booked for an overlapping interval.",
  })
  @ApiCreatedResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, date, time, distance or UUID.",
  })
  @ApiNotFoundResponse({
    description: "The referenced PDF document, Vehicle or Driver does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The booking number is in use, the Vehicle or Driver is inactive, or the Vehicle is already booked for that interval.",
  })
  create(@Body() dto: CreateTripDto): Promise<TripResponseDto> {
    return this.tripService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update the manual fields of a Trip",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear a nullable field. Only manual planning fields are editable — booking number, original planning date and the source PDF are immutable, and status moves through its own endpoints. Any other field is rejected.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid field, UUID, date, distance, or an immutable field was sent.",
  })
  @ApiNotFoundResponse({
    description: "No Trip with that id, or the referenced Vehicle or Driver does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The Vehicle or Driver is inactive, or the move would double-book the Vehicle.",
  })
  update(
    @Param() params: TripIdParamDto,
    @Body() dto: UpdateTripDto,
  ): Promise<TripResponseDto> {
    return this.tripService.update(params.id, dto);
  }

  @Patch(":id/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Change the status of a Trip",
    description:
      "Allowed moves: OPEN to CLOSED, OPEN to CANCELLED, and CANCELLED back to OPEN. CLOSED is terminal. DELETED is not reachable here — use the deletion endpoint, because a business cancellation and an administrative soft delete are distinct states. Requesting the current status is idempotent.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({ description: "Unknown or unsupported target status." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({
    description:
      "The transition is not allowed, or reopening would reclaim a booking number or Vehicle slot that has since been taken.",
  })
  changeStatus(
    @Param() params: TripIdParamDto,
    @Body() dto: ChangeTripStatusDto,
  ): Promise<TripResponseDto> {
    return this.tripService.changeStatus(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path, matching the activation and
   * deactivation pattern used by Driver, Vehicle, RoutePricing and
   * CustomProperty.
   */
  @Patch(":id/deletion")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Soft delete a Trip",
    description:
      "Sets the status to DELETED. The row is retained for history, exports and pricing, and the Trip disappears from normal planning views. Only an OPEN Trip may be deleted, so that restore can return it to a known status. Idempotent.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({
    description: "The Trip is not OPEN and therefore cannot be deleted.",
  })
  softDelete(@Param() params: TripIdParamDto): Promise<TripResponseDto> {
    return this.tripService.softDelete(params.id);
  }

  @Patch(":id/restoration")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Restore a deleted Trip",
    description:
      "Returns a DELETED Trip to OPEN. Fails if another Trip has taken its booking number, or if its Vehicle has since been booked for an overlapping interval.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({
    description:
      "The Trip is not DELETED, or its booking number or Vehicle slot is no longer free.",
  })
  restore(@Param() params: TripIdParamDto): Promise<TripResponseDto> {
    return this.tripService.restore(params.id);
  }
}
