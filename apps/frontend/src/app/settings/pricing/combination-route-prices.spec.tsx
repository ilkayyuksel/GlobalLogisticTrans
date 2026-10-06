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
 * Settings → Prijzen → Combination-routes.
 *
 * ── WHAT A COMBINATION ROUTE IS ─────────────────────────────────────────────
 * ONE record with two legs: Antwerp to Kallo at 100, and Kallo back to Antwerp
 * at 80. The two legs legitimately cost different amounts, and each carries its
 * own Tarief, KM and Tunnel.
 *
 * ── AND WHAT IT IS NOT ──────────────────────────────────────────────────────
 * Not a Trip group in the Rittenlijst. That decides which Trips carry the
 * Backload; this decides what a route COSTS. Nothing on this screen touches a
 * Trip.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   the kind is CHOSEN before the form appears, and the two forms ask for
 *     different things — one route, or a pair of legs;
 *   a Combination is saved in ONE request with both legs, so the screen can
 *     never produce a Combination with a single leg;
 *   the list shows a Combination as one group, with its legs labelled and its
 *     actions on the group — there is no way to delete half of one;
 *   an ordinary route and a Combination leg may describe the same road, and the
 *     list makes clear which is which;
 *   and nothing is calculated here: amounts go out as typed and come back
 *     formatted by the backend.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES_PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;
const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";
const COMBINATION_GROUP_ID = "combination-1";

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    departure: "Quay 869",
    destination: "Dourges",
    tarief: "520.00",
    toll: "40.00",
    tunnel: "0.00",
    hasToll: true,
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    ...overrides,
  };
}

/** The outbound and the return, priced for themselves. */
function combination(overrides: Record<string, unknown> = {}) {
  return {
    id: COMBINATION_GROUP_ID,
    overSt: { tarief: null, toll: null, tunnel: null },
    legs: [
      route({
        id: "leg-1",
        departure: "Antwerp",
        destination: "Kallo",
        tarief: "100.00",
        toll: "25.00",
        tunnel: "0.00",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_GROUP_ID,
      }),
      route({
        id: "leg-2",
        departure: "Kallo",
        destination: "Antwerp",
        tarief: "80.00",
        toll: "31.50",
        tunnel: "3.75",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_GROUP_ID,
      }),
    ],
    ...overrides,
  };
}

interface Responses {
  routes?: unknown[];
  combinations?: unknown[];
  failWith?: Error;
}

/** Every write is recorded, because what matters is the request that went out. */
let writes: { path: string; method: string; body: unknown }[];

function respondWith(responses: Responses = {}): void {
  writes = [];

  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    if (method !== "GET") {
      writes.push({ path, method, body: options?.body });

      if (responses.failWith) {
        return Promise.reject(responses.failWith);
      }

      return Promise.resolve({});
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

    // Before the bare route path, which is a prefix of this one.
    if (path === COMBINATIONS_PATH) {
      return Promise.resolve(responses.combinations ?? []);
    }

    return Promise.resolve(responses.routes ?? []);
  });
}

