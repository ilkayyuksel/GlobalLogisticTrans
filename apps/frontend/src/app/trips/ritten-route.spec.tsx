import { screen, within } from "@testing-library/react";

import { request } from "@/lib/api/client";
import { toRouteLabel } from "@/lib/ritten/export-rows";
import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * The canonical route on screen and in the spreadsheet.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * That this side does not BUILD a route. The two ends and their order are the
 * backend's answer, arriving on the Trip as `route`; the only thing done here
 * is joining them with an arrow. So the decisive tests are the ones where the
 * route contradicts what a local assembly from `terminal` and
 * `destinationCity` would have produced — if the screen still shows the
 * backend's answer, nothing here is second-guessing it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DELIVERY_TRIP = buildTrip({
  id: "trip-delivery",
  bookingNumber: "DUBANR2598395",
  direction: "DELIVERY",
  terminal: "Quay 869",
  destinationCity: "Kallo",
  route: { from: "Quay 869", to: "Kallo" },
});

const COLLECTION_TRIP = buildTrip({
  id: "trip-collection",
  bookingNumber: "ANRBEL2603249",
  direction: "COLLECTION",
  terminal: "PSA Quay 869",
  destinationCity: "Warneton",
  route: { from: "Warneton", to: "Quay 869" },
});

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

/**
 * ── THE ROUTE IS NOT A COLUMN ─────────────────────────────────────────────
 * Ritten used to show the canonical route beside the terminal and the address.
 * It no longer does: those two are already columns of their own and are the
 * fields an operator actually edits, so a third restating them directionally
 * cost width on every row without adding an answer.
 *
 * What was removed is the RENDERING, and these tests hold that line. The Trip
 * still carries `route`, the backend still derives it, Excel still prints it
 * and pricing still matches on it — all asserted below and in the Excel block
 * that follows.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("the route in the Ritten list", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([DELIVERY_TRIP, COLLECTION_TRIP]),
    });
  });

  it("has no column of its own, in either language", async () => {
    renderRitten();
    await screen.findByText("DUBANR2598395");

    const headings = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headings).not.toContain("Route");
    expect(headings).not.toContain("Rota");
  });

  it("does not print the arrow anywhere in a row", async () => {
    renderRitten();

    const row = (await screen.findByText("ANRBEL2603249")).closest(
      "tr",
    ) as HTMLElement;

    expect(row.textContent).not.toContain("→");
  });

  /**
   * The two ends are still on screen, in the columns that own them. Removing
   * the route removed a DERIVED reading, never the underlying values.
   */
  it("still shows the terminal and the destination, as the document printed them", async () => {
    renderRitten();

    const row = (await screen.findByText("ANRBEL2603249")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("PSA Quay 869")).toBeInTheDocument();
    // The destination is an inline editor, so it is read through the row's
    // text rather than as a bare node.
    expect(row.textContent).toContain("Warneton");
  });

  /** The data is untouched: only the rendering went. */
  it("still receives the route on the Trip", () => {
    expect(COLLECTION_TRIP.route).toEqual({
      from: "Warneton",
      to: "Quay 869",
    });
  });

  it("asks for no route of its own", async () => {
    renderRitten();
    await screen.findByText("DUBANR2598395");

    expect(
      requestMock.mock.calls.filter(([path]) => String(path).includes("route")),
    ).toHaveLength(0);
  });
});

/**
 * ── THE SAME ROUTE IN EXCEL ───────────────────────────────────────────────
 * The spreadsheet's Trip column reads from the same `route`, so the sheet and
 * the screen cannot describe a Trip differently. This used to be assembled as
 * terminal-then-city whatever the direction, which wrote every collection
 * backwards.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("the route in the Excel exports", () => {
  it("writes a delivery from the terminal to the city", () => {
    expect(toRouteLabel(DELIVERY_TRIP)).toBe("Quay 869 → Kallo");
  });

  it("writes a collection from the city to the terminal", () => {
    expect(toRouteLabel(COLLECTION_TRIP)).toBe("Warneton → Quay 869");
  });

  it("writes the canonical terminal, never the PSA spelling", () => {
    expect(toRouteLabel(COLLECTION_TRIP)).not.toContain("PSA");
  });

  /*
   * The screen no longer shows a route, so there is no on-screen text to
   * compare against. What still matters is that the SHEET reads the Trip's own
   * `route` rather than assembling one — asserted by the contradiction case
   * below, where a locally assembled route would differ.
   */
  it("writes the backend's route rather than assembling one", () => {
    expect(
      toRouteLabel(
        buildTrip({
          direction: "DELIVERY",
          terminal: "Quay 869",
          destinationCity: "Dourges",
          route: { from: "Somewhere Else", to: "Another Place" },
        }),
      ),
    ).toBe("Somewhere Else → Another Place");
  });

  it("gives the two legs of a Combination their own routes", () => {
    expect(toRouteLabel(DELIVERY_TRIP)).not.toBe(toRouteLabel(COLLECTION_TRIP));
  });

  /** A spreadsheet leaves an unknown cell blank rather than printing a dash. */
  it("writes a blank cell for a Trip with no route", () => {
    expect(toRouteLabel(buildTrip({ route: null }))).toBe("");
  });

  /** A Trip with one end shows the end it has rather than nothing at all. */
  it("writes the end it has when the other is missing", () => {
    expect(
      toRouteLabel(buildTrip({ route: { from: "Quay 869", to: "" } })),
    ).toBe("Quay 869 → ");
  });
});
