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
 * How the Ritten list scrolls: ONE scroller for every day, so one sideways
 * movement takes the whole week along and the headers can stick.
 *
 * jsdom has no layout, so it cannot show a header staying in view; that was
 * checked in a real browser. What it CAN hold is the structure that makes it
 * work: every day's table inside the same scroller, no scroller of its own
 * between them, and the sticky rules on the headings and column headers. A
 * table regaining its own `overflow` box would silently bring back both
 * problems, which is what these tests stop.
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

/** Every element from the table up to (not including) the region. */
function boxesBetween(table: HTMLElement): HTMLElement[] {
  const boxes: HTMLElement[] = [];

  for (let element = table.parentElement; element && element !== region(); element = element.parentElement) {
    boxes.push(element);
  }

  return boxes;
}

describe("the Ritten list's scrolling", () => {
  it("puts every day of the week in one scroller", async () => {
    await showView("Week");

    const tables = within(region()).getAllByRole("table");

    expect(tables).toHaveLength(3);
    expect(screen.getAllByTestId("ritten-scroll-region")).toHaveLength(1);
  });

  it("gives no day a sideways scroller of its own", async () => {
    await showView("Week");

    for (const table of within(region()).getAllByRole("table")) {
      for (const box of boxesBetween(table)) {
        expect(box.className).not.toMatch(/overflow/);
      }
    }
  });

  it("scrolls both ways, bounded by the screen", async () => {
    await showView("Week");

    expect(region().className).toMatch(/\boverflow-auto\b/);
    expect(region().className).toMatch(/max-h-\[calc\(100vh-3rem\)\]/);
    // All days as wide as the widest, so they move as one.
    expect(region().firstElementChild?.className).toMatch(/\bw-fit\b.*\bmin-w-full\b/);
  });

  it("remembers one position for the whole list, not one per day", async () => {
    await showView("Week");

    const remembered = [...document.querySelectorAll("[data-scroll-restoration-id]")].map((element) =>
      element.getAttribute("data-scroll-restoration-id"),
    );

    expect(remembered).toEqual(["ritten-list"]);
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

  it.each(["Dag", "Maand"] as const)("uses the same scroller in the %s view", async (view) => {
    await showView(view);

    for (const table of within(region()).getAllByRole("table")) {
      expect(boxesBetween(table).some((box) => /overflow/.test(box.className))).toBe(false);
    }
  });
});
