import {
  assignLanes,
  overlaps,
  toMinutes,
  type LanedRange,
  type TimeRange,
} from "./clock";

/**
 * Where each Agenda item is drawn in its day column.
 *
 * PRESENTATION ONLY. The backend decided which items exist, when they start and
 * end, and which hours the day has; this turns that into positions.
 *
 * ── SIDE BY SIDE, NEVER ON TOP ──────────────────────────────────────────────
 * Items that overlap share the width: each gets a column of its overlap
 * cluster — the same lane assignment the rest of the application uses — and
 * widens into the columns to its right that nothing it overlaps is using. So a
 * long item beside two short, consecutive ones is not squeezed for its whole
 * length, and every item keeps an area of its own to tap.
 *
 * Half-open, like every overlap in this application: an item ending at 11:00
 * and one starting at 11:00 do not overlap, and both get the full width.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MINUTES_PER_HOUR = 60;

/** A stretch of the day, in minutes since midnight. */
export interface AgendaWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface AgendaBlock<TItem> {
  readonly item: TItem;
  readonly range: TimeRange;
  /** Distance from the top of the window, as a percentage of its height. */
  readonly topPercent: number;
  readonly heightPercent: number;
  /** The first column the item occupies; 0 is the leftmost. */
  readonly column: number;
  /** How many adjacent columns it occupies, its own included. */
  readonly columnSpan: number;
  /** How many columns its overlap cluster is divided into. */
  readonly columnCount: number;
}

interface TimedItem {
  startTime: string;
  endTime: string;
}

/** The window the backend's `dayStart`–`dayEnd` describe; null when unusable. */
export function toAgendaWindow(
  dayStart: string,
  dayEnd: string,
): AgendaWindow | null {
  const startMinute = toMinutes(dayStart);
  const endMinute = toMinutes(dayEnd);

  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    return null;
  }

  return { startMinute, endMinute };
}

/** The hours at which a window's hour blocks start: 6 … 22 for 06:00–23:00. */
export function hourBlocks(window: AgendaWindow): number[] {
  const first = Math.floor(window.startMinute / MINUTES_PER_HOUR);
  const last = Math.ceil(window.endMinute / MINUTES_PER_HOUR);

  return Array.from({ length: last - first }, (_, index) => first + index);
}

/** "06:00" for 6. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Lays out one day's items within a window.
 *
 * An item whose times cannot be read is left out rather than drawn at an
 * invented time. A range reaching outside the window is clamped to it.
 */
export function layOutAgendaDay<TItem extends TimedItem>(
  items: readonly TItem[],
  window: AgendaWindow,
): AgendaBlock<TItem>[] {
  const laned = assignLanes(
    items.flatMap((item) => {
      const range = toRange(item);

      return range ? [{ item, range }] : [];
    }),
  );

  return laned.map((entry) => ({
    item: entry.item,
    range: entry.range,
    ...verticalGeometry(entry.range, window),
    column: entry.lane,
    columnSpan: columnSpan(entry, laned),
    columnCount: entry.laneCount,
  }));
}

/**
 * The most columns any cluster needs. It decides how wide the day must be for
 * every item to stay wide enough to read and tap.
 */
export function widestCluster(blocks: readonly AgendaBlock<unknown>[]): number {
  return blocks.reduce((widest, block) => Math.max(widest, block.columnCount), 1);
}

/**
 * The part of the day a compact view needs: from the hour the first item
 * starts to the hour the last one ends, inside the day. Null when there is
 * nothing to show.
 */
export function windowAround(
  items: readonly TimedItem[],
  day: AgendaWindow,
): AgendaWindow | null {
  const ranges = items.flatMap((item) => {
    const range = toRange(item);

    return range ? [range] : [];
  });

  if (ranges.length === 0) {
    return null;
  }

  const first = Math.min(...ranges.map((range) => range.startMinute));
  const last = Math.max(...ranges.map((range) => range.endMinute));

  return {
    startMinute: Math.max(
      day.startMinute,
      Math.floor(first / MINUTES_PER_HOUR) * MINUTES_PER_HOUR,
    ),
    endMinute: Math.min(
      day.endMinute,
      Math.ceil(last / MINUTES_PER_HOUR) * MINUTES_PER_HOUR,
    ),
  };
}

function toRange(item: TimedItem): TimeRange | null {
  const startMinute = toMinutes(item.startTime);
  const endMinute = toMinutes(item.endTime);

  return startMinute === null || endMinute === null
    ? null
    : { startMinute, endMinute };
}

/** Its own column, and each column to its right that nothing it overlaps uses. */
function columnSpan<TItem>(
  entry: LanedRange<TItem>,
  laned: readonly LanedRange<TItem>[],
): number {
  let span = 1;

  for (let column = entry.lane + 1; column < entry.laneCount; column += 1) {
    const isTaken = laned.some(
      (other) =>
        other.cluster === entry.cluster &&
        other.lane === column &&
        overlaps(other.range, entry.range),
    );

    if (isTaken) {
      break;
    }

    span += 1;
  }

  return span;
}

function verticalGeometry(
  range: TimeRange,
  window: AgendaWindow,
): { topPercent: number; heightPercent: number } {
  const span = window.endMinute - window.startMinute;
  const start = clamp(range.startMinute, window.startMinute, window.endMinute);
  const end = clamp(range.endMinute, window.startMinute, window.endMinute);

  return {
    topPercent: ((start - window.startMinute) / span) * 100,
    heightPercent: ((end - start) / span) * 100,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
