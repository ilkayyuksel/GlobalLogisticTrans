import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  backend,
  BULK_DELETE_PATH,
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
 * Routeprijzen: selecting several configurations and deleting them together.
 *
 * ── ONE REQUEST, ALL OR NOTHING ─────────────────────────────────────────────
 * The selection goes to the backend in ONE call, which runs it in one
 * transaction: if any record is refused, none is deleted. So this side never
 * loops over records, and a refusal is shown in the confirmation — which stays
 * open — rather than after half the list has gone.
 *
 * ── A COMBINATION GOES WHOLE ────────────────────────────────────────────────
 * It is selected by its group, never by a leg, and sent by its group id; the
 * backend removes it with both legs.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES = [
  route({ id: "route-1", destination: "Dourges" }),
  route({ id: "route-2", destination: "Lille", reviewed: true }),
];
const COMBINATIONS = [
  combination(
    "group-1",
    ["Antwerp", "Kallo", prices("100.00", "20.00", "0.00")],
    ["Kallo", "Antwerp", prices("80.00", "20.00", "0.00")],
  ),
];

const select = (label: string) =>
  userEvent.click(screen.getByRole("checkbox", { name: `Selecteren: ${label}` }));
const deleteButton = () =>
  screen.queryByRole("button", { name: /^Geselecteerde verwijderen/ });
const dialog = () => screen.getByRole("dialog");
const confirm = () =>
  userEvent.click(within(dialog()).getByRole("button", { name: "Verwijderen" }));

async function open() {
  serve(requestMock, {
    routes: JSON.parse(JSON.stringify(ROUTES)),
    combinations: JSON.parse(JSON.stringify(COMBINATIONS)),
  });
  renderPage();
  await screen.findByText("Lille");
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("selecting", () => {
  /** 1 */
  it("offers a checkbox per route and per Combination, none per leg", async () => {
    await open();

    expect(
      within(routesSection()).getAllByRole("checkbox", { name: /^Selecteren:/ }),
    ).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Selecteren: Combination #1" })).toBeInTheDocument();
  });

  /** 2 */
  it("shows the delete button only once something is selected, with the count", async () => {
    await open();

    expect(deleteButton()).toBeNull();

    await select("Quay 869 Dourges");
    await select("Combination #1");

    expect(deleteButton()).toHaveTextContent("Geselecteerde verwijderen (2)");
    expect(screen.getByText("2 geselecteerd")).toBeInTheDocument();
  });

  /** 3 */
  it("selects everything the list shows", async () => {
    await open();

    await userEvent.click(screen.getByRole("button", { name: "Alles selecteren" }));

    expect(deleteButton()).toHaveTextContent("(3)");
    for (const box of screen.getAllByRole("checkbox", { name: /^Selecteren:/ })) {
      expect(box).toBeChecked();
    }
  });

  /** 4 */
  it("deselects everything", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Alles selecteren" }));

    await userEvent.click(screen.getByRole("button", { name: "Alles deselecteren" }));

    expect(deleteButton()).toBeNull();
    for (const box of screen.getAllByRole("checkbox", { name: /^Selecteren:/ })) {
      expect(box).not.toBeChecked();
    }
  });

  /** 5 — "Alles selecteren" means what is SHOWN, under the active filter. */
  it("selects only what the filter shows", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Gecontroleerd" }));

    await userEvent.click(screen.getByRole("button", { name: "Alles selecteren" }));

    expect(deleteButton()).toHaveTextContent("(1)");
  });

  /** 6 — a ticked record the filter now hides is never deleted out of sight. */
  it("never deletes a selected record the filter hides", async () => {
    await open();
    await select("Quay 869 Dourges");
    await select("Quay 869 Lille");

    await userEvent.click(screen.getByRole("button", { name: "Gecontroleerd" }));
    await userEvent.click(deleteButton()!);
    await confirm();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      routeIds: ["route-2"],
      combinationGroupIds: [],
    });
  });

  /** 7 — selecting is not an action: nothing is sent. */
  it("sends nothing while selecting", async () => {
    await open();

    await select("Quay 869 Dourges");
    await select("Combination #1");
    await userEvent.click(screen.getByRole("button", { name: "Alles selecteren" }));

    expect(writes()).toEqual([]);
  });
});

describe("deleting the selection", () => {
  /** 8 — the confirmation is mandatory; backing out sends nothing. */
  it("asks first, and sends nothing when the operator backs out", async () => {
    await open();
    await select("Quay 869 Dourges");

    await userEvent.click(deleteButton()!);

    expect(dialog()).toHaveTextContent("Selectie verwijderen");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Annuleren" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toEqual([]);
    expect(deleteButton()).toHaveTextContent("(1)");
  });

  /** 9 — what goes is named and counted before anything goes. */
  it("names and counts what will be deleted", async () => {
    await open();
    await select("Quay 869 Dourges");
    await select("Combination #1");

    await userEvent.click(deleteButton()!);

    expect(dialog()).toHaveTextContent("1 route(s) en 1 Combination(s)");
    expect(dialog()).toHaveTextContent("Quay 869 → Dourges");
    expect(dialog()).toHaveTextContent(
      "Combination #1: Antwerp → Kallo / Kallo → Antwerp",
    );
    expect(dialog()).toHaveTextContent("beide legs");
  });

  /** 10 — routes and Combinations in ONE request; a Combination by its group. */
  it("sends the whole selection in one request, a Combination by its group", async () => {
    await open();
    await select("Quay 869 Dourges");
    await select("Quay 869 Lille");
    await select("Combination #1");

    await userEvent.click(deleteButton()!);
    await confirm();

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: BULK_DELETE_PATH,
      method: "POST",
      body: { routeIds: ["route-1", "route-2"], combinationGroupIds: ["group-1"] },
    });
    // Never a leg id, and never one DELETE per record.
    expect(JSON.stringify(writes())).not.toContain("group-1-leg");
    expect(writes().some((call) => call.method === "DELETE")).toBe(false);
  });

  /** 11 — after success: refreshed list, empty selection, the words for it. */
  it("refreshes the list and resets the selection after success", async () => {
    await open();
    await select("Quay 869 Dourges");
    await select("Combination #1");

    await userEvent.click(deleteButton()!);
    await confirm();

    await waitFor(() => expect(screen.queryByText("Dourges")).toBeNull());
    expect(screen.queryByText("Combination #1")).toBeNull();
    expect(screen.getByText("Lille")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteButton()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Selectie verwijderd.");
  });

  /** 12 — all or nothing: a refusal deletes nothing and keeps the dialog open. */
  it("keeps everything, and the dialog open with the reason, when refused", async () => {
    await open();
    await select("Quay 869 Dourges");
    await select("Combination #1");
    backend.refuseBulkDelete = "Route configuration route-1 was not found.";

    await userEvent.click(deleteButton()!);
    await confirm();

    expect(
      await within(dialog()).findByText("Route configuration route-1 was not found."),
    ).toBeInTheDocument();
    expect(screen.getByText("Dourges")).toBeInTheDocument();
    expect(screen.getByText("Combination #1")).toBeInTheDocument();
    expect(deleteButton()).toHaveTextContent("(2)");
  });
});