function renderPage() {
  // Dutch, as the application defaults to and as these assertions read.
  window.localStorage.setItem("tms.language", "nl");

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PricingSettingsPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** The Routeprijzen section, which is where both kinds are configured. */
function routeSection(): HTMLElement {
  return screen.getAllByText("Routeprijzen")[0].closest("section") as HTMLElement;
}

/** Each section adds its own kind: "Route toevoegen" or "Combi toevoegen". */
async function addOfType(label: "Normaal" | "Combination"): Promise<void> {
  // The sections, and their add buttons, appear once the lists have loaded.
  await userEvent.click(
    await screen.findByRole("button", {
      name: label === "Combination" ? "Combi toevoegen" : "Route toevoegen",
    }),
  );
}

/** The header button of a section, which opens and closes it. */
function sectionToggle(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Fills one leg of the Combination form. */
async function fillLeg(
  legNumber: number,
  values: {
    departure: string;
    destination: string;
    tarief: string;
    toll: string;
    tunnel: string;
  },
): Promise<void> {
  const fields: [string, string][] = [
    ["Van", values.departure],
    ["Naar", values.destination],
    ["Tarief", values.tarief],
    ["Toll", values.toll],
    ["Tunnel", values.tunnel],
  ];

  for (const [label, value] of fields) {
    const input = screen.getByLabelText(`Leg ${legNumber}: ${label}`);

    await userEvent.clear(input);
    await userEvent.type(input, value);
  }
}

beforeEach(() => {
  requestMock.mockReset();
  respondWith();
});

/**
 * ── TWO SECTIONS ────────────────────────────────────────────────────────────
 * "Normale ritten" and "Combi's", each opening and closing on its own, each
 * adding its own kind of record.
 */
describe("the two sections", () => {
  it("shows Normale ritten and Combi's, both open", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();

    expect(await screen.findByText("Dourges")).toBeVisible();
    expect(sectionToggle(/Normale ritten/)).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle(/Combi's/)).toHaveAttribute("aria-expanded", "true");
  });

  it("closes and opens Normale ritten on its own", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();
    await screen.findByText("Dourges");

    await userEvent.click(sectionToggle(/Normale ritten/));

    expect(sectionToggle(/Normale ritten/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Dourges")).not.toBeVisible();
    // The other section keeps what it shows.
    expect(screen.getAllByText("Kallo")[0]).toBeVisible();

    await userEvent.click(sectionToggle(/Normale ritten/));

    expect(screen.getByText("Dourges")).toBeVisible();
  });

  it("closes and opens Combi's on its own", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();
    await screen.findByText("Dourges");

    await userEvent.click(sectionToggle(/Combi's/));

    expect(sectionToggle(/Combi's/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("Kallo")[0]).not.toBeVisible();
    expect(screen.getByText("Dourges")).toBeVisible();
  });

  /** The add form comes first in its section, above every stored Combination. */
  it("puts the Combination form at the top of Combi's", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();
    await screen.findAllByText("Kallo");

    await addOfType("Combination");

    const form = screen.getByLabelText("Leg 1: Van");
    const firstStored = screen.getAllByText("Kallo")[0];

    expect(
      form.compareDocumentPosition(firstStored) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("asks for Over ST's Tarief, Toll and Tunnel in the form", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");

    for (const label of ["Tarief", "Toll", "Tunnel"]) {
      expect(screen.getByLabelText(`Over ST: ${label}`)).toBeInTheDocument();
    }
  });

  /** KM is gone from Routeprijzen: Toll is an amount now. */
  it("shows no KM anywhere", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();
    await screen.findByText("Dourges");

    expect(within(routeSection()).queryByText("KM")).toBeNull();
    expect(within(routeSection()).getAllByText("Toll").length).toBeGreaterThan(0);
  });
});

describe("choosing what kind of route to add", () => {
  it("opens the two-leg form when Combination is chosen", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");

    expect(screen.getByLabelText("Leg 1: Van")).toBeInTheDocument();
    expect(screen.getByLabelText("Leg 2: Van")).toBeInTheDocument();
  });

  /** Every field says which leg it prices, because the form repeats all five. */
  it("asks for every amount of both legs, named per leg", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");

    for (const legNumber of [1, 2]) {
      for (const label of ["Van", "Naar", "Tarief", "Toll", "Tunnel"]) {
        expect(
          screen.getByLabelText(`Leg ${legNumber}: ${label}`),
        ).toBeInTheDocument();
      }
    }
  });

  /** There is no third leg to fill in, because a Combination has exactly two. */
  it("offers no third leg", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");

    expect(screen.queryByLabelText("Leg 3: Van")).not.toBeInTheDocument();
  });

  it("says that a Combination is always two legs", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");

    expect(
      screen.getByText(/altijd uit precies twee legs/i),
    ).toBeInTheDocument();
  });

  it("opens the ordinary one-row form when Normaal is chosen", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Normaal");

    expect(screen.getByLabelText("Van")).toBeInTheDocument();
    expect(screen.queryByLabelText("Leg 1: Van")).not.toBeInTheDocument();
  });
});

describe("saving a Combination", () => {
  /**
   * ── ONE REQUEST, BOTH LEGS ──────────────────────────────────────────────
   * The backend writes them in one transaction. Two requests from here would
   * create the very state the model refuses: a Combination with one leg, left
   * behind when the second request fails.
   */
  it("sends both legs in a single request", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");
    await fillLeg(1, {
      departure: "Antwerp",
      destination: "Kallo",
      tarief: "100",
      toll: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      toll: "25",
      tunnel: "0",
    });
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      path: COMBINATIONS_PATH,
      method: "POST",
    });
  });

  /** Each leg keeps its own amounts: that is the point of a Combination. */
  it("sends each leg's own Tarief, KM and Tunnel", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");
    await fillLeg(1, {
      departure: "Antwerp",
      destination: "Kallo",
      tarief: "100",
      toll: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      toll: "31.5",
      tunnel: "3.75",
    });
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      overSt: { tarief: null, toll: null, tunnel: null },
      legs: [
        {
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 100,
          toll: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          toll: 31.5,
          tunnel: 3.75,
        },
      ],
    });
  });

  it("never posts a Combination to the ordinary route endpoint", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");
    await fillLeg(1, {
      departure: "Antwerp",
      destination: "Kallo",
      tarief: "100",
      toll: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      toll: "25",
      tunnel: "0",
    });
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes.map((write) => write.path)).not.toContain(ROUTES_PATH);
  });

  /**
   * The duplicate rule is the backend's, including the canonical terminal
   * matching it applies. Re-implementing it here would be the same rule in two
   * places, and the browser's copy would be the one that drifted — so the request
   * goes out and the refusal is reported.
   */
  it("reports a refusal without clearing the form", async () => {
    respondWith({ failWith: new Error("already configured") });
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Combination");
    await fillLeg(1, {
      departure: "Antwerp",
      destination: "Kallo",
      tarief: "100",
      toll: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      toll: "25",
      tunnel: "0",
    });
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    expect(await screen.findByText(/Opslaan mislukt/)).toBeInTheDocument();
    // It was SENT: the browser did not pre-judge the backend's rule.
    expect(writes).toHaveLength(1);
    // And the form still holds what was typed, so nothing has to be retyped.
    expect(screen.getByLabelText("Leg 1: Van")).toHaveValue("Antwerp");
  });
});

