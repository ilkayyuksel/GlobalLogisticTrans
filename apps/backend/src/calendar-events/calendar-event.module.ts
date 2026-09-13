import { Module } from "@nestjs/common";

import { CalendarEventController } from "./calendar-event.controller";
import { CalendarEventRepository } from "./calendar-event.repository";
import { CalendarEventService } from "./calendar-event.service";

/**
 * The Agenda.
 *
 * PrismaModule and LoggerModule are global, so nothing needs importing. Nothing
 * is exported: calendar events are independent of every other domain, and the
 * Dashboard reads them through the same endpoint the calendar does.
 */
@Module({
  controllers: [CalendarEventController],
  providers: [CalendarEventService, CalendarEventRepository],
})
export class CalendarEventModule {}
