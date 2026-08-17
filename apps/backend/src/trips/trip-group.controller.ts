import { Body, Controller, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CreateTripGroupDto } from "./dto/create-trip-group.dto";
import {
  TripGroupResponseDto,
  toTripGroupResponse,
} from "./dto/trip-group-response.dto";
import { TripService } from "./trip.service";

/**
 * Grouping Trips by hand.
 *
 * One route, and it lives in the Trip module on purpose: a TripGroup has no
 * data of its own — the whole of it is which Trips point at it — so the rules
 * belong to the Trip domain, and a separate module would exist only to hold a
 * single controller.
 *
 * Reading a group is not here either: `GET /trips?tripGroupId=` already answers
 * it, works across dates and pages, and is what the group dialog uses. A second
 * way to ask the same question would be a second thing to keep correct.
 *
 * There is no DELETE. A group is unmade by unlinking its Trips, which is a Trip
 * operation and reads as what actually happens.
 */
@ApiTags("Trips")
@Controller("trip-groups")
export class TripGroupController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @ApiOperation({
    summary: "Group Trips manually",
    description:
      "Puts two or more existing Trips into one new group, in a single transaction — either every Trip joins or none does. A manual group is an operational convenience and carries no rule about directions, dates or statuses; it is NOT an imported Combination, which the parser creates from a single document. A Trip that already belongs to a group must be unlinked from it first.",
  })
  @ApiCreatedResponse({ type: TripGroupResponseDto })
  @ApiBadRequestResponse({
    description: "Fewer than two Trips, duplicate ids, or a malformed UUID.",
  })
  @ApiNotFoundResponse({ description: "One of the Trips does not exist." })
  @ApiConflictResponse({
    description: "One of the Trips already belongs to a group.",
  })
  async create(
    @Body() dto: CreateTripGroupDto,
  ): Promise<TripGroupResponseDto> {
    return toTripGroupResponse(await this.tripService.createGroup(dto.tripIds));
  }
}
