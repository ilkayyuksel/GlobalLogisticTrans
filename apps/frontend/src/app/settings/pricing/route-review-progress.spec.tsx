import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import PricingSettingsPage from "./page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Routeprijzen: which configurations have been checked.
 *
 * ── ADMINISTRATIVE PROGRESS, AND NOTHING ELSE ───────────────────────────────
 * The tick records that a person has been through a route's prices. It says
 * nothing about whether the route is used and nothing about what a Trip is
 * charged: an unreviewed route prices exactly as a reviewed one does, and the
 * Pricing Engine never reads it. These tests hold that line — the tick sends its
 * own request and touches no amount — as much as they hold the feature.
 *
 * ── ONE MARK PER CONFIGURATION ──────────────────────────────────────────────
 * A Combination is ONE record: configured, edited, removed and therefore reviewed
 * as a whole. Its two legs carry no tick of their own, because half a reviewed
 * Combination is not a state anything here could act on.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES_PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;
const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    departure: "Quay 869",
    destination: "Dourges",
    tarief: "520.00",
    kilometres: "310.00",
    tunnel: "0.00",
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    reviewed: false,
    ...overrides,
  };
}

const COMBINATION_ID = "combination-1";

function combination(overrides: Record<string, unknown> = {}) {
  return {
    id: COMBINATION_ID,
    reviewed: false,
    legs: [
      route({
        id: "leg-1",
        departure: "Antwerp",
        destination: "Kallo",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_ID,
      }),
      route({
        id: "leg-2",
        departure: "Kallo",
        destination: "Antwerp",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_ID,
      }),
    ],
    ...overrides,
  };
}

interface Responses {
  routes?: unknown[];
  combinations?: unknown[];
}

let calls: { path: string; method: string; body: unknown }[];
/** What the lists serve, so a mark can change what a refetch returns. */
let served: Responses;

function respondWith(responses: Responses = {}): void {
  calls = [];
  served = {
    routes: responses.routes ?? [],
    combinations: responses.combinations ?? [],
  };

  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    calls.push({ path, method, body: options?.body });

    if (method === "PATCH") {
      const { reviewed } = options?.body as { reviewed: boolean };

      /*
       * The backend stores the mark and answers with the record. Mirrored here so
       * the next refetch shows what was stored — which is what makes the counter
       * and the filter in these tests mean anything.
       */
      if (path.includes("/combinations/")) {
        served.combinations = (served.combinations ?? []).map((entry) =>
          (entry as { id: string }).id === COMBINATION_ID
            ? { ...(entry as object), reviewed }
            : entry,
        );
      } else {
        const id = path.split("/").at(-2);

        served.routes = (served.routes ?? []).map((entry) =>
          (entry as { id: string }).id === id
            ? { ...(entry as object), reviewed }
            : entry,
        );
      }

      return Promise.resolve({ reviewed });
    }

    if (method !== "GET") {
      return Promise.resolve(route());
    }

    if (path === BOOTSTRAP_PATH) {
      return Promise.resolve({
        settings: [],
        missingCount: 0,
        creatableCount: 0,
        blockedCount: 0,
      });
    }

    if (path === "/api/v1/settings") {
      return Promise.resolve([]);
    }

    if (path === COMBINATIONS_PATH) {
      return Promise.resolve(served.combinations);
    }

    return Promise.resolve(served.routes);
  });
}

function renderPage() {
  window.localStorage.setItem("tms.language", "nl");

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PricingSettingsPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function section(): HTMLElement {
  return screen.getAllByText("Routeprijzen")[0].closest("section") as HTMLElement;
}

const tickFor = (label: string) =>
  screen.getByRole("checkbox", { name: `Gecontroleerd: ${label}` });

const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  respondWith();
});

describe("the review tick", () => {
  it("starts empty for a route nobody has checked", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    expect(await screen.findByText("Quay 869")).toBeInTheDocument();
    expect(tickFor("Quay 869 Dourges")).not.toBeChecked();
  });

  it("is ticked for a route that has been checked", async () => {
    respondWith({ routes: [route({ reviewed: true })] });
    renderPage();

    await screen.findByText("Quay 869");

    expect(tickFor("Quay 869 Dourges")).toBeChecked();
  });

  it("marks a route as checked when clicked", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `${ROUTES_PATH}/route-1/review`,
      method: "PATCH",
      body: { reviewed: true },
    });
  });

  /** Clicking a ticked box clears it: the value is sent, not toggled blindly. */
  it("unmarks a route that was checked", async () => {
    respondWith({ routes: [route({ reviewed: true })] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ reviewed: false });
  });

  /** Ticked, refetched, still ticked — the mark is stored, not remembered. */
  it("keeps the mark after the list is reloaded", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() => expect(tickFor("Quay 869 Dourges")).toBeChecked());
  });

  /*
   * ── IT CHANGES NO PRICE ───────────────────────────────────────────────────
   * Its own endpoint, and only that endpoint: marking a route must not travel
   * through the ordinary save, which would rewrite the amounts and the tunnel
   * cost of a route nobody meant to edit.
   */
  it("sends nothing but the mark", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(Object.keys(writes()[0].body as object)).toEqual(["reviewed"]);
    expect(writes().some((call) => call.method === "PUT")).toBe(false);
  });

  it("leaves the route's own values on screen untouched", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByText("520.00")).toBeInTheDocument();
    expect(screen.getByText("310.00")).toBeInTheDocument();
  });
});

