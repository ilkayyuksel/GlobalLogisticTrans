import { Injectable } from "@nestjs/common";
import { CalendarEvent, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreateCalendarEventData = Prisma.CalendarEventUncheckedCreateInput;
export type UpdateCalendarEventData = Prisma.CalendarEventUncheckedUpdateInput;

/** By day, then start, the shorter item first, and the id keeps it stable. */
const RANGE_ORDER = [
  { startDate: "asc" },
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
   * Every item whose day lies in the range, both ends included, in one query on
   * the `start_date` index, ordered by PostgreSQL. Agenda items are single-day,
   * so the start date alone decides the day — the calendar's week and the
   * Dashboard's today are the same question over different ranges.
   */
  findForRange(from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.prisma.calendarEvent.findMany({
      where: { startDate: { gte: from, lte: to } },
      orderBy: RANGE_ORDER,
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
