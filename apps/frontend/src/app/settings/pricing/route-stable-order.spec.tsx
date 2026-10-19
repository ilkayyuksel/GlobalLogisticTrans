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

const requestMock = request as unknown as jest.Mock;

/**
 * Routeprijzen keeps an edited row where it stands.
 *
 * ── THE CAUSE THESE TESTS PIN DOWN ──────────────────────────────────────────
 * The backend lists ordinary routes sorted by name. An inline edit answered
 * without a refetch, but the next refetch of the same visit — a review tick, a
 * delete, a sync — delivered the list in its new alphabetical order, and a
 * route whose Van had just changed jumped away from the operator.
 *
 * The backend here behaves like the real one: ordinary routes sorted by Van
 * and Naar on every read, Combinations in their stored order, an update
 * answered with the saved record.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES_PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;

interface Road {
  id: string;
  departure: string;
  destination: string;
  reviewed: boolean;
}

function normalRoute(id: string, departure: string, destination: string) {
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
  };
}

function combination(id: string, first: [string, string], second: [string, string]) {
  const leg = ([departure, destination]: [string, string], position: number) => ({
    ...normalRoute(`${id}-leg-${position}`, departure, destination),
    type: "COMBINATION",
    combinationGroupId: id,
  });

  return {
    id,
    reviewed: false,
    legs: [leg(first, 1), leg(second, 2)],
    overSt: { tarief: null, toll: null, tunnel: null },
  };
}

let routes: ReturnType<typeof normalRoute>[];
let combinations: ReturnType<typeof combination>[];
let reads: number;

const byName = (left: Road, right: Road) =>
  `${left.departure} ${left.destination}`.localeCompare(`${right.departure} ${right.destination}`);

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function answer(path: string, method: string, body: unknown): unknown {
  const reviewMatch = path.match(/\/([^/]+)\/review$/);

  if (method === "PATCH" && reviewMatch) {
    const reviewed = (body as { reviewed: boolean }).reviewed;
    const target = [...routes, ...combinations].find((each) => each.id === reviewMatch[1]);

    Object.assign(target ?? {}, { reviewed });

    return copy(target);
  }

  if (method === "PUT" && path.startsWith(`${COMBINATIONS_PATH}/`)) {
    const stored = combinations.find((each) => each.id === path.split("/").at(-1))!;
    const { legs } = body as { legs: { departure: string; destination: string }[] };

    stored.legs = stored.legs.map((leg, index) => ({
      ...leg,
      departure: legs[index].departure,
      destination: legs[index].destination,
    }));

    return copy(stored);
  }

  if (method === "PUT") {
    const stored = routes.find((each) => each.id === path.split("/").at(-1))!;

    Object.assign(stored, body as object);

    return copy(stored);
  }

  if (path === "/api/v1/settings/pricing/bootstrap") {
    return { settings: [], missingCount: 0, creatableCount: 0, blockedCount: 0 };
  }

  if (path === "/api/v1/settings") {
    return [];
  }

  reads += 1;

  // Sorted by name on EVERY read, as `RoutePricingRepository` does.
  return path === COMBINATIONS_PATH ? copy(combinations) : copy([...routes].sort(byName));
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem("tms.language", "nl");
  reads = 0;
  routes = [
    normalRoute("route-b", "Gent", "Lille"),
    normalRoute("route-a", "Antwerp", "Dourges"),
    normalRoute("route-c", "Zeebrugge", "Brugge"),
  ];
  combinations = [
    combination("combination-1", ["Antwerp", "Kallo"], ["Kallo", "Antwerp"]),
    combination("combination-2", ["Antwerp", "Gent"], ["Gent", "Antwerp"]),
  ];
  requestMock.mockImplementation((path: string, options?: Record<string, unknown>) =>
    Promise.resolve(answer(path, (options?.method as string) ?? "GET", options?.body)),
  );
});

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PricingSettingsPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** The ordinary routes as the table shows them, top to bottom. */
function shownRoutes(): string[] {
  const table = screen.getByRole("table", { name: "Normale ritten" });

  return within(table)
    .getAllByRole("button", { name: /^Van: / })
    .map((cell) => cell.getAttribute("aria-label")!.replace("Van: ", ""));
}