describe("a Combination is reviewed as one record", () => {
  it("offers one tick for the group", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(tickFor("Combination #1")).toBeInTheDocument();
  });

  /** And none for a leg: a leg is never reviewed on its own. */
  it("offers no tick per leg", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    // The selection tick is the group's too — a bulk delete never takes one leg.
    expect(
      screen.getAllByRole("checkbox", { name: /^Gecontroleerd:/ }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("checkbox", { name: /^Selecteren:/ }),
    ).toHaveLength(1);
  });

  it("marks the group, by the group's id", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");
    await userEvent.click(tickFor("Combination #1"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `${COMBINATIONS_PATH}/${COMBINATION_ID}/review`,
      method: "PATCH",
      body: { reviewed: true },
    });
  });

  it("keeps the group's mark after a reload", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");
    await userEvent.click(tickFor("Combination #1"));

    await waitFor(() => expect(tickFor("Combination #1")).toBeChecked());
  });
});

describe("the counter", () => {
  it("counts configurations, not rows", async () => {
    respondWith({
      routes: [route(), route({ id: "route-2", departure: "Gent" })],
      combinations: [combination()],
    });
    renderPage();

    // Three configurations: two routes and one Combination — not four rows.
    expect(await screen.findByText(/0 \/ 3 gecontroleerd/)).toBeInTheDocument();
  });

  it("counts a reviewed Combination once", async () => {
    respondWith({
      routes: [route({ reviewed: true })],
      combinations: [combination({ reviewed: true })],
    });
    renderPage();

    expect(await screen.findByText(/2 \/ 2 gecontroleerd/)).toBeInTheDocument();
  });

  it("says how many are left", async () => {
    respondWith({
      routes: [route(), route({ id: "route-2", departure: "Gent" })],
    });
    renderPage();

    expect(await within(section()).findByText(/2 nog te doen/)).toBeInTheDocument();
  });

  it("says nothing is left when everything is checked", async () => {
    respondWith({ routes: [route({ reviewed: true })] });
    renderPage();

    await screen.findByText(/1 \/ 1 gecontroleerd/);

    expect(screen.queryByText(/nog te doen/)).not.toBeInTheDocument();
  });

  /** It follows a tick immediately, with no refresh. */
  it("moves when a route is marked", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText(/0 \/ 1 gecontroleerd/);
    await userEvent.click(tickFor("Quay 869 Dourges"));

    expect(await screen.findByText(/1 \/ 1 gecontroleerd/)).toBeInTheDocument();
  });

  it("is absent when nothing is configured", async () => {
    respondWith({ routes: [], combinations: [] });
    renderPage();

    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(screen.queryByText(/gecontroleerd/)).not.toBeInTheDocument();
  });
});

describe("the filter", () => {
  const MIXED = {
    routes: [
      route({ id: "route-1", departure: "Quay 869", reviewed: false }),
      route({ id: "route-2", departure: "Gent", reviewed: true }),
    ],
    combinations: [combination()],
  };

  it("shows everything by default", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");

    expect(screen.getByText("Gent")).toBeInTheDocument();
    expect(screen.getByText("Combination #1")).toBeInTheDocument();
  });

  it("shows only what is left to do", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));

    expect(screen.getByText("Quay 869")).toBeInTheDocument();
    expect(screen.queryByText("Gent")).not.toBeInTheDocument();
    // The unreviewed Combination stays.
    expect(screen.getByText("Combination #1")).toBeInTheDocument();
  });

  it("shows only what has been checked", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(
      screen.getByRole("button", { name: "Gecontroleerd" }),
    );

    expect(screen.getByText("Gent")).toBeInTheDocument();
    expect(screen.queryByText("Quay 869")).not.toBeInTheDocument();
    expect(screen.queryByText("Combination #1")).not.toBeInTheDocument();
  });

  it("comes back to everything", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));
    await userEvent.click(screen.getByRole("button", { name: "Alle" }));

    expect(screen.getByText("Quay 869")).toBeInTheDocument();
    expect(screen.getByText("Gent")).toBeInTheDocument();
  });

  it("says which filter is on", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));

    expect(screen.getByRole("button", { name: "Nog te doen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Alle" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /** A route ticked while "Nog te doen" is on leaves the view at once. */
  it("drops a route from Nog te doen the moment it is marked", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));
    await userEvent.click(tickFor("Quay 869 Dourges"));

    await waitFor(() =>
      expect(screen.queryByText("Quay 869")).not.toBeInTheDocument(),
    );
  });

  /** And appears under Gecontroleerd without a refresh. */
  it("adds it to Gecontroleerd at the same moment", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(tickFor("Quay 869 Dourges"));
    await waitFor(() => expect(tickFor("Quay 869 Dourges")).toBeChecked());

    await userEvent.click(
      screen.getByRole("button", { name: "Gecontroleerd" }),
    );

    expect(screen.getByText("Quay 869")).toBeInTheDocument();
  });

  /** Filtering is a view. It sends nothing and changes no configuration. */
  it("writes nothing", async () => {
    respondWith(MIXED);
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(screen.getByRole("button", { name: "Nog te doen" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Gecontroleerd" }),
    );

    expect(writes()).toHaveLength(0);
  });

  it("is absent when nothing is configured", async () => {
    respondWith({ routes: [], combinations: [] });
    renderPage();

    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: "Nog te doen" }),
    ).not.toBeInTheDocument();
  });
});
