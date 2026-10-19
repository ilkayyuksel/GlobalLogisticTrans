import type { ReactNode } from "react";

/**
 * The ONE scroller of the Ritten list, in both directions.
 *
 * ── WHY ONE ─────────────────────────────────────────────────────────────────
 * Every day section used to wrap its table in its own `overflow-x-auto`. In
 * the week and month views that meant scrolling every day sideways on its own,
 * and it made a sticky column header impossible: `position: sticky` holds an
 * element inside its nearest scroll container, and a box that scrolls only
 * sideways never scrolls vertically, so the header simply scrolled away with
 * the page.
 *
 * Here every section sits in one box that scrolls both ways. One sideways
 * movement takes every day along — no listeners, no synchronising, nothing that
 * can keep firing after the page is left — and the day headings and column
 * headers stick to the top of this box (see `DateSection` and `RittenTable`).
 *
 * ── THE SIZES ───────────────────────────────────────────────────────────────
 * The height stops just short of the viewport, so the box fits the screen once
 * the filters above it have scrolled past; the page is otherwise unchanged.
 *
 * The inner box is as wide as the widest day needs (`fit-content`: the
 * screen's width, unless a table cannot fit in it) and every section fills it,
 * so all days have the same width and move as one. `container-type` lets a
 * section's heading be exactly as wide as this box — see `STICKY_VISIBLE_WIDTH`.
 *
 * Its position is remembered across Back like the Agenda's grid: the window's
 * own scroll position is remembered anyway.
 */
export function RittenScrollRegion({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="ritten-scroll-region"
      data-scroll-restoration-id="ritten-list"
      className="max-h-[calc(100vh-3rem)] overflow-auto [container-type:inline-size]"
    >
      <div className="w-fit min-w-full space-y-4">{children}</div>
    </div>
  );
}

/**
 * The width of the region's visible part. Held `sticky left-0`, an element this
 * wide stays in view however far the days are scrolled sideways.
 */
export const STICKY_VISIBLE_WIDTH = "sticky left-0 w-[100cqw]";
