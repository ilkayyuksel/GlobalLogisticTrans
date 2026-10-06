import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  backend,
  combination,
  prices,
  renderPage,
  request,
  route,
  routesSection,
  serve,
  writes,
} from "./__fixtures__/route-prices-page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.Mock;

/**
 * Searching Routeprijzen, the two sections, a new Combination shown first and
 * Over ST edited in place — against the in-memory backend.
 */

const QUAY = "PSA Quay 869";

function theConfiguration() {
  return {
    routes: [
      route({ id: "r-gent", departure: QUAY, destination: "GENT" }),
      route({ id: "r-lille", departure: "Gent", destination: "Lille" }),
      route({ id: "r-kallo", departure: "Antwerp", destination: "Kallo" }),
    ],
    combinations: [
      combination("A", [QUAY, "GENT", prices("100.00", "20.00", "10.00")], ["GENT", "LESSINES", prices("80.00", "15.00", "0.00")]),
      combination("B", ["ANTWERP", "ZEMST", prices("70.00", "5.00", "0.00")], ["ZEMST", "AALST", prices("60.00", "5.00", "0.00")]),
    ],
  };
}

async function open(): Promise<void> {
  serve(requestMock, theConfiguration());
  renderPage();
  await screen.findByText("Lille");
}

function search(text: string): void {
  fireEvent.change(screen.getByLabelText("Zoeken op Van of Naar"), {
    target: { value: text },
  });
}

/** The Van cells shown in one section's table. */
function shownDepartures(section: 0 | 1): string[] {
  const table = within(routesSection()).getAllByRole("table")[section];

  return within(table)
    .queryAllByRole("button", { name: /^Van: / })
    .map((button) => button.textContent ?? "");
}

function shownCombinations(): string[] {
  const table = within(routesSection()).getAllByRole("table")[1];

  return within(table)
    .queryAllByRole("columnheader", { name: /^Combination #/ })
    .map((header) => header.textContent ?? "");
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("the search", () => {
  it("G. finds ordinary routes by Van", async () => {
    await open();

    search("Antwerp");

    expect(shownDepartures(0)).toEqual(["Antwerp"]);
  });

  it("H. finds ordinary routes by Naar", async () => {
    await open();

    search("Lille");

    expect(shownDepartures(0)).toEqual(["Gent"]);
  });

  it("I. finds a Combination by its Leg 1", async () => {
    await open();

    search("869");

    expect(shownCombinations()).toEqual(["Combination #1"]);
    expect(shownDepartures(0)).toEqual([QUAY]);
  });

  /** The whole Combination, never one leg on its own. */
  it("J. finds a Combination by its Leg 2, and shows both legs", async () => {
    await open();

    search("AALST");

    expect(shownCombinations()).toEqual(["Combination #2"]);
    expect(shownDepartures(1)).toEqual(["ANTWERP", "ZEMST"]);
  });

  it("K. ignores case", async () => {
    await open();

    search("gent");

    expect(shownDepartures(0)).toEqual([QUAY, "Gent"]);
    expect(shownCombinations()).toEqual(["Combination #1"]);
  });

  it("L. shows everything again once emptied", async () => {
    await open();

    search("Lille");
    search("");

    expect(shownDepartures(0)).toHaveLength(3);
    expect(shownCombinations()).toHaveLength(2);
  });

  it("says when a section has no results", async () => {
    await open();

    search("Lille");

    const combinationsTable = within(routesSection()).getAllByRole("table")[1];

    expect(within(combinationsTable).getByText("Geen resultaten")).toBeInTheDocument();
  });

  /** Searching and the review filter narrow the list together. */
  it("M. works together with the review filter", async () => {
    serve(requestMock, {
      ...theConfiguration(),
      routes: [
        route({ id: "r-gent", departure: QUAY, destination: "GENT", reviewed: true }),
        route({ id: "r-lille", departure: "Gent", destination: "Lille" }),
      ],
    });
    renderPage();
    await screen.findByText("Lille");

    search("gent");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));

    expect(shownDepartures(0)).toEqual(["Gent"]);
  });

  it("opens a closed section that holds results", async () => {
    await open();

    const toggle = screen.getByRole("button", { name: /Combi's/ });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    search("LESSINES");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("asks the backend nothing while searching", async () => {
    await open();
    const callsBefore = backend.calls.length;

    search("869");
    search("gent");

    expect(backend.calls).toHaveLength(callsBefore);
  });
});

describe("a Combination just added", () => {
  /** Shown first in this visit; the stored order is untouched. */
  it("F. appears at the top of Combi's", async () => {
    await open();

    await userEvent.click(screen.getByRole("button", { name: "Combi toevoegen" }));
    // The in-memory backend answers a POST with its body; store it like a real one.
    requestMock.mockImplementationOnce(async (path, options) => {
      const created = combination(
        "NEW",
        ["Gent", "Brugge", prices("90.00", "9.00", "0.00")],
        ["Brugge", "Gent", prices("85.00", "9.00", "0.00")],
      );

      backend.calls.push({ path, method: "POST", body: options?.body });
      backend.combinations = [...backend.combinations, created];

      return created;
    });

    const fill = async (label: string, value: string) => {
      await userEvent.type(screen.getByLabelText(label), value);
    };

    await fill("Leg 1: Van", "Gent");
    await fill("Leg 1: Naar", "Brugge");
    await fill("Leg 1: Tarief", "90");
    await fill("Leg 1: Toll", "9");
    await fill("Leg 1: Tunnel", "0");
    await fill("Leg 2: Van", "Brugge");
    await fill("Leg 2: Naar", "Gent");
    await fill("Leg 2: Tarief", "85");
    await fill("Leg 2: Toll", "9");
    await fill("Leg 2: Tunnel", "0");
    await fill("Over ST: Tarief", "50");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(shownCombinations()).toHaveLength(3));
    // Numbered by its stored place (the third), shown first.
    expect(shownCombinations()[0]).toBe("Combination #3");
    expect(writes()[0].body).toMatchObject({
      overSt: { tarief: 50, toll: null, tunnel: null },
    });
  });
});

describe("Over ST, edited in place", () => {
  it("sends the whole Over ST with one amount changed, and both legs as they stand", async () => {
    await open();

    await userEvent.click(
      screen.getByRole("button", { name: "Over ST Toll: Combination #1" }),
    );
    const input = screen.getByRole("spinbutton", { name: "Over ST Toll: Combination #1" });

    await userEvent.clear(input);
    await userEvent.type(input, "5{Enter}");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe("/api/v1/route-configuration/combinations/A");
    expect(writes()[0].body).toEqual({
      legs: [
        { departure: QUAY, destination: "GENT", tarief: 100, toll: 20, tunnel: 10 },
        { departure: "GENT", destination: "LESSINES", tarief: 80, toll: 15, tunnel: 0 },
      ],
      overSt: { tarief: null, toll: 5, tunnel: null },
    });
  });

  it("offers no selection, review tick or sync of its own", async () => {
    await open();

    expect(screen.queryByRole("checkbox", { name: /Over ST/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Over ST.*synchroniseren/ })).toBeNull();
  });
});