/** The Combination legs as the table shows them, top to bottom. */
function shownLegs(): string[] {
  const table = screen.getByRole("table", { name: "Combi's" });

  return within(table)
    .getAllByRole("button", { name: /^Van: / })
    .map((cell) => cell.getAttribute("aria-label")!.replace("Van: ", ""));
}

async function editCell(label: string, value: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: label }));

  const input = screen.getByLabelText(label);

  await userEvent.clear(input);
  await userEvent.type(input, `${value}{Enter}`);
}

/** A change that refetches both lists, as every set-changing action does. */
async function refetchByReviewTick(label: string): Promise<void> {
  const before = reads;

  await userEvent.click(screen.getByRole("checkbox", { name: `Gecontroleerd: ${label}` }));
  await waitFor(() => expect(reads).toBeGreaterThanOrEqual(before + 2));
}

const ALPHABETICAL = ["Antwerp Dourges", "Gent Lille", "Zeebrugge Brugge"];

describe("the order of Routeprijzen", () => {
  it("opens with the routes in alphabetical order", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Van: Antwerp Dourges" });

    expect(shownRoutes()).toEqual(ALPHABETICAL);
  });

  it("keeps the first route in place after its Van is edited", async () => {
    renderPage();
    await editCell("Van: Antwerp Dourges", "Zwijndrecht");

    await screen.findByRole("button", { name: "Van: Zwijndrecht Dourges" });
    expect(shownRoutes()).toEqual(["Zwijndrecht Dourges", "Gent Lille", "Zeebrugge Brugge"]);
  });

  /** The jump the operator saw: the refetch after the edit re-sorted the list. */
  it("keeps it in place through the next refetch of the same visit", async () => {
    renderPage();
    await editCell("Van: Antwerp Dourges", "Zwijndrecht");
    await screen.findByRole("button", { name: "Van: Zwijndrecht Dourges" });

    await refetchByReviewTick("Gent Lille");

    expect(shownRoutes()).toEqual(["Zwijndrecht Dourges", "Gent Lille", "Zeebrugge Brugge"]);
  });

  it("sorts alphabetically again on the next full page load", async () => {
    const { unmount } = renderPage();
    await editCell("Van: Antwerp Dourges", "Zwijndrecht");
    await screen.findByRole("button", { name: "Van: Zwijndrecht Dourges" });
    unmount();

    renderPage();
    await screen.findByRole("button", { name: "Van: Zwijndrecht Dourges" });

    expect(shownRoutes()).toEqual(["Gent Lille", "Zeebrugge Brugge", "Zwijndrecht Dourges"]);
  });

  it("keeps an edited Combination leg in place and editable", async () => {
    renderPage();
    await editCell("Van: Antwerp Kallo", "Beveren");
    await screen.findByRole("button", { name: "Van: Beveren Kallo" });

    await refetchByReviewTick("Combination #2");

    expect(shownLegs()).toEqual(["Beveren Kallo", "Kallo Antwerp", "Antwerp Gent", "Gent Antwerp"]);

    // Still the same row, opened again where it stands.
    await editCell("Van: Beveren Kallo", "Kruibeke");
    expect(await screen.findByRole("button", { name: "Van: Kruibeke Kallo" })).toBeInTheDocument();
    expect(shownLegs()[0]).toBe("Kruibeke Kallo");
  });

  it("still searches the edited list correctly", async () => {
    renderPage();
    await editCell("Van: Antwerp Dourges", "Zwijndrecht");
    await screen.findByRole("button", { name: "Van: Zwijndrecht Dourges" });
    await refetchByReviewTick("Gent Lille");

    await userEvent.type(screen.getByLabelText("Zoeken op Van of Naar"), "Z");

    expect(shownRoutes()).toEqual(["Zwijndrecht Dourges", "Zeebrugge Brugge"]);

    await userEvent.clear(screen.getByLabelText("Zoeken op Van of Naar"));

    expect(shownRoutes()).toEqual(["Zwijndrecht Dourges", "Gent Lille", "Zeebrugge Brugge"]);
  });
});
