/**
 * Turning clock times into positions on a day timeline.
 *
 * PRESENTATION ONLY. Nothing here decides whether a Trip is valid, whether an
 * overlap is allowed, or what a Trip means — it converts `HH:MM:SS` into
 * percentages so a card can be drawn. The backend owns every rule; this owns
 * pixels.
 */

/** The board shows a working day rather than a full 24 hours. */
export const BOARD_START_HOUR = 5;
export const BOARD_END_HOUR = 22;

const MINUTES_PER_HOUR = 60;
const BOARD_START_MINUTE = BOARD_START_HOUR * MINUTES_PER_HOUR;
const BOARD_END_MINUTE = BOARD_END_HOUR * MINUTES_PER_HOUR;
const BOARD_SPAN_MINUTES = BOARD_END_MINUTE - BOARD_START_MINUTE;

/** A card thinner than this is unreadable, however short the Trip. */
const MINIMUM_WIDTH_PERCENT = 2.5;

export interface TimeRange {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface CardGeometry {
  /** Distance from the left edge of the timeline, as a percentage. */
  readonly leftPercent: number;
  readonly widthPercent: number;
  /** Which overlap row the card sits in; 0 is the top row. */
  readonly lane: number;
  /** How many rows this card's overlap cluster needs. */
  readonly laneCount: number;
}

/**
 * Minutes since midnight, or null when the value is not a clock time.
 *
 * The backend sends `HH:MM:SS`. Anything else — an empty string, a malformed
 * value — returns null rather than a guess, because a Trip placed at a
 * fabricated time is worse than a Trip shown as having no time.
 */
export function toMinutes(clockTime: string | null): number | null {
  if (!clockTime) {
    return null;
  }

  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(clockTime);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * MINUTES_PER_HOUR + minutes;
}

/**
 * The interval of a Trip, when it has one.
 *
 * BOTH ends are required. A Trip with only a start has no duration that can be
 * drawn, and inventing one — an hour, say — would put a length on the board
 * that no data supports.
 */
export function toTimeRange(
  startTime: string | null,
  endTime: string | null,
): TimeRange | null {
  const startMinute = toMinutes(startTime);
  const endMinute = toMinutes(endTime);

  if (startMinute === null || endMinute === null) {
    return null;
  }

  return { startMinute, endMinute };
}

/** The hour labels down the timeline. */
export function boardHours(): number[] {
  return Array.from(
    { length: BOARD_END_HOUR - BOARD_START_HOUR + 1 },
    (_, index) => BOARD_START_HOUR + index,
  );
}

/** Where an hour marker sits, as a percentage across the timeline. */
export function hourPercent(hour: number): number {
  return (
    ((hour * MINUTES_PER_HOUR - BOARD_START_MINUTE) / BOARD_SPAN_MINUTES) * 100
  );
}

/**
 * Two intervals overlap when each starts before the other ends.
 *
 * Half-open, matching the backend's own overlap comparison: a Trip ending at
 * 12:00 and one starting at 12:00 do not overlap. This is used only to decide
 * how to ARRANGE cards — it never judges whether an overlap is permitted, which
 * is the backend's business and is validated there.
 */
export function overlaps(left: TimeRange, right: TimeRange): boolean {
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

/**
 * Positions a set of timed items so that overlapping ones stay visible.
 *
 * Items are grouped into clusters of mutually overlapping ranges, and each
 * cluster is split into as many rows as it needs, so nothing is ever drawn on
 * top of anything else. A card that overlaps nothing gets the full height of
 * its lane.
 *
 * Ranges outside the board's hours are clamped to its edges so a Trip starting
 * at 04:00 still appears, pinned to the left, rather than vanishing.
 */
export function layOutRanges<TItem>(
  items: readonly { item: TItem; range: TimeRange }[],
): { item: TItem; range: TimeRange; geometry: CardGeometry }[] {
  const ordered = [...items].sort(
    (left, right) => left.range.startMinute - right.range.startMinute,
  );

  const clusters = toOverlapClusters(ordered);
  const positioned: { item: TItem; range: TimeRange; geometry: CardGeometry }[] =
    [];

  for (const cluster of clusters) {
    // Each row holds items that do not overlap each other, so a row can be
    // reused as soon as its last item has ended.
    const rowEnds: number[] = [];
    const laneByIndex = new Map<number, number>();

    cluster.forEach((entry, index) => {
      const lane = rowEnds.findIndex((end) => end <= entry.range.startMinute);
      const chosen = lane === -1 ? rowEnds.length : lane;

      rowEnds[chosen] = entry.range.endMinute;
      laneByIndex.set(index, chosen);
    });

    cluster.forEach((entry, index) => {
      positioned.push({
        ...entry,
        geometry: {
          ...toHorizontalGeometry(entry.range),
          lane: laneByIndex.get(index) ?? 0,
          laneCount: rowEnds.length,
        },
      });
    });
  }

  return positioned;
}

/**
 * Groups ranges into runs that overlap, directly or through a chain.
 *
 * A chain matters: if A overlaps B and B overlaps C, all three must share a
 * cluster even when A and C do not touch, or A and C would be drawn in the same
 * row and collide with B differently.
 */
function toOverlapClusters<TItem>(
  ordered: readonly { item: TItem; range: TimeRange }[],
): { item: TItem; range: TimeRange }[][] {
  const clusters: { item: TItem; range: TimeRange }[][] = [];
  let current: { item: TItem; range: TimeRange }[] = [];
  let clusterEnd = -1;

  for (const entry of ordered) {
    if (current.length > 0 && entry.range.startMinute >= clusterEnd) {
      clusters.push(current);
      current = [];
    }

    current.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.range.endMinute);
  }

  if (current.length > 0) {
    clusters.push(current);
  }

  return clusters;
}

function toHorizontalGeometry(range: TimeRange): {
  leftPercent: number;
  widthPercent: number;
} {
  const start = clamp(range.startMinute, BOARD_START_MINUTE, BOARD_END_MINUTE);
  const end = clamp(range.endMinute, BOARD_START_MINUTE, BOARD_END_MINUTE);

  const leftPercent = ((start - BOARD_START_MINUTE) / BOARD_SPAN_MINUTES) * 100;
  const rawWidth = ((end - start) / BOARD_SPAN_MINUTES) * 100;

  return {
    leftPercent,
    // A very short Trip must still be clickable, and a zero-width card would be
    // invisible — which would read as "this Trip is missing".
    widthPercent: Math.min(
      Math.max(rawWidth, MINIMUM_WIDTH_PERCENT),
      100 - leftPercent,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** `HH:MM:SS` shown as `HH:MM`; seconds are noise on a planning board. */
export function toClockLabel(clockTime: string | null): string | null {
  return clockTime ? clockTime.slice(0, 5) : null;
}
