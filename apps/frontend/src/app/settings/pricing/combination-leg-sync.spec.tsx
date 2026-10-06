import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  backend,
  combination,
  COMBINATIONS_PATH,
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
 * Routeprijzen: copying one Combination leg's prices to the same leg elsewhere.
 *
 * ── THE SCREEN ASKS, THE BACKEND DECIDES ────────────────────────────────────
 * Which legs are "the same leg" — same position, exactly the same Van and Naar —
 * is the backend's rule. This screen asks it for a preview, shows the count it
 * answered, and on confirmation asks it to perform the sync. It never matches a
 * leg and never sends an amount: what is copied is what the source leg stores.
 * ────────────────────────────────────────────────────────────────────────────
 */

const QUAY = "PSA Quay 869";

function seeded() {
  return [
    combination(
      "A",
      [QUAY, "GENT", prices("100.00", "25.00", "10.00")],
      ["GENT", "LESSINES", prices("80.00", "30.00", "0.00")],
    ),
    combination(
      "B",
      [QUAY, "GENT", prices("120.00", "25.00", "15.00")],
      ["GENT", "BRUSSELS", prices("90.00", "40.00", "0.00")],
      true,
    ),
    combination(
      "C",
      ["ANTWERP", "GENT", prices("70.00", "20.00", "0.00")],
      ["GENT", "LESSINES", prices("60.00", "30.00", "0.00")],
    ),
  ];
}

async function open() {
  serve(requestMock, { routes: [route()], combinations: seeded() });
  renderPage();
  await screen.findByText("Dourges");
}

const syncButton = (leg: 1 | 2, road: string, index = 0) =>
  screen.getAllByRole("button", {
    name: `Prijzen van Leg ${leg} "${road}" synchroniseren`,
  })[index];
const dialog = () => screen.getByRole("dialog");

/** The Tarief cell of a combination's leg, as shown in its row. */
function tariefOf(groupIndex: number, legIndex: number): string {
  // The Combi's section has its own table: its head first, then one group each.
  const [, combinationsTable] = within(routesSection()).getAllByRole("table");
  const group = within(combinationsTable).getAllByRole("rowgroup")[groupIndex + 1];
  const legRow = within(group).getAllByRole("row")[legIndex + 1];

  return within(legRow).getAllByRole("cell")[3].textContent ?? "";
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("the sync button", () => {
  it("is on every Combination leg and on no ordinary route", async () => {
    await open();

    expect(
      within(routesSection()).getAllByRole("button", { name: /synchroniseren$/ }),
    ).toHaveLength(6);
    expect(
      screen.queryByRole("button", {
        name: /"Quay 869 → Dourges" synchroniseren/,
      }),
    ).toBeNull();
  });

  /** Leg 1 asks about position 1, Leg 2 about position 2 — never the other. */
  it.each([
    [1, `${QUAY} → GENT`, "/legs/1/sync-targets"],
    [2, "GENT → LESSINES", "/legs/2/sync-targets"],
  ] as const)("asks the backend about Leg %s only", async (leg, road, path) => {
    await open();

    await userEvent.click(syncButton(leg, road));

    await screen.findByRole("dialog");
    expect(backend.calls.at(-1)).toEqual({
      path: `${COMBINATIONS_PATH}/A${path}`,
      method: "GET",
      body: undefined,
    });
  });
});

describe("the confirmation", () => {
  it("asks with the leg, the road and the backend's count", async () => {
    await open();

    await userEvent.click(syncButton(1, `${QUAY} → GENT`));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      `Prijzen van Leg 1 "${QUAY} → GENT" synchroniseren naar 1 andere Combination-routes?`,
    );
    expect(dialog()).toHaveTextContent("Tarief 100.00 · Toll 25.00 · Tunnel 10.00");
    // The preview writes nothing.
    expect(writes()).toEqual([]);
  });

  it("sends nothing when the operator backs out", async () => {
    await open();
    await userEvent.click(syncButton(1, `${QUAY} → GENT`));

    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Annuleren",
      }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toEqual([]);
  });

  /** No other Combination runs the leg: say so, and offer nothing to confirm. */
  it("says there is nothing to sync, and changes nothing", async () => {
    await open();

    await userEvent.click(syncButton(1, "ANTWERP → GENT"));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Geen andere Combination-legs gevonden",
    );
    expect(
      within(dialog()).queryByRole("button", { name: "Synchroniseren" }),
    ).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe("performing the sync", () => {
  it("asks the backend to sync that leg, with no amounts in the request", async () => {
    await open();
    await userEvent.click(syncButton(1, `${QUAY} → GENT`));

    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Synchroniseren",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `${COMBINATIONS_PATH}/A/legs/1/sync`,
      method: "POST",
      body: undefined,
    });
  });

  it("shows the synced values without a page reload, the rest untouched", async () => {
    await open();
    expect(tariefOf(1, 0)).toBe("120.00");

    await userEvent.click(syncButton(1, `${QUAY} → GENT`));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Synchroniseren",
      }),
    );

    await waitFor(() => expect(tariefOf(1, 0)).toBe("100.00"));
    // B's Leg 2, and C entirely, are not the same leg.
    expect(tariefOf(1, 1)).toBe("90.00");
    expect(tariefOf(2, 0)).toBe("70.00");
    expect(screen.getByRole("status")).toHaveTextContent("Prijzen gesynchroniseerd.");
  });

  /** The filter, the selection and every review mark stay where they were. */
  it("keeps the filter, the selection and the review marks", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Selecteren: Combination #1" }),
    );

    await userEvent.click(syncButton(2, "GENT → LESSINES"));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Synchroniseren",
      }),
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Prijzen gesynchroniseerd."));
    expect(screen.getByRole("button", { name: "Nog te doen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Selecteren: Combination #1" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Gecontroleerd: Combination #1" }),
    ).not.toBeChecked();
  });

  it("keeps the dialog open with the reason when the backend refuses", async () => {
    await open();
    backend.refuseSync = "Combination A no longer exists.";
    await userEvent.click(syncButton(1, `${QUAY} → GENT`));

    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Synchroniseren",
      }),
    );

    expect(
      await within(dialog()).findByText("Combination A no longer exists."),
    ).toBeInTheDocument();
    expect(tariefOf(1, 0)).toBe("120.00");
  });
});
