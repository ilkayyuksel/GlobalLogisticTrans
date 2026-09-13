"use client";

import { useCallback } from "react";

import { AgendaDayGrid } from "@/components/agenda/agenda-day-grid";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { getCalendarDay } from "@/lib/api/calendar-events";
import { toAgendaWindow, windowAround } from "@/lib/calendar/agenda-layout";
import { today } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { WidgetLink } from "./widget-link";

/** Short enough to sit in the headline row; the full day is one click away. */
const COMPACT_HOUR_HEIGHT_REM = 2.5;

/**
 * Today's Agenda, compact.
 *
 * The calendar's own day endpoint, asked for today, drawn by the calendar's own
 * grid — only the hours that hold items, and nothing to create. So it cannot
 * disagree with the calendar: the same items, in the same order, overlapping
 * the same way. It is fetched whenever the Dashboard opens, so a change made in
 * the calendar is there on the way back.
 *
 * Every item links to itself in the calendar, where it can be changed.
 */
export function AgendaToday() {
  const t = useTranslation();
  const date = today();

  const day = useAsync(
    useCallback((signal: AbortSignal) => getCalendarDay(date, signal), [date]),
    [date],
  );

  const dayWindow = day.data
    ? toAgendaWindow(day.data.dayStart, day.data.dayEnd)
    : null;
  const shown =
    day.data && dayWindow ? windowAround(day.data.items, dayWindow) : null;

  return (
    <Card>
      <CardHeader title={t("dashboard.calendar.title")} />

      {day.isLoading && !day.data ? (
        <LoadingState label={t("agenda.loading")} />
      ) : null}

      {!day.isLoading && day.error ? (
        <ErrorState error={day.error} onRetry={day.reload} />
      ) : null}

      {day.data && day.data.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-secondary">
          {t("dashboard.calendar.empty")}
        </p>
      ) : null}

      {day.data && shown ? (
        <div className="max-h-48 overflow-y-auto px-2">
          <AgendaDayGrid
            items={day.data.items}
            window={shown}
            hourHeightRem={COMPACT_HOUR_HEIGHT_REM}
            label={t("dashboard.calendar.title")}
            itemHref={(item) => `/calendar?date=${item.date}&event=${item.id}`}
          />
        </div>
      ) : null}

      <div className="border-t border-border px-5 py-3">
        <WidgetLink href="/calendar" labelKey="dashboard.calendar.link" />
      </div>
    </Card>
  );
}
