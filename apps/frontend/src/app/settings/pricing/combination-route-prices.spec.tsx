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
    kilometres: "40.00",
    tunnel: "0.00",
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
    legs: [
      route({
        id: "leg-1",
        departure: "Antwerp",
        destination: "Kallo",
        tarief: "100.00",
        kilometres: "25.00",
        tunnel: "0.00",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_GROUP_ID,
      }),
      route({
        id: "leg-2",
        departure: "Kallo",
        destination: "Antwerp",
        tarief: "80.00",
        kilometres: "31.50",
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

async function chooseType(label: string): Promise<void> {
  await userEvent.click(screen.getByRole("radio", { name: label }));
}

async function addOfType(label: string): Promise<void> {
  await chooseType(label);
  await userEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
}

/** Fills one leg of the Combination form. */
async function fillLeg(
  legNumber: number,
  values: {
    departure: string;
    destination: string;
    tarief: string;
    kilometres: string;
    tunnel: string;
  },
): Promise<void> {
  const fields: [string, string][] = [
    ["Van", values.departure],
    ["Naar", values.destination],
    ["Tarief", values.tarief],
    ["KM", values.kilometres],
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

describe("choosing what kind of route to add", () => {
  it("offers both kinds", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(screen.getByRole("radio", { name: "Normaal" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Combination" }),
    ).toBeInTheDocument();
  });

  /** An ordinary route is the common case, so it is the one already selected. */
  it("starts on Normaal", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(screen.getByRole("radio", { name: "Normaal" })).toBeChecked();
  });

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
      for (const label of ["Van", "Naar", "Tarief", "KM", "Tunnel"]) {
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
      kilometres: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      kilometres: "25",
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
      kilometres: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      kilometres: "31.5",
      tunnel: "3.75",
    });
    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      legs: [
        {
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 100,
          kilometres: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          kilometres: 31.5,
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
      kilometres: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      kilometres: "25",
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
      kilometres: "25",
      tunnel: "0",
    });
    await fillLeg(2, {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: "80",
      kilometres: "25",
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
  it("shows a Combination as one record with both legs", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    expect(await screen.findByText("Combination #1")).toBeInTheDocument();
    expect(screen.getByText("Antwerp → Kallo")).toBeInTheDocument();
    expect(screen.getByText("Kallo → Antwerp")).toBeInTheDocument();
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

  it("names the Combination section", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    expect(await screen.findByText("Combination-routes")).toBeInTheDocument();
  });

  /** Nothing to show and nothing to explain when none is configured. */
  it("shows no Combination section when none is configured", async () => {
    respondWith({ routes: [route()] });
    renderPage();

    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(screen.queryByText("Combination-routes")).not.toBeInTheDocument();
  });
});

describe("changing a Combination", () => {
  it("opens both legs with their stored values", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Bewerken Combination 1" }),
    );

    expect(screen.getByLabelText("Leg 1: Van")).toHaveValue("Antwerp");
    expect(screen.getByLabelText("Leg 1: Tarief")).toHaveValue(100);
    expect(screen.getByLabelText("Leg 2: Van")).toHaveValue("Kallo");
    expect(screen.getByLabelText("Leg 2: Tunnel")).toHaveValue(3.75);
  });

  /** Both legs go out together, so the pair can never disagree. */
  it("sends both legs to the group in one request", async () => {
    respondWith({ combinations: [combination()] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Bewerken Combination 1" }),
    );

    const tarief = screen.getByLabelText("Leg 1: Tarief");
    await userEvent.clear(tarief);
    await userEvent.type(tarief, "120");

    await userEvent.click(
      within(routeSection()).getByRole("button", { name: "Opslaan" }),
    );

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
    await userEvent.type(screen.getByLabelText("KM"), "40");
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
      kilometres: 40,
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
