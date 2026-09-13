import { Injectable } from "@nestjs/common";
import { CalendarEvent, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreateCalendarEventData = Prisma.CalendarEventUncheckedCreateInput;
export type UpdateCalendarEventData = Prisma.CalendarEventUncheckedUpdateInput;

/** A day reads by start, the shorter item first, and the id keeps it stable. */
const DAY_ORDER = [
  { startTime: "asc" },
  { endTime: "asc" },
  { id: "asc" },
] satisfies Prisma.CalendarEventOrderByWithRelationInput[];

/**
 * Database access for Agenda items. No rules: those are the service's.
 */
@Injectable()
export class CalendarEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every item on one day, in one query on the `start_date` index, ordered by
   * PostgreSQL. Agenda items are single-day, so the start date alone decides
   * which day an item belongs to — the Dashboard's "today" and the calendar's
   * day are the same question.
   */
  findForDay(date: Date): Promise<CalendarEvent[]> {
    return this.prisma.calendarEvent.findMany({
      where: { startDate: date },
      orderBy: DAY_ORDER,
    });
  }

  findById(id: string): Promise<CalendarEvent | null> {
    return this.prisma.calendarEvent.findUnique({ where: { id } });
  }

  create(data: CreateCalendarEventData): Promise<CalendarEvent> {
    return this.prisma.calendarEvent.create({ data });
  }

  update(id: string, data: UpdateCalendarEventData): Promise<CalendarEvent> {
    return this.prisma.calendarEvent.update({ where: { id }, data });
  }

  /**
   * Removes the row physically — calendar events are the one record the model
   * allows to be deleted. Resolves false when nothing was there to remove.
   */
  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.calendarEvent.deleteMany({
      where: { id },
    });

    return count === 1;
  }
}
