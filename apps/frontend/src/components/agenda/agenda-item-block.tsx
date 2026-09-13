"use client";

import Link from "next/link";

import type { CalendarEvent } from "@/lib/api/calendar-events";
import type { AgendaBlock } from "@/lib/calendar/agenda-layout";
import { toClockLabel } from "@/lib/calendar/clock";
import { cn } from "@/lib/cn";

/**
 * One Agenda item: a coloured block exactly as tall as the item lasts, in its
 * own column of the day. A button on the calendar and a link on the Dashboard —
 * either way an ordinary control, so a tap does what a click does.
 *
 * A dashed edge marks an item reaching outside the hours the day shows: it is
 * drawn at the nearest edge with its real times, never hidden.
 */
export function AgendaItemBlock({
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
  const name = `${item.title}, ${time}`;
  const className = cn(
    "flex h-full w-full flex-col overflow-hidden rounded-md border border-l-4 border-primary/30 border-l-primary bg-primary/15 px-1.5 py-0.5 text-left text-xs text-foreground hover:bg-primary/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
    block.isClipped && "border-dashed",
  );
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
        <Link href={href} aria-label={name} title={name} className={className}>
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={name}
          title={name}
          onClick={() => onOpen?.(item)}
          className={className}
        >
          {content}
        </button>
      )}
    </div>
  );
}