describe("the configured Combinations", () => {
  /**
   * ── THE SAME ROWS AS AN ORDINARY ROUTE ──────────────────────────────────
   * A Combination is two rows of the same table, under a header row that says
   * they belong together — not a card of its own. So its legs are read the way
   * an ordinary route's cells are: one cell per value.
   */
  it("shows a Combination as two rows under one header", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    expect(await screen.findByText("Combination #1")).toBeInTheDocument();

    const legs = screen.getAllByRole("row").map((row) => row.textContent ?? "");

    expect(legs.some((row) => row.includes("Antwerp") && row.includes("Kallo"))).toBe(
      true,
    );
    expect(legs.some((row) => row.includes("Kallo") && row.includes("Antwerp"))).toBe(
      true,
    );
  });

  /** Drawn by the very component an ordinary route is drawn by. */
  /** Each kind in its own section, both with the same columns. */
  it("puts the legs in the Combi's table, the routes in their own", async () => {
    respondWith({
      routes: [route()],
      combinations: [combination()],
    });
    renderPage();

    await screen.findByText("Combination #1");

    const [normal, combinations] = screen.getAllByRole("table");

    expect(normal).toHaveTextContent("Quay 869");
    expect(normal).not.toHaveTextContent("Combination #1");
    expect(combinations).toHaveTextContent("Combination #1");
    for (const table of [normal, combinations]) {
      expect(within(table).getAllByRole("columnheader").map((each) => each.textContent))
        .toEqual(expect.arrayContaining(["Van", "Naar", "Tarief", "Toll", "Tunnel"]));
    }
  });

  it("shows Over ST beneath the two legs, with a dash when not stated", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(screen.getByText("Over ST")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Over ST Tarief: Combination #1" })).toHaveTextContent("—");
  });

  it("labels the legs in the order they were configured", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(screen.getByText("Leg 1")).toBeInTheDocument();
    expect(screen.getByText("Leg 2")).toBeInTheDocument();
  });

  it("shows each leg's own amounts", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("80.00")).toBeInTheDocument();
    expect(screen.getByText("31.50")).toBeInTheDocument();
    expect(screen.getByText("3.75")).toBeInTheDocument();
  });

  /*
   * ── THE COLLISION AN OPERATOR MUST BE ABLE TO SEE ─────────────────────────
   * The same road may be configured twice: once as an ordinary route and once as
   * a Combination leg, priced differently. Both appear, and each is shown under
   * the heading that says which it is.
   */
  it("shows an ordinary route and a Combination leg on the same road", async () => {
    respondWith({
      routes: [
        route({ departure: "Antwerp", destination: "Kallo", tarief: "380.00" }),
      ],
      combinations: [combination()],
    });
    renderPage();

    await screen.findByText("Combination #1");

    // The ordinary route, in the table.
    expect(screen.getByText("380.00")).toBeInTheDocument();
    // And the leg of the Combination on the very same road.
    expect(screen.getByText("100.00")).toBeInTheDocument();
  });

  /** The header row names it, and that is the only extra chrome it gets. */
  it("labels the group without a section of its own", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    expect(await screen.findByText("Combination #1")).toBeInTheDocument();
    expect(screen.queryByText("Combination-routes")).not.toBeInTheDocument();
  });

  /** Nothing to show and nothing to explain when none is configured. */
  it("shows no Combination header when none is configured", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(screen.queryByText(/Combination #/)).not.toBeInTheDocument();
  });
});

