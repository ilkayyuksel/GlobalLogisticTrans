import {
  Body,
  Controller,
  Delete,
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
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CalendarEventService } from "./calendar-event.service";
import { CalendarEventIdParamDto } from "./dto/calendar-event-id-param.dto";
import {
  CalendarEventResponseDto,
  CalendarRangeDto,
} from "./dto/calendar-event-response.dto";
import { CalendarRangeQueryDto } from "./dto/calendar-range-query.dto";
import { CreateCalendarEventDto } from "./dto/create-calendar-event.dto";
import { UpdateCalendarEventDto } from "./dto/update-calendar-event.dto";

/**
 * The Agenda: appointments of the Administrator, independent of Trips.
 */
@ApiTags("Agenda")
@Controller("calendar-events")
export class CalendarEventController {
  constructor(private readonly calendarEventService: CalendarEventService) {}

  @Get()
  @ApiOperation({
    summary: "The Agenda over a range of days",
    description:
      "Every item whose day lies from `from` to `to`, both included — at most seven days — ordered by the database (day, start time, end time, id), together with the hours the Agenda shows (`dayStart`–`dayEnd`). The calendar asks for its week; the Dashboard asks for today to today with this same call.",
  })
  @ApiOkResponse({ type: CalendarRangeDto })
  @ApiBadRequestResponse({
    description:
      "A missing or impossible date, `to` before `from`, or more than seven days.",
  })
  findRange(@Query() query: CalendarRangeQueryDto): Promise<CalendarRangeDto> {
    return this.calendarEventService.findRange(query.from, query.to);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one Agenda item" })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Agenda item with that id." })
  findById(
    @Param() params: CalendarEventIdParamDto,
  ): Promise<CalendarEventResponseDto> {
    return this.calendarEventService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Add an Agenda item",
    description:
      "A title, a day and a start; the end is optional and defaults to one hour after the start. The item must end after it starts and lie within the Agenda's day (06:00–23:00).",
  })
  @ApiCreatedResponse({ type: CalendarEventResponseDto })
  @ApiBadRequestResponse({
    description:
      "No title, an invalid date or time, an end not after the start, an item outside the Agenda's day, or an unknown field.",
  })
  create(@Body() dto: CreateCalendarEventDto): Promise<CalendarEventResponseDto> {
    return this.calendarEventService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change an Agenda item",
    description:
      "Title, day, start and end. Omitted fields are unchanged; a null end means one hour after the start. A new day moves the whole item.",
  })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  @ApiBadRequestResponse({
    description:
      "An empty title, an impossible day or time, an end not after the start, an item outside the Agenda's day, or an unknown field.",
  })
  @ApiNotFoundResponse({ description: "No Agenda item with that id." })
  update(
    @Param() params: CalendarEventIdParamDto,
    @Body() dto: UpdateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    return this.calendarEventService.update(params.id, dto);
  }

  /**
   * 200 with the removed item rather than 204, the convention every DELETE in
   * this API follows: each response carries the standard envelope.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete an Agenda item",
    description:
      "Physically removes the item; nothing else is affected. Answers with the item that was removed.",
  })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({
    description: "No Agenda item with that id, including one already deleted.",
  })
  remove(
    @Param() params: CalendarEventIdParamDto,
  ): Promise<CalendarEventResponseDto> {
    return this.calendarEventService.remove(params.id);
  }
}
