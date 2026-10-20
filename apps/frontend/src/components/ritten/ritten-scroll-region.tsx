import type { ReactNode } from "react";

/**
 * The frame of the Ritten list — every day in it, scrolled by the PAGE.
 *
 * ── WHY NO SCROLL BOX OF ITS OWN ────────────────────────────────────────────
 * The column headers stick to the top like a frozen row in Excel. `position:
 * sticky` holds an element inside its nearest scroll container, and any box
 * with an `overflow` other than `visible` is one — also in the other
 * direction: a box that scrolls sideways is a vertical scroll container too.
 *
 *   one `overflow-x-auto` per day (the first version): every header stuck
 *     inside a box that never scrolled vertically, so it scrolled away;
 *   one box for every day, `overflow-auto` with a height just short of the
 *     screen (the second): the headers stuck, but the whole list was shut in a
 *     box of its own with a second scrollbar, cut off at the screen's height.
 *
 * So there is no scroll box at all. The page scrolls the list down, and — when
 * the pricing columns make a day wider than the screen — sideways too, every
 * day at once, like the sheet of an Excel workbook. The day headings and column
 * headers stick to the window (see `DateSection` and `RittenTable`); there is
 * no fixed bar above them for them to slide under.
 *
 * ── THE SIZES ───────────────────────────────────────────────────────────────
 * The inner box is as wide as the widest day needs (`fit-content`: the frame's
 * width, unless a table cannot fit in it) and every section fills it, so all
 * days have the same width and move as one. `container-type` lets a section's
 * heading be exactly as wide as the frame — see `STICKY_VISIBLE_WIDTH`.
 *
 * The window's own scroll position, down and sideways, is what is remembered
 * across Back.
 */
export function RittenScrollRegion({ children }: { children: ReactNode }) {
  return (
    <div data-testid="ritten-scroll-region" className="[container-type:inline-size]">
      <div className="w-fit min-w-full space-y-4">{children}</div>
    </div>
  );
}

/**
 * The width of the frame's visible part. Held `sticky left-0`, an element this
 * wide stays in view however far the page is scrolled sideways.
 */
export const STICKY_VISIBLE_WIDTH = "sticky left-0 w-[100cqw]";
