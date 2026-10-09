"use client";

import type { CalendarEvent } from "@/lib/api/calendar-events";
import {
  hourBlocks,
  hourLabel,
  layOutAgendaDay,
  widestCluster,
  type AgendaWindow,
} from "@/lib/calendar/agenda-layout";
import { cn } from "@/lib/cn";
import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import {
  dayInWeekLabel,
  dayOfMonthLabel,
  weekdayShortLabel,
} from "@/lib/ritten/date-labels";
import { AgendaDayColumn } from "./agenda-day-column";
import { useLocalNow } from "./use-local-now";

/** Tall enough to read a half-hour item's title and to hit it with a finger. */
const HOUR_HEIGHT_REM = 3;
const TIME_COLUMN_WIDTH_REM = 3.5;
/** A day narrower than this stops being readable; the week then scrolls sideways. */
const MIN_DAY_WIDTH_REM = 7;
/** Every side-by-side item keeps at least this much: a busy day widens instead. */
const MIN_ITEM_WIDTH_REM = 4.5;
const MINUTES_PER_HOUR = 60;

/**
 * The Agenda as a calendar: a narrow time column on the left and one column per
 * day, an hour block per hour, every item a block exactly as tall as it lasts.
 *
 * The calendar gives it a week; the Dashboard gives it today — one grid.
 *
 * Positions come from `layOutAgendaDay`, one day at a time, so overlapping items
 * stand side by side and items on different days never affect each other. When
 * the days need more width than there is — a tablet in portrait — the grid
 * scrolls sideways inside its own frame, with the day headings and the time
 * column held in place, rather than squeezing an item below a usable width.
 * Nothing depends on hover.
 */
export function AgendaGrid({
  days,
  items,
  window,
  label,
  hourHeightRem = HOUR_HEIGHT_REM,
  showDayHeaders = true,
  scrollClassName = "max-h-[75vh]",
  scrollRestorationId,
  onCreateAt,
  onOpen,
  itemHref,
}: {
  days: readonly string[];
  items: readonly CalendarEvent[];
  window: AgendaWindow;
  /** The accessible name of the whole grid. */
  label: string;
  hourHeightRem?: number;
  showDayHeaders?: boolean;
  /** The height the grid scrolls within. */
  scrollClassName?: string;
  /**
   * Set where the grid is the page's own scroller (the Agenda), so Back
   * returns to the same hour and day; not on the Dashboard's small preview.
   */
  scrollRestorationId?: string;
  /** On the calendar: a click on an empty hour starts a new item there. */
  onCreateAt?: (date: string, startTime: string) => void;
  /** On the calendar: a click on an item opens it. */
  onOpen?: (item: CalendarEvent) => void;
  /** On the Dashboard: an item links to itself in the calendar instead. */
  itemHref?: (item: CalendarEvent) => string;
}) {
  const t = useTranslation();
  const { language } = useLanguage();
  const now = useLocalNow();
  const heightRem = ((window.endMinute - window.startMinute) / MINUTES_PER_HOUR) * hourHeightRem;

  const columns = days.map((date) => {
    const blocks = layOutAgendaDay(
      items.filter((item) => item.date === date),
      window,
    );

    return {
      date,
      blocks,
      minWidthRem: Math.max(MIN_DAY_WIDTH_REM, widestCluster(blocks) * MIN_ITEM_WIDTH_REM),
    };
  });
  const template = [
    `${TIME_COLUMN_WIDTH_REM}rem`,
    ...columns.map((column) => `minmax(${column.minWidthRem}rem, 1fr)`),
  ].join(" ");
  const minWidthRem = columns.reduce(
    (total, column) => total + column.minWidthRem,
    TIME_COLUMN_WIDTH_REM,
  );

  return (
    <div
      className={cn("overflow-auto", scrollClassName)}
      data-scroll-restoration-id={scrollRestorationId}
    >
      <div role="group" aria-label={label} style={{ minWidth: `${minWidthRem}rem` }}>
        {showDayHeaders ? (
          <div
            className="sticky top-0 z-20 grid border-b border-border bg-card"
            style={{ gridTemplateColumns: template }}
          >
            <div className="sticky left-0 z-30 bg-card" />
            {columns.map(({ date }) => (
              <div
                key={date}
                className={cn(
                  "border-l border-border px-1 py-1.5 text-center",
                  date === now.date && "bg-primary/10",
                )}
              >
                <span className="block text-xs font-medium uppercase tracking-wide text-secondary">
                  {weekdayShortLabel(date, language)}
                </span>
                <span
                  className={cn(
                    "block text-sm font-semibold tabular-nums",
                    date === now.date ? "text-primary" : "text-foreground",
                  )}
                >
                  {dayOfMonthLabel(date, language)}
                </span>
                {date === now.date ? (
                  <span className="sr-only">{t("agenda.todayMarker")}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid pb-2 pt-3" style={{ gridTemplateColumns: template }}>
          <TimeColumn window={window} heightRem={heightRem} />
          {columns.map(({ date, blocks }) => (
            <AgendaDayColumn
              key={date}
              date={date}
              dayLabel={dayInWeekLabel(date, language)}
              blocks={blocks}
              window={window}
              heightRem={heightRem}
              isToday={date === now.date}
              nowMinute={date === now.date ? now.minute : null}
              onCreateAt={onCreateAt}
              onOpen={onOpen}
              itemHref={itemHref}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The hour labels, held in place while the days scroll sideways. */
function TimeColumn({ window, heightRem }: { window: AgendaWindow; heightRem: number }) {
  const hours = hourBlocks(window);
  const spanMinutes = window.endMinute - window.startMinute;

  return (
    <div
      aria-hidden="true"
      className="sticky left-0 z-10 bg-card"
      style={{ height: `${heightRem}rem` }}
    >
      {[...hours, hours[hours.length - 1] + 1].map((hour) => (
        <span
          key={hour}
          className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-secondary"
          style={{
            top: `${((hour * MINUTES_PER_HOUR - window.startMinute) / spanMinutes) * 100}%`,
          }}
        >
          {hourLabel(hour)}
        </span>
      ))}
    </div>
  );
}
