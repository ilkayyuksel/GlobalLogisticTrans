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

import { ChangeTripPaymentDto } from "./dto/change-trip-payment.dto";
import { ChangeTripStatusDto } from "./dto/change-trip-status.dto";
import { CompleteTripsDto } from "./dto/complete-trips.dto";
import { MarkTripsLooseDto } from "./dto/mark-trips-loose.dto";
import { CreateTripDto } from "./dto/create-trip.dto";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto";
import { RemoveTripFromGroupDto } from "./dto/remove-trip-from-group.dto";
import { TripDocumentsDto } from "./dto/trip-document-response.dto";
import { TripIdParamDto } from "./dto/trip-id-param.dto";
import { PaginatedTripsDto, TripResponseDto } from "./dto/trip-response.dto";
import { UpdateTripDto } from "./dto/update-trip.dto";
import { TripDocumentsService } from "./trip-documents.service";
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
  constructor(
    private readonly tripService: TripService,
    private readonly tripDocumentsService: TripDocumentsService,
  ) {}

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

  /**
   * Declared before ":id" so the literal path cannot be read as an identifier.
   */
  @Get("terminals")
  @ApiOperation({
    summary: "The terminals Trips actually carry",
    description:
      "Distinct terminal strings from the Trips themselves, alphabetically, so a filter can offer the values that really exist. There is no terminal master data: a terminal is the string the transport order printed, and this endpoint reports what is stored rather than a configured list. DELETED Trips are excluded.",
  })
  @ApiOkResponse({ type: [String] })
  findTerminals(): Promise<string[]> {
    return this.tripService.findTerminals();
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

  /**
   * Declared before the ":id" routes for readability; a two-segment path could
   * not be shadowed by them in any case.
   */
  @Get(":id/documents")
  @ApiOperation({
    summary: "The transport documents of one Trip",
    description:
      "Newest first: every UPDATE and CANCEL document that concerned this Trip, then the original order it was created from. An UPDATE entry carries the fields it moved. Use GET /pdf-documents/{id}/content to view or download one — no storage path, email body or parser internals leave the backend.",
  })
  @ApiOkResponse({ type: TripDocumentsDto })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  findDocuments(@Param() params: TripIdParamDto): Promise<TripDocumentsDto> {
    return this.tripDocumentsService.findForTrip(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a Trip manually",
    description:
      "Trips are created OPEN. An imported Trip references the PDF it came from; a Trip created by hand may omit the document, the booking number, the container type, the destination and both dates, and each is then stored as null rather than as a placeholder. Values that ARE supplied are still validated: the PDF must exist, a booking number must be free, and an assigned Vehicle must be active. Creating a Trip never prices it.",
  })
  @ApiCreatedResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, date, time, distance or UUID.",
  })
  @ApiNotFoundResponse({
    description:
      "The referenced PDF document, Vehicle or Driver does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The booking number is in use, or the Vehicle or Driver is inactive.",
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
    description:
      "Invalid field, UUID, date, distance, or an immutable field was sent.",
  })
  @ApiNotFoundResponse({
    description:
      "No Trip with that id, or the referenced Vehicle or Driver does not exist.",
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
  @ApiBadRequestResponse({
    description: "Unknown or unsupported target status.",
  })
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
   * BETAALD / NIET BETAALD.
   *
   * Its own sub-resource, beside `:id/status` and for the same reason: payment
   * is a decision of its own, made in one click, not a field edited among
   * others. Folding it into the general update would let a request that meant
   * to correct a container number also mark a Trip paid.
   *
   * PATCH rather than POST: it sets the state of an existing Trip rather than
   * creating anything, and asking for the state a Trip already has is
   * idempotent.
   */
  @Patch(":id/payment")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mark a Trip paid or unpaid",
    description:
      "Sets the payment state and NOTHING else. Payment is independent of the lifecycle: it never changes the Trip's status, never closes, reopens, cancels or deletes it, and never touches its pricing. Only a boolean is accepted, so no other value can be stored. Setting the state the Trip already has is idempotent. Returns the whole updated Trip, so a list can refresh the affected row from the response without refetching.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({
    description: "The id is not a valid UUID, or isPaid is not a boolean.",
  })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  changePayment(
    @Param() params: TripIdParamDto,
    @Body() dto: ChangeTripPaymentDto,
  ): Promise<TripResponseDto> {
    return this.tripService.changePayment(params.id, dto);
  }

  /**
   * Completing several Trips at once.
   *
   * A collection sub-resource rather than a verb, matching the way a single
   * Trip is completed through `:id/status` — and deliberately NOT a generic
   * "bulk status" endpoint: the only multi-Trip transition the business asked
   * for is completion, and a generic one would invite bulk cancellation and
   * bulk deletion without anybody deciding those should exist.
   *
   * `POST` because the request creates completions; the ids are a body rather
   * than a query so a long selection cannot outgrow a URL.
   */
  @Post("completions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Complete several Trips",
    description:
      "Marks every named Trip CLOSED, applying exactly the transition rules of the single-Trip status endpoint. All or nothing: if any Trip cannot be closed the whole request is refused and none of them moves. A Trip that is already CLOSED is left as it is rather than refused. Pricing is calculated afterwards per Trip, as it is for a single completion, and a Trip with no configured route still closes.",
  })
  @ApiOkResponse({ type: [TripResponseDto] })
  @ApiBadRequestResponse({
    description: "An empty list, duplicate ids, or a malformed UUID.",
  })
  @ApiNotFoundResponse({ description: "One of the Trips does not exist." })
  @ApiConflictResponse({
    description:
      "One of the Trips cannot be closed from its current status. No Trip was changed.",
  })
  completeMany(@Body() dto: CompleteTripsDto): Promise<TripResponseDto[]> {
    return this.tripService.completeMany(dto.tripIds);
  }

  /**
   * Classifying several Trips as LOSRIT at once.
   *
   * A collection sub-resource, like `completions`, and deliberately NOT a
   * generic "bulk update": the ids are the whole body, the classification is
   * what the endpoint is, and nothing else about the Trips can be reached
   * through it. A single Trip is still classified through `PATCH /trips/:id`,
   * which is also the only way to take the classification back off.
   */
  @Post("loose")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mark several Trips as loose trips (LOSRIT)",
    description:
      "Sets isLooseTrip on every named Trip. All or nothing: if any of them belongs to a TripGroup or is DELETED the whole request is refused and none is changed. A Trip that is already a LOSRIT is left as it is rather than refused. Nothing else about a Trip is touched — no status, no planning, no pricing and no document — and no pricing is triggered.",
  })
  @ApiOkResponse({ type: [TripResponseDto] })
  @ApiBadRequestResponse({
    description: "An empty list, duplicate ids, or a malformed UUID.",
  })
  @ApiNotFoundResponse({ description: "One of the Trips does not exist." })
  @ApiConflictResponse({
    description:
      "One of the Trips belongs to a group, or is DELETED. No Trip was changed.",
  })
  markManyLoose(@Body() dto: MarkTripsLooseDto): Promise<TripResponseDto[]> {
    return this.tripService.markManyLoose(dto.tripIds);
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
      "Returns a DELETED Trip to OPEN. Fails if another Trip has taken its booking number. A Trip with no booking number has none to reclaim.",
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

  /**
   * The group membership of one Trip, as its own sub-resource.
   *
   * Only clearing is offered. JOINING a group happens through
   * POST /trip-groups, which is where the rules about a group as a whole live;
   * allowing a Trip to be pointed at an arbitrary group id here would let one
   * Trip quietly change what another group means.
   */
  @Patch(":id/group")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove a Trip from its group",
    description:
      "Clears the Trip's group. The Trip itself is untouched, and so are the other members — a group is allowed to remain with a single Trip, which stays visible and is never deleted automatically. Send tripGroupId as null; joining a group is done through POST /trip-groups.",
  })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiBadRequestResponse({
    description: "The id is not a valid UUID, or tripGroupId is not null.",
  })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({ description: "The Trip belongs to no group." })
  removeFromGroup(
    @Param() params: TripIdParamDto,
    @Body() _dto: RemoveTripFromGroupDto,
  ): Promise<TripResponseDto> {
    return this.tripService.removeFromGroup(params.id);
  }
}
