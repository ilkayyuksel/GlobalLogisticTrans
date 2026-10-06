import { Controller, Get, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import {
  MAX_LABEL_TRIP_IDS,
  TripExportLabelsDto,
  TripExportLabelsQueryDto,
} from "./dto/trip-export-labels.dto";
import { TripExportLabelsService } from "./trip-export-labels.service";

/**
 * The words the Excel exports print about Trips.
 *
 * Read-only, and batched like the snapshots read the exports make beside it:
 * one request per hundred Trips. The browser places these words in cells; it
 * no longer composes them.
 */
@ApiTags("Trip export")
@Controller("trip-export")
export class TripExportController {
  constructor(private readonly labels: TripExportLabelsService) {}

  @Get("labels")
  @ApiOperation({
    summary: "The export words of several Trips",
    description:
      "The Remarks text, the waiting-time label and whether TAR was charged, for each Trip — read from the stored pricing and the Trip itself, never calculated. The single source of this vocabulary: both Excel exports and the invoice check print exactly these words.",
  })
  @ApiOkResponse({ type: [TripExportLabelsDto] })
  @ApiBadRequestResponse({
    description: `An id is not a valid UUID, the list is empty, it holds more than ${MAX_LABEL_TRIP_IDS} ids, or a display word is unusable.`,
  })
  async findForTrips(
    @Query() query: TripExportLabelsQueryDto,
  ): Promise<TripExportLabelsDto[]> {
    const labels = await this.labels.findForTrips(
      query.tripIds,
      query.waitingWord,
      query.nextDayWord,
    );

    return [...labels.entries()].map(([tripId, label]) => ({ tripId, ...label }));
  }
}
