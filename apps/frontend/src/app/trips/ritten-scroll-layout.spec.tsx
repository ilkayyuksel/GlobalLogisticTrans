import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildPage, buildTrip, renderRitten, respondWith } from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * How the Ritten list scrolls: by the PAGE, down and sideways, every day at
 * once — with the day headings and column headers stuck to the window like a
 * frozen row in Excel.
 *
 * jsdom has no layout, so it cannot show a header staying in view or the last
 * Trip being reachable; that was checked in a real browser. What it CAN hold
 * is the structure that makes it work: no box with an `overflow` or a height
 * limit anywhere between a table and the page — any such box becomes the
 * headers' scroll container, which either lets them scroll away or shuts the
 * list in a scroll box of its own, cut off at the screen's height — and the
 * sticky rules on the headings and column headers.
 */

const WEEK = [
  buildTrip({ id: "trip-mon", bookingNumber: "ANRDUB2600010", planningDate: "2026-08-10" }),
  buildTrip({ id: "trip-wed", bookingNumber: "ANRDUB2600012", planningDate: "2026-08-12" }),
  buildTrip({ id: "trip-thu", bookingNumber: "ANRDUB2600013", planningDate: "2026-08-13" }),
];

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  respondWith(requestMock, { trips: buildPage(WEEK) });
});

async function showView(view: "Dag" | "Week" | "Maand") {
  renderRitten();
  await screen.findByRole("link", { name: "ANRDUB2600013" });

  if (view !== "Dag") {
    await userEvent.click(screen.getByRole("radio", { name: view }));
  }

  await screen.findByRole("link", { name: "ANRDUB2600013" });
}

const region = () => screen.getByTestId("ritten-scroll-region");

/** Every element from the table up to the page itself. */
function boxesUpToThePage(table: HTMLElement): HTMLElement[] {
  const boxes: HTMLElement[] = [];

  for (let element = table.parentElement; element && element !== document.body; element = element.parentElement) {
    boxes.push(element);
  }

  return boxes;
}

/** A class that would make a box a scroll container or cap its height. */
const SCROLL_BOX = /overflow|max-h-|\bh-screen\b|\bh-\[/;

describe("the Ritten list's scrolling", () => {
  it("puts every day of the week in one scroller", async () => {
    await showView("Week");

    const tables = within(region()).getAllByRole("table");

    expect(tables).toHaveLength(3);
    expect(screen.getAllByTestId("ritten-scroll-region")).toHaveLength(1);
  });

  /** The page scrolls the list: nothing between a table and it is a scroll box. */
  it("puts no scroll box and no height limit between any day and the page", async () => {
    await showView("Week");

    for (const table of within(region()).getAllByRole("table")) {
      for (const box of boxesUpToThePage(table)) {
        expect(box.className).not.toMatch(SCROLL_BOX);
      }
    }
  });

  it("makes every day as wide as the widest, so they move sideways as one", async () => {
    await showView("Week");

    expect(region().firstElementChild?.className).toMatch(/\bw-fit\b.*\bmin-w-full\b/);
    // The frame the sticky headings take their width from.
    expect(region().className).toMatch(/\[container-type:inline-size\]/);
  });

  /** The window's own position is what Back restores; the list keeps none of its own. */
  it("keeps no scroll position of its own", async () => {
    await showView("Week");

    expect(document.querySelectorAll("[data-scroll-restoration-id]")).toHaveLength(0);
  });

  it("sticks every day heading to the top, held in view sideways", async () => {
    await showView("Week");

    // Every day of the week has its section, an empty one included.
    const headings = within(region()).getAllByRole("heading", { level: 2 });

    expect(headings).toHaveLength(7);
    for (const heading of headings) {
      const header = heading.closest("header") as HTMLElement;

      expect(header.className).toMatch(/\bsticky\b/);
      expect(header.className).toMatch(/\btop-0\b/);
      expect(header.className).toMatch(/\bleft-0\b/);
      expect(header.className).toMatch(/\bh-12\b/);
    }
  });

  it("sticks every column header just under its day heading", async () => {
    await showView("Week");

    for (const table of within(region()).getAllByRole("table")) {
      // The header row only: a truck's heading inside the body scrolls with its rows.
      const headers = [...table.querySelectorAll<HTMLElement>("thead th")];

      expect(headers.length).toBeGreaterThan(5);
      for (const header of headers) {
        expect(header.className).toMatch(/\bsticky\b/);
        expect(header.className).toMatch(/\btop-12\b/);
        // Opaque: rows slide underneath it.
        expect(header.className).toMatch(/\bbg-card\b/);
      }
    }
  });

  it.each(["Dag", "Maand"] as const)("is scrolled by the page in the %s view too", async (view) => {
    await showView(view);

    for (const table of within(region()).getAllByRole("table")) {
      expect(boxesUpToThePage(table).some((box) => SCROLL_BOX.test(box.className))).toBe(false);
    }
  });
});