/**
 * ── A COMBINATION IS CHANGED IN ITS OWN ROWS ────────────────────────────────
 * There is no form for a stored Combination and no Bewerken button on the group:
 * every value of both legs is edited by clicking it, exactly as an ordinary
 * route's is. The whole of that behaviour has its own suite —
 * `route-inline-editing.spec.tsx`. What belongs HERE is the guarantee this suite
 * is about: however a leg is changed, both legs go to the group in one request,
 * so the pair can never disagree.
 */
describe("changing a Combination", () => {
  it("offers no form for the group, only its values", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(
      screen.queryByRole("button", { name: /^Bewerken/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Leg 1: Tarief")).not.toBeInTheDocument();

    // The value itself opens, and it opens with what is stored in it.
    await userEvent.click(
      screen.getByRole("button", { name: "Tarief: Antwerp Kallo" }),
    );

    expect(
      screen.getByRole("spinbutton", { name: "Tarief: Antwerp Kallo" }),
    ).toHaveValue(100);
  });

  /** Both legs go out together, so the pair can never disagree. */
  it("sends both legs to the group in one request", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Tarief: Antwerp Kallo" }),
    );

    const tarief = screen.getByRole("spinbutton", {
      name: "Tarief: Antwerp Kallo",
    });
    await userEvent.clear(tarief);
    await userEvent.type(tarief, "120{Enter}");

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      path: `${COMBINATIONS_PATH}/${COMBINATION_GROUP_ID}`,
      method: "PUT",
    });
    expect(
      (writes[0].body as { legs: { tarief: number }[] }).legs.map(
        (leg) => leg.tarief,
      ),
    ).toEqual([120, 80]);
  });
});

describe("removing a Combination", () => {
  /**
   * ── THE GROUP, NEVER A LEG ──────────────────────────────────────────────
   * Half a Combination would price the outbound and charge nothing for the
   * return, so the screen offers no way to reach one leg on its own.
   */
  it("offers one deletion for the whole Combination", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await screen.findByText("Combination #1");

    expect(
      screen.getByRole("button", { name: "Verwijderen Combination 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Verwijderen Antwerp Kallo/ }),
    ).not.toBeInTheDocument();
  });

  it("confirms before removing, naming both legs", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Verwijderen Combination 1" }),
    );

    expect(
      screen.getByText("Combination-route verwijderen"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Antwerp → Kallo \/ Kallo → Antwerp/),
    ).toBeInTheDocument();
  });

  it("says that finished Trips keep their amounts", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Verwijderen Combination 1" }),
    );

    expect(
      screen.getByText(/behouden de bedragen waarmee ze berekend zijn/i),
    ).toBeInTheDocument();
  });

  it("removes the group, not a leg", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Verwijderen Combination 1" }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Verwijderen" })[0],
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: `${COMBINATIONS_PATH}/${COMBINATION_GROUP_ID}`,
      method: "DELETE",
      body: undefined,
    });
  });

  it("writes nothing when the confirmation is dismissed", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Verwijderen Combination 1" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    expect(writes).toHaveLength(0);
  });
});

describe("an ordinary route is unaffected", () => {
  /** The regression that matters: the plain path still posts one route. */
  it("still saves a single route to the ordinary endpoint", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await addOfType("Normaal");
    await userEvent.type(screen.getByLabelText("Van"), "Quay 869");
    await userEvent.type(screen.getByLabelText("Naar"), "Dourges");
    await userEvent.type(screen.getByLabelText("Tarief"), "520");
    await userEvent.type(screen.getByLabelText("Toll"), "40");
    await userEvent.type(screen.getByLabelText("Tunnel"), "0");
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ path: ROUTES_PATH, method: "POST" });
    expect(writes[0].body).toEqual({
      departure: "Quay 869",
      destination: "Dourges",
      tarief: 520,
      toll: 40,
      tunnel: 0,
    });
  });

  it("still deletes a single route by its own id", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Verwijderen Quay 869 Dourges",
      }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Verwijderen" })[0],
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      path: `${ROUTES_PATH}/route-1`,
      method: "DELETE",
    });
  });
});
