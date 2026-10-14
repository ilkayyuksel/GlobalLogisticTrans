import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError, request } from "@/lib/api/client";
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
 * A route or Combination just added is SEEN — or the screen says why not.
 *
 * ── WHAT WENT WRONG (14 October 2026) ───────────────────────────────────────
 * A new ordinary route took its alphabetical place in a list of hundreds, past
 * the 200 the backend then returned; and a search or the review filter could
 * hide it with nothing said. These tests run against a server that really
 * stores what is posted and lists it back.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES_PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;
const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";

function route(id: string, departure: string, destination: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    departure,
    destination,
    tarief: "100.00",
    toll: "0.00",
    tunnel: "0.00",
    hasToll: true,
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    reviewed: false,
    ...overrides,
  };
}

let routes: ReturnType<typeof route>[];
let combinations: Record<string, unknown>[];
let refuseCreateWith: Error | null;

function serve(): void {
  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";
    const body = options?.body as Record<string, unknown> | undefined;

    if (method === "POST" && path === ROUTES_PATH) {
      if (refuseCreateWith) {
        return Promise.reject(refuseCreateWith);
      }
      const created = route(`new-${routes.length}`, String(body?.departure), String(body?.destination));
      routes = [...routes, created];
      return Promise.resolve(created);
    }

    if (method === "POST" && path === COMBINATIONS_PATH) {
      const legs = (body?.legs as Record<string, unknown>[]).map((leg, index) =>
        route(`leg-${index}`, String(leg.departure), String(leg.destination), {
          type: "COMBINATION",
          combinationGroupId: "combination-new",
        }),
      );
      const created = {
        id: "combination-new",
        legs,
        overSt: { tarief: "40.00", toll: null, tunnel: null },
        reviewed: false,
      };
      combinations = [...combinations, created];
      return Promise.resolve(created);
    }

    if (path === BOOTSTRAP_PATH) {
      return Promise.resolve({ settings: [], missingCount: 0, creatableCount: 0, blockedCount: 0 });
    }

    if (path === "/api/v1/settings") {
      return Promise.resolve([]);
    }

    if (path === COMBINATIONS_PATH) {
      return Promise.resolve(combinations);
    }

    // The backend's order: by name.
    return Promise.resolve(
      [...routes].sort((left, right) => left.departure.localeCompare(right.departure)),
    );
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

const field = (name: string) =>
  screen.getByRole(name === "Van" || name === "Naar" ? "textbox" : "spinbutton", { name });

async function addRoute(departure: string, destination: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Route toevoegen" }));
  await userEvent.type(field("Van"), departure);
  await userEvent.type(field("Naar"), destination);
  await userEvent.type(field("Tarief"), "120");
  await userEvent.type(field("Toll"), "0");
  await userEvent.type(field("Tunnel"), "0");
  await userEvent.click(within(section()).getByRole("button", { name: "Opslaan" }));
}

/** The departures of the ordinary routes, in the order the table shows them. */
function shownDepartures(): string[] {
  return screen
    .getAllByRole("button", { name: /^Van: / })
    .map((cell) => cell.textContent ?? "");
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  routes = [route("r-a", "Aalst", "Ninove"), route("r-b", "Brugge", "Gent")];
  combinations = [];
  refuseCreateWith = null;
  serve();
});

describe("a route just added", () => {
  it("25/28. is stored and shown first in Normale ritten, not in its alphabetical place", async () => {
    renderPage();
    await screen.findByText("Ninove");

    await addRoute("Zeebrugge", "Lille");

    expect(await screen.findByText("Lille")).toBeVisible();
    expect(shownDepartures()[0]).toContain("Zeebrugge");
    expect(routes.map((stored) => stored.destination)).toContain("Lille");
  });

  it("29. says so when the active search hides it, and shows it on request", async () => {
    renderPage();
    await screen.findByText("Ninove");
    await userEvent.type(screen.getByRole("searchbox"), "Aalst");

    await addRoute("Zeebrugge", "Lille");

    const notice = await screen.findByText(/verborgen door de zoekterm of het controlefilter/);
    expect(notice).toHaveTextContent("1 zojuist toegevoegde");
    expect(screen.queryByText("Lille")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Alles tonen" }));

    expect(await screen.findByText("Lille")).toBeVisible();
    expect(screen.queryByText(/verborgen door de zoekterm/)).not.toBeInTheDocument();
  });

  it("30. shows the backend's refusal and no success", async () => {
    refuseCreateWith = new ApiError(
      "CONFLICT",
      'An active route pricing already exists for "Quay 869" to "LOKEREN". It is configured as "Quay 869" to "Lokeren".',
      409,
    );
    renderPage();
    await screen.findByText("Ninove");

    await addRoute("Quay 869", "LOKEREN");

    expect(await screen.findByText(/It is configured as "Quay 869" to "Lokeren"/)).toBeInTheDocument();
    expect(screen.queryByText("Opgeslagen.")).not.toBeInTheDocument();
  });
});

describe("a Combination just added", () => {
  it("26/27. is shown in Combi's with both legs", async () => {
    renderPage();
    await screen.findByText("Ninove");

    await userEvent.click(await screen.findByRole("button", { name: "Combi toevoegen" }));
    const legs: [number, string, string][] = [
      [1, "Quay 869", "Ghlin"],
      [2, "Mons", "Quay 869"],
    ];
    for (const [legNumber, departure, destination] of legs) {
      for (const [label, value] of [
        ["Van", departure],
        ["Naar", destination],
        ["Tarief", "100"],
        ["Toll", "0"],
        ["Tunnel", "0"],
      ] as const) {
        await userEvent.type(screen.getByLabelText(`Leg ${legNumber}: ${label}`), value);
      }
    }
    await userEvent.click(within(section()).getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(screen.getByText("Ghlin")).toBeVisible());
    expect(screen.getByText("Mons")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Over ST Tarief: Combination #1" }),
    ).toHaveTextContent("40");
  });
});
