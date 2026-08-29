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

async function routeCellOf(bookingNumber: string): Promise<HTMLElement> {
  const row = (await screen.findByText(bookingNumber)).closest(
    "tr",
  ) as HTMLElement;

  // The Route column sits directly after Terminal and Adres.
  const headers = screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent);

  return within(row).getAllByRole("cell")[headers.indexOf("Route")];
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("the route column in Ritten", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([DELIVERY_TRIP, COLLECTION_TRIP]),
    });
  });

  it("has its own heading", async () => {
    renderRitten();
    await screen.findByText("DUBANR2598395");

    expect(
      screen.getByRole("columnheader", { name: "Route" }),
    ).toBeInTheDocument();
  });

  /** DELIVERY: out of the quay to the customer. */
  it("shows a delivery running from the terminal to the city", async () => {
    renderRitten();

    expect(await routeCellOf("DUBANR2598395")).toHaveTextContent(
      "Quay 869 → Kallo",
    );
  });

  /** COLLECTION — the document's `LOADING` section: back to the quay. */
  it("shows a collection running from the city to the terminal", async () => {
    renderRitten();

    expect(await routeCellOf("ANRBEL2603249")).toHaveTextContent(
      "Warneton → Quay 869",
    );
  });

  /** The prefix never reaches the screen. */
  it("never shows the PSA spelling of the quay", async () => {
    renderRitten();
    await screen.findByText("ANRBEL2603249");

    const cell = await routeCellOf("ANRBEL2603249");

    expect(cell).not.toHaveTextContent("PSA");
  });

  /**
   * The raw terminal column is untouched: it still shows what the document
   * printed, because that is the value an operator edits and recognises.
   */
  it("leaves the terminal column showing the document's own spelling", async () => {
    renderRitten();
    const row = (await screen.findByText("ANRBEL2603249")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("PSA Quay 869")).toBeInTheDocument();
  });

  /**
   * ── THE DECIDING TEST ─────────────────────────────────────────────────────
   * The backend's route deliberately disagrees with what terminal + city would
   * produce locally. The screen must show the backend's answer.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("shows the backend's route even when it contradicts the raw fields", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-authoritative",
          bookingNumber: "ANRDUB2602247",
          direction: "DELIVERY",
          terminal: "Quay 869",
          destinationCity: "Dourges",
          route: { from: "Somewhere Else", to: "Another Place" },
        }),
      ]),
    });

    renderRitten();

    expect(await routeCellOf("ANRDUB2602247")).toHaveTextContent(
      "Somewhere Else → Another Place",
    );
  });

  it("shows the empty marker for a Trip with no route", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-routeless",
          bookingNumber: "ANRBEL2768902",
          route: null,
        }),
      ]),
    });

    renderRitten();

    expect(await routeCellOf("ANRBEL2768902")).toHaveTextContent("—");
  });

  /** Read-only: a route is corrected through the fields it is made of. */
  it("offers no control to edit the route", async () => {
    renderRitten();
    const cell = await routeCellOf("DUBANR2598395");

    expect(within(cell).queryAllByRole("button")).toHaveLength(0);
    expect(within(cell).queryByRole("textbox")).toBeNull();
  });

  it("costs no request of its own", async () => {
    renderRitten();
    await screen.findByText("DUBANR2598395");

    expect(
      requestMock.mock.calls.filter(([path]) => String(path).includes("route")),
    ).toHaveLength(0);
  });

  it("is translated", async () => {
    renderRitten({ language: "tr" });
    await screen.findByText("DUBANR2598395");

    expect(
      screen.getByRole("columnheader", { name: "Rota" }),
    ).toBeInTheDocument();
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

  it("writes the same text the Ritten column shows", async () => {
    respondWith(requestMock, { trips: buildPage([COLLECTION_TRIP]) });
    renderRitten();

    expect(await routeCellOf("ANRBEL2603249")).toHaveTextContent(
      toRouteLabel(COLLECTION_TRIP),
    );
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
