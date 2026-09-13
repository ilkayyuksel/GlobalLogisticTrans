"use client";

import { useCallback } from "react";

import { AgendaGrid } from "@/components/agenda/agenda-grid";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { getCalendarRange } from "@/lib/api/calendar-events";
import { toAgendaWindow, windowAround } from "@/lib/calendar/agenda-layout";
import { today } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { WidgetLink } from "./widget-link";

/** Short enough to sit in the headline row; the full week is one click away. */
const COMPACT_HOUR_HEIGHT_REM = 2.5;

/**
 * Today's Agenda, compact — not the week.
 *
 * The calendar's own endpoint, asked for today to today, drawn by the calendar's
 * own grid with a single day: only the hours that hold items, and nothing to
 * create. So it cannot disagree with the calendar — the same items in time
 * order, and appointments at the same time side by side, exactly as the week
 * shows them. It is fetched whenever the Dashboard opens, so a change made in
 * the calendar is there on the way back.
 *
 * Every item links to itself in the calendar, where it can be changed.
 */
export function AgendaToday() {
  const t = useTranslation();
  const date = today();

  const day = useAsync(
    useCallback((signal: AbortSignal) => getCalendarRange(date, date, signal), [date]),
    [date],
  );

  const todaysItems = day.data?.items.filter((item) => item.date === date) ?? [];
  const dayWindow = day.data ? toAgendaWindow(day.data.dayStart, day.data.dayEnd) : null;
  const shown = dayWindow ? windowAround(todaysItems, dayWindow) : null;

  return (
    <Card>
      <CardHeader title={t("dashboard.calendar.title")} />

      {day.isLoading && !day.data ? <LoadingState label={t("agenda.loading")} /> : null}

      {!day.isLoading && day.error ? (
        <ErrorState error={day.error} onRetry={day.reload} />
      ) : null}

      {day.data && todaysItems.length === 0 ? (
        <p className="px-5 py-4 text-sm text-secondary">{t("dashboard.calendar.empty")}</p>
      ) : null}

      {shown ? (
        <div className="px-2">
          <AgendaGrid
            days={[date]}
            items={todaysItems}
            window={shown}
            label={t("dashboard.calendar.title")}
            hourHeightRem={COMPACT_HOUR_HEIGHT_REM}
            showDayHeaders={false}
            scrollClassName="max-h-48"
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
