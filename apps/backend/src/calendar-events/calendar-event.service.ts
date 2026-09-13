import { Injectable } from "@nestjs/common";
import { CalendarEvent } from "@prisma/client";

import { addDays, toIsoDate, toUtcDate } from "../common/dates";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  AGENDA_DAY_END,
  AGENDA_DAY_START,
  AGENDA_RANGE_MAX_DAYS,
  AgendaSlot,
  agendaSlotProblem,
  minuteOfTimeColumn,
  resolveEndMinute,
  toClockLabelOfMinute,
  toMinuteOfDay,
  toTimeColumn,
} from "./agenda-day";
import { CalendarEventRepository } from "./calendar-event.repository";
import {
  CalendarEventResponseDto,
  CalendarRangeDto,
  toCalendarEventResponse,
} from "./dto/calendar-event-response.dto";
import { CreateCalendarEventDto } from "./dto/create-calendar-event.dto";
import { UpdateCalendarEventDto } from "./dto/update-calendar-event.dto";
import {
  CalendarEventEndNotAfterStartException,
  CalendarEventNotFoundException,
  CalendarEventOutsideAgendaDayException,
  CalendarRangeInvalidException,
} from "./exceptions/calendar-event.exceptions";

/**
 * The Agenda has no event types yet. `calendar_event.event_type` is NOT NULL, so
 * every item is stored as OTHER — the model's documented catch-all — until a
 * phase introduces types. It is not part of the API.
 */
export const AGENDA_EVENT_TYPE = "OTHER";

/**
 * The Agenda: the Administrator's own appointments, independent of Trips.
 *
 * Items have no status. An item is planned until it is changed or deleted, and
 * deleting removes it — calendar events are the one record the model allows to
 * be physically deleted.
 *
 * Titles are personal planning and never written to the log; ids, dates and
 * times are.
 */
@Injectable()
export class CalendarEventService {
  constructor(
    private readonly repository: CalendarEventRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CalendarEventService.name);
  }

  /**
   * The Agenda over a range of days, with the hours each day is drawn in. The
   * calendar asks for its week and the Dashboard for today — one dataset.
   */
  async findRange(from: string, to: string): Promise<CalendarRangeDto> {
    const first = toUtcDate(from);
    const last = toUtcDate(to);

    if (last < first || last > addDays(first, AGENDA_RANGE_MAX_DAYS - 1)) {
      throw new CalendarRangeInvalidException(from, to);
    }

    const events = await this.repository.findForRange(first, last);

    return {
      from,
      to,
      dayStart: AGENDA_DAY_START,
      dayEnd: AGENDA_DAY_END,
      items: events.map(toCalendarEventResponse),
    };
  }

  async findById(id: string): Promise<CalendarEventResponseDto> {
    return toCalendarEventResponse(await this.requireEvent(id));
  }

  async create(dto: CreateCalendarEventDto): Promise<CalendarEventResponseDto> {
    const slot = resolveSlot(
      toMinuteOfDay(dto.startTime),
      dto.endTime ? toMinuteOfDay(dto.endTime) : null,
    );

    const created = await this.repository.create({
      title: dto.title,
      eventType: AGENDA_EVENT_TYPE,
      startDate: toUtcDate(dto.date),
      startTime: toTimeColumn(slot.startMinute),
      // Single-day: the model's null end date.
      endDate: null,
      endTime: toTimeColumn(slot.endMinute),
    });

    this.logger.log("Agenda item created", {
      calendarEventId: created.id,
      date: dto.date,
      ...slotForLog(slot),
      endGiven: Boolean(dto.endTime),
    });

    return toCalendarEventResponse(created);
  }

  /**
   * A new day moves the whole item; it stays single-day. A start or end left out
   * keeps its stored value, so moving only the start past the end is refused
   * rather than silently repaired.
   */
  async update(
    id: string,
    dto: UpdateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    const existing = await this.requireEvent(id);

    const slot = resolveSlot(
      dto.startTime !== undefined
        ? toMinuteOfDay(dto.startTime)
        : minuteOfTimeColumn(existing.startTime),
      requestedEndMinute(dto, existing),
    );

    const updated = await this.repository.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.date !== undefined ? { startDate: toUtcDate(dto.date) } : {}),
      startTime: toTimeColumn(slot.startMinute),
      endTime: toTimeColumn(slot.endMinute),
    });

    this.logger.log("Agenda item updated", {
      calendarEventId: id,
      changedFields: Object.keys(dto),
      date: toIsoDate(updated.startDate),
      ...slotForLog(slot),
    });

    return toCalendarEventResponse(updated);
  }

  /** Answers with the item that was removed. */
  async remove(id: string): Promise<CalendarEventResponseDto> {
    const existing = await this.requireEvent(id);

    if (!(await this.repository.delete(id))) {
      // Another request removed it between the read and now.
      throw new CalendarEventNotFoundException(id);
    }

    this.logger.log("Agenda item deleted", {
      calendarEventId: id,
      date: toIsoDate(existing.startDate),
    });

    return toCalendarEventResponse(existing);
  }

  private async requireEvent(id: string): Promise<CalendarEvent> {
    const event = await this.repository.findById(id);

    if (!event) {
      throw new CalendarEventNotFoundException(id);
    }

    return event;
  }
}

/** The end an update asks for: omitted keeps the stored one, null asks for the default. */
function requestedEndMinute(
  dto: UpdateCalendarEventDto,
  existing: CalendarEvent,
): number | null {
  if (dto.endTime === undefined) {
    return existing.endTime ? minuteOfTimeColumn(existing.endTime) : null;
  }

  return dto.endTime === null ? null : toMinuteOfDay(dto.endTime);
}

/** The slot an item gets, or the reason it cannot have it. */
function resolveSlot(startMinute: number, endMinute: number | null): AgendaSlot {
  const slot = {
    startMinute,
    endMinute: resolveEndMinute(startMinute, endMinute),
  };
  const start = toClockLabelOfMinute(slot.startMinute);
  const end = toClockLabelOfMinute(slot.endMinute);

  switch (agendaSlotProblem(slot)) {
    case "END_NOT_AFTER_START":
      throw new CalendarEventEndNotAfterStartException(start, end);
    case "OUTSIDE_AGENDA_DAY":
      throw new CalendarEventOutsideAgendaDayException(start, end);
    default:
      return slot;
  }
}

function slotForLog(slot: AgendaSlot): { startTime: string; endTime: string } {
  return {
    startTime: toClockLabelOfMinute(slot.startMinute),
    endTime: toClockLabelOfMinute(slot.endMinute),
  };
}
