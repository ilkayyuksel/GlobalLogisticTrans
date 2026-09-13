"use client";

import type { CalendarEvent } from "@/lib/api/calendar-events";
import {
  hourBlocks,
  hourLabel,
  type AgendaBlock,
  type AgendaWindow,
} from "@/lib/calendar/agenda-layout";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/lib/i18n/language-provider";
import { AgendaItemBlock } from "./agenda-item-block";

const MINUTES_PER_HOUR = 60;

/** The free strip right of every hour, so an occupied hour can still take a new item. */
const CREATE_GUTTER_REM = 1;

/**
 * One day of the week: an hour block per hour, the day's items on top, and —
 * on today — a line at the current time.
 *
 * Clicks between items fall through to the hour beneath them, and the strip on
 * the right of every hour stays free, so an hour that already holds an item can
 * still take another.
 */
export function AgendaDayColumn({
  date,
  dayLabel,
  blocks,
  window,
  heightRem,
  isToday,
  nowMinute,
  onCreateAt,
  onOpen,
  itemHref,
}: {
  date: string;
  /** "Maandag 14 september" — the column's accessible name. */
  dayLabel: string;
  blocks: readonly AgendaBlock<CalendarEvent>[];
  window: AgendaWindow;
  heightRem: number;
  isToday: boolean;
  /** The operator's local minute when this column is today; null otherwise. */
  nowMinute: number | null;
  onCreateAt?: (date: string, startTime: string) => void;
  onOpen?: (item: CalendarEvent) => void;
  itemHref?: (item: CalendarEvent) => string;
}) {
  const t = useTranslation();
  const spanMinutes = window.endMinute - window.startMinute;
  const percentAt = (minute: number) =>
    ((minute - window.startMinute) / spanMinutes) * 100;
  const showsNow =
    nowMinute !== null &&
    nowMinute >= window.startMinute &&
    nowMinute <= window.endMinute;

  return (
    <div
      role="group"
      aria-label={dayLabel}
      aria-current={isToday ? "date" : undefined}
      className={cn("relative border-l border-border", isToday && "bg-primary/5")}
      style={{ height: `${heightRem}rem` }}
    >
      {hourBlocks(window).map((hour) => {
        const style = {
          top: `${Math.max(0, percentAt(hour * MINUTES_PER_HOUR))}%`,
          height: `${(MINUTES_PER_HOUR / spanMinutes) * 100}%`,
        };

        return onCreateAt ? (
          <button
            key={hour}
            type="button"
            onClick={() => onCreateAt(date, hourLabel(hour))}
            aria-label={t("agenda.slot.create")
              .replace("{day}", dayLabel)
              .replace("{time}", hourLabel(hour))}
            className="absolute inset-x-0 border-t border-border hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            style={style}
          />
        ) : (
          <div
            key={hour}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-border"
            style={style}
          />
        );
      })}

      {showsNow ? (
        <div
          aria-hidden="true"
          data-agenda-now=""
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
          style={{ top: `${percentAt(nowMinute)}%` }}
        >
          <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-danger" />
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{ right: `${onCreateAt ? CREATE_GUTTER_REM : 0}rem` }}
      >
        {blocks.map((block) => (
          <AgendaItemBlock
            key={block.item.id}
            block={block}
            onOpen={onOpen}
            href={itemHref?.(block.item)}
          />
        ))}
      </div>
    </div>
  );
}
