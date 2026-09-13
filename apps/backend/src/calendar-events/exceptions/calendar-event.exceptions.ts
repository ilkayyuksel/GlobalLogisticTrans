import { BadRequestException, NotFoundException } from "@nestjs/common";

import {
  AGENDA_DAY_END,
  AGENDA_DAY_START,
  AGENDA_RANGE_MAX_DAYS,
} from "../agenda-day";

/** Domain exceptions for the Agenda. */

export class CalendarEventNotFoundException extends NotFoundException {
  constructor(calendarEventId: string) {
    super(`Agenda item "${calendarEventId}" does not exist.`);
  }
}

export class CalendarEventEndNotAfterStartException extends BadRequestException {
  constructor(startTime: string, endTime: string) {
    super(`The end time ${endTime} must be after the start time ${startTime}.`);
  }
}

export class CalendarEventOutsideAgendaDayException extends BadRequestException {
  constructor(startTime: string, endTime: string) {
    super(
      `An Agenda item must lie between ${AGENDA_DAY_START} and ${AGENDA_DAY_END}; ${startTime}–${endTime} does not.`,
    );
  }
}

export class CalendarRangeInvalidException extends BadRequestException {
  constructor(from: string, to: string) {
    super(
      `The range ${from} to ${to} cannot be read: "to" may not lie before "from", and at most ${AGENDA_RANGE_MAX_DAYS} days can be asked for at once.`,
    );
  }
}
