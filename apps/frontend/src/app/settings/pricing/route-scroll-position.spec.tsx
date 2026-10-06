import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  backend,
  clone,
  combination,
  prices,
  releaseRefetch,
  renderPage,
  request,
  route,
  routesSection,
  serve,
} from "./__fixtures__/route-prices-page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.Mock;

/**
 * Routeprijzen keeps the operator's place in the list.
 *
 * ── THE CAUSE THESE TESTS PIN DOWN ──────────────────────────────────────────
 * Every change that refetches the lists — a review tick, a delete, a bulk
 * delete, a sync — used to replace the whole table with the loading line until
 * the refetch answered. That took the table out of the document, the page
 * became a few hundred pixels tall, the browser clamped the scroll position to
 * the top, and the list came back there.
 *
 * jsdom has no layout, so it cannot measure a scroll position. What it CAN show
 * is the cause: whether the table stays in the document — the very same element,
 * not a new one — for the whole of a refetch. A table that never leaves cannot
 * collapse the page. And nothing scrolls the window by hand to paper over it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SHARED = [
  combination(
    "A",
    ["PSA Quay 869", "GENT", prices("100.00", "25.00", "10.00")],
    ["GENT", "LESSINES", prices("80.00", "30.00", "0.00")],
  ),
  combination(
    "B",
    ["PSA Quay 869", "GENT", prices("120.00", "25.00", "15.00")],
    ["GENT", "BRUSSELS", prices("90.00", "40.00", "0.00")],
  ),
];

let scrollTo: jest.SpyInstance;

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  scrollTo = jest.spyOn(window, "scrollTo").mockImplementation(() => {});
  serve(requestMock, {
    routes: [route(), route({ id: "route-2", destination: "Lille" })],
    combinations: clone(SHARED),
  });
});

afterEach(() => scrollTo.mockRestore());

/**
 * Runs `act`, holding the refetch it causes, and checks the table is the same
 * element before, during and after.
 */
async function expectTableToStayDuring(act: () => Promise<void>) {
  renderPage();
  await screen.findByText("Lille");

  // Both sections' tables: ordinary routes and Combinations.
  const tables = within(routesSection()).getAllByRole("table");

  backend.holdRefetch = true;
  await act();

  // The refetch is in flight: the list is still the list, not a loading line.
  await waitFor(() => expect(backend.held.length).toBeGreaterThan(0));
  expect(within(routesSection()).getAllByRole("table")).toEqual(tables);
  expect(within(routesSection()).queryByText(/Laden…/)).toBeNull();

  releaseRefetch();

  await waitFor(() => expect(backend.held).toHaveLength(0));
  expect(within(routesSection()).getAllByRole("table")).toEqual(tables);
  expect(scrollTo).not.toHaveBeenCalled();
}

describe("the scroll position", () => {
  it("survives a review tick", async () => {
    await expectTableToStayDuring(async () => {
      await userEvent.click(
        screen.getByRole("checkbox", {
          name: "Gecontroleerd: Quay 869 Lille",
        }),
      );
    });
  });

  it("survives deleting one route", async () => {
    await expectTableToStayDuring(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Verwijderen Quay 869 Lille" }),
      );
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Verwijderen",
        }),
      );
    });
  });

  it("survives a bulk delete", async () => {
    await expectTableToStayDuring(async () => {
      await userEvent.click(
        screen.getByRole("checkbox", { name: "Selecteren: Quay 869 Lille" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Geselecteerde verwijderen (1)" }),
      );
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Verwijderen",
        }),
      );
    });
  });

  it("survives the refetch after a leg-price sync", async () => {
    await expectTableToStayDuring(async () => {
      await userEvent.click(
        screen.getAllByRole("button", {
          name: 'Prijzen van Leg 1 "PSA Quay 869 → GENT" synchroniseren',
        })[0],
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Synchroniseren",
        }),
      );
    });
  });

  /** The loading line is still there for the one load that has nothing to show. */
  it("shows the loading line on the first load only", async () => {
    backend.holdRefetch = true;
    backend.hasLoaded = { routes: true, combinations: true };
    renderPage();

    expect(await within(routesSection()).findAllByText(/Laden…/)).not.toHaveLength(0);
    expect(within(routesSection()).queryAllByRole("table")).toHaveLength(0);

    releaseRefetch();

    expect(await within(routesSection()).findAllByRole("table")).toHaveLength(2);
  });
});
