"use client";

import Link from "next/link";

import type { CalendarEvent } from "@/lib/api/calendar-events";
import {
  hourBlocks,
  hourLabel,
  layOutAgendaDay,
  widestCluster,
  type AgendaBlock,
  type AgendaWindow,
} from "@/lib/calendar/agenda-layout";
import { toClockLabel } from "@/lib/calendar/clock";
import { useTranslation } from "@/lib/i18n/language-provider";

/** Tall enough to read a half-hour item's title and to hit it with a finger. */
const HOUR_HEIGHT_REM = 3.5;

/** Narrower than this, an item's title is unreadable and it is hard to tap. */
const MIN_COLUMN_WIDTH_REM = 7;

/** The free strip right of every hour, so an occupied hour can still take a new item. */
const CREATE_GUTTER_REM = 1.5;

const TIME_COLUMN_WIDTH_REM = 3.5;
const MINUTES_PER_HOUR = 60;

/**
 * One day of the Agenda: a narrow time column on the left, the day on the
 * right, one horizontal block per hour, and every item a coloured block exactly
 * as tall as it lasts.
 *
 * Positions come from `layOutAgendaDay`; this only draws them. Overlapping
 * items stand side by side, and when a day needs more columns than fit, the day
 * scrolls sideways instead of squeezing an item below a usable width — so
 * horizontal scrolling appears only when it is really needed.
 *
 * Nothing depends on hover: an hour block and an item are ordinary buttons (or,
 * on the Dashboard, links), so a tap on a tablet does what a click does.
 */
export function AgendaDayGrid({
  items,
  window,
  label,
  hourHeightRem = HOUR_HEIGHT_REM,
  onCreateAt,
  onOpen,
  itemHref,
}: {
  items: readonly CalendarEvent[];
  window: AgendaWindow;
  /** The accessible name of the day. */
  label: string;
  hourHeightRem?: number;
  /** On the calendar: a click on an empty hour starts a new item at that hour. */
  onCreateAt?: (startTime: string) => void;
  /** On the calendar: a click on an item opens it. */
  onOpen?: (item: CalendarEvent) => void;
  /** On the Dashboard: an item links to itself in the calendar instead. */
  itemHref?: (item: CalendarEvent) => string;
}) {
  const t = useTranslation();
  const blocks = layOutAgendaDay(items, window);
  const hours = hourBlocks(window);
  const spanMinutes = window.endMinute - window.startMinute;
  const gutterRem = onCreateAt ? CREATE_GUTTER_REM : 0;
  const percentAt = (minute: number) =>
    ((minute - window.startMinute) / spanMinutes) * 100;

  return (
    <div className="overflow-x-auto">
      <div
        role="group"
        aria-label={label}
        className="flex py-2"
        style={{
          minWidth: `${TIME_COLUMN_WIDTH_REM + widestCluster(blocks) * MIN_COLUMN_WIDTH_REM + gutterRem}rem`,
        }}
      >
        <div
          aria-hidden="true"
          className="relative shrink-0"
          style={{
            width: `${TIME_COLUMN_WIDTH_REM}rem`,
            height: `${(spanMinutes / MINUTES_PER_HOUR) * hourHeightRem}rem`,
          }}
        >
          {[...hours, hours[hours.length - 1] + 1].map((hour) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-secondary"
              style={{ top: `${percentAt(hour * MINUTES_PER_HOUR)}%` }}
            >
              {hourLabel(hour)}
            </span>
          ))}
        </div>

        <div className="relative flex-1 border-b border-l border-border">
          {hours.map((hour) => {
            const style = {
              top: `${Math.max(0, percentAt(hour * MINUTES_PER_HOUR))}%`,
              height: `${(MINUTES_PER_HOUR / spanMinutes) * 100}%`,
            };

            return onCreateAt ? (
              <button
                key={hour}
                type="button"
                onClick={() => onCreateAt(hourLabel(hour))}
                aria-label={t("agenda.slot.create").replace("{time}", hourLabel(hour))}
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

          {/* Clicks between items fall through to the hour beneath. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{ right: `${gutterRem}rem` }}
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
      </div>
    </div>
  );
}

function AgendaItemBlock({
  block,
  onOpen,
  href,
}: {
  block: AgendaBlock<CalendarEvent>;
  onOpen?: (item: CalendarEvent) => void;
  href?: string;
}) {
  const { item } = block;
  const time = `${toClockLabel(item.startTime)}–${toClockLabel(item.endTime)}`;
  const className =
    "flex h-full w-full flex-col overflow-hidden rounded-md border border-primary/30 border-l-4 border-l-primary bg-primary/15 px-2 py-0.5 text-left text-xs text-foreground hover:bg-primary/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  const content = (
    <>
      <span className="truncate font-semibold">{item.title}</span>
      <span className="truncate tabular-nums text-secondary">{time}</span>
    </>
  );

  return (
    <div
      className="pointer-events-auto absolute min-h-6 p-px"
      style={{
        top: `${block.topPercent}%`,
        height: `${block.heightPercent}%`,
        left: `${(block.column / block.columnCount) * 100}%`,
        width: `${(block.columnSpan / block.columnCount) * 100}%`,
      }}
    >
      {href ? (
        <Link href={href} aria-label={`${item.title}, ${time}`} className={className}>
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={`${item.title}, ${time}`}
          onClick={() => onOpen?.(item)}
          className={className}
        >
          {content}
        </button>
      )}
    </div>
  );
}
