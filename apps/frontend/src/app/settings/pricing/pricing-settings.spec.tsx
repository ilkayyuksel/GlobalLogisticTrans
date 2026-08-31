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
 * Settings → Prijzen.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   one row is ONE route. The screen never shows, or asks for, the price and
 *     cost records the backend actually stores;
 *   Van and Naar are free TEXT — there is no terminal or city master data in
 *     this system, so a dropdown could only offer a guess;
 *   nothing is calculated here. Amounts go out as typed and come back
 *     formatted by the backend;
 *   a refusal is the BACKEND's, shown in its own words — the duplicate-route
 *     rule is not re-implemented in the browser;
 *   and the page says, before anything is changed, that history is safe.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FUEL_SETTING = {
  id: "setting-fuel",
  category: "PRICING",
  key: "FUEL_PERCENTAGE",
  value: "15",
  valueType: "DECIMAL",
  description: null,
};

/** The keys the Pricing Engine reads, as the backend catalog lists them. */
const CANONICAL_KEYS = [
  "PRICING_STRATEGY",
  "FUEL_PERCENTAGE",
  "COMBINATION_SURCHARGE",
  "AUTOMATIC_CUSTOM_PROPERTY_ID",
  "WAITING_TIME_FREE_MINUTES",
  "WAITING_TIME_THRESHOLD_MINUTES",
  "WAITING_TIME_BLOCK_MINUTES",
  "WAITING_TIME_BLOCK_PRICE",
  "DISTANCE_RATE_PER_KM",
  "PRICING_RULE_VERSION",
];

function settingStatus(overrides: Record<string, unknown> = {}) {
  return {
    key: "PRICING_STRATEGY",
    value: "ROUTE_BASED",
    isConfigured: true,
    isActive: true,
    proposedValue: null,
    blockedReason: null,
    ...overrides,
  };
}

/** Every setting present — the state an established database is already in. */
function configuredPlan() {
  return {
    settings: CANONICAL_KEYS.map((key) => settingStatus({ key, value: "15" })),
    missingCount: 0,
    creatableCount: 0,
    blockedCount: 0,
  };
}

/** A fresh deployment: migrations ran, nothing is configured. */
function freshPlan() {
  return {
    settings: CANONICAL_KEYS.map((key) =>
      settingStatus({
        key,
        value: null,
        isConfigured: false,
        isActive: false,
        proposedValue: key === "AUTOMATIC_CUSTOM_PROPERTY_ID" ? null : "15",
        blockedReason:
          key === "AUTOMATIC_CUSTOM_PROPERTY_ID"
            ? 'No active Custom Property named "TAR" exists in this database.'
            : null,
      }),
    ),
    missingCount: CANONICAL_KEYS.length,
    creatableCount: CANONICAL_KEYS.length - 1,
    blockedCount: 1,
  };
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    departure: "Quay 869",
    destination: "Dourges",
    tarief: "520.00",
    toll: "18.00",
    tunnel: "0.00",
    hasToll: true,
    hasTunnel: true,
    isActive: true,
    ...overrides,
  };
}

const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";

interface Responses {
  routes?: unknown[];
  settings?: unknown[];
  plan?: unknown;
  onSave?: (path: string, options?: Record<string, unknown>) => unknown;
  failWith?: Error;
}

function respondWith(responses: Responses = {}): void {
  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    if (method !== "GET") {
      if (responses.failWith) {
        return Promise.reject(responses.failWith);
      }

      return Promise.resolve(responses.onSave?.(path, options) ?? {});
    }

    // Before the bare settings path below: it is a longer path under it.
    if (path === BOOTSTRAP_PATH) {
      return Promise.resolve(responses.plan ?? configuredPlan());
    }

    if (path === "/api/v1/settings") {
      return Promise.resolve(responses.settings ?? [FUEL_SETTING]);
    }

    return Promise.resolve(responses.routes ?? [route()]);
  });
}

/**
 * One section of the page, by its heading.
 *
 * The page has three, and several of them have a Save button and a table. A
 * query against the whole document would pick whichever came first in the DOM,
 * which is how a test ends up asserting the wrong section's behaviour.
 *
 * `getAllByText` because each heading also appears as its table's screen-reader
 * caption; both are inside the section being looked for.
 */
function sectionOf(heading: string): HTMLElement {
  return screen.getAllByText(heading)[0].closest("section") as HTMLElement;
}

function renderPage(language?: "nl" | "tr", theme?: "light" | "dark") {
  if (language) {
    window.localStorage.setItem("tms.language", language);
  }

  if (theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PricingSettingsPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** Every non-GET call the page made. */
function writes() {
  return requestMock.mock.calls.filter(
    ([, options]) => ((options?.method as string) ?? "GET") !== "GET",
  );
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the fuel percentage", () => {
  it("shows the configured value", async () => {
    respondWith();
    renderPage();

    expect(await screen.findByLabelText("Brandstofpercentage")).toHaveValue(15);
  });

  it("labels it as a percentage", async () => {
    respondWith();
    renderPage();

    await screen.findByLabelText("Brandstofpercentage");

    expect(screen.getByText("%")).toBeInTheDocument();
  });

  /** Said BEFORE the change, not after: the operator needs it to decide. */
  it("says that finished Trips keep their own rate", async () => {
    respondWith();
    renderPage();

    expect(
      await screen.findByText(/Reeds afgewerkte ritten behouden/),
    ).toBeInTheDocument();
  });

  it("saves the raw value to the settings endpoint", async () => {
    respondWith();
    renderPage();

    const input = await screen.findByLabelText("Brandstofpercentage");

    await userEvent.clear(input);
    await userEvent.type(input, "20");
    await userEvent.click(
      within(sectionOf("Brandstof")).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/settings/PRICING/FUEL_PERCENTAGE");
    // PUT, not PATCH: the same call has to work whether or not the setting has
    // ever existed. As an update it failed on every fresh deployment.
    expect(options?.method).toBe("PUT");
    expect(options?.body).toEqual({ value: "20" });
  });

  /**
   * The state a fresh deployment is actually in. The control used to send an
   * update for a row that had never been created, so it could not be the thing
   * that created it — and there was no other way in.
   */
  it("saves a value that was never configured before", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    const input = await screen.findByLabelText("Brandstofpercentage");

    expect(input).toHaveValue(null);

    await userEvent.type(input, "15");
    await userEvent.click(
      within(sectionOf("Brandstof")).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/settings/PRICING/FUEL_PERCENTAGE");
    expect(options?.method).toBe("PUT");
    expect(options?.body).toEqual({ value: "15" });
  });

  /** Validation is the backend's, and so is the wording of its refusal. */
  it("shows the backend's own refusal", async () => {
    respondWith({ failWith: new Error("nope") });
    renderPage();

    const input = await screen.findByLabelText("Brandstofpercentage");

    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.click(
      within(sectionOf("Brandstof")).getByRole("button", { name: "Opslaan" }),
    );

    expect(await screen.findByText(/Opslaan mislukt/)).toBeInTheDocument();
  });
});

describe("the route prices", () => {
  it("shows one row per route, with all three amounts", async () => {
    respondWith();
    renderPage();

    const row = (await screen.findByText("Dourges")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("Quay 869")).toBeInTheDocument();
    expect(within(row).getByText("520.00")).toBeInTheDocument();
    expect(within(row).getByText("18.00")).toBeInTheDocument();
    expect(within(row).getByText("0.00")).toBeInTheDocument();
  });

  /** One route, one row — never a price row and two cost rows. */
  it("never exposes the underlying price and cost records", async () => {
    respondWith();
    renderPage();
    await screen.findByText("Dourges");

    const headings = within(sectionOf("Routeprijzen"))
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headings).toEqual([
      "Van",
      "Naar",
      "Tarief",
      "Toll",
      "Tunnel",
      "Actief",
      "Acties",
    ]);
    expect(screen.queryByText(/RouteCost|RoutePricing/)).toBeNull();
  });

  it("says that direction and the terminal spelling both matter", async () => {
    respondWith();
    renderPage();

    expect(await screen.findByText(/Richting telt/)).toBeInTheDocument();
    expect(
      screen.getByText(/PSA Quay 869 en Quay 869 zijn dezelfde terminal/),
    ).toBeInTheDocument();
  });

  /** Free text, because this system has no terminal or city master data. */
  it("offers Van and Naar as text rather than a dropdown", async () => {
    respondWith();
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );

    expect(screen.getByLabelText("Van")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Naar")).toHaveAttribute("type", "text");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("creates a route from what was typed", async () => {
    respondWith();
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );

    await userEvent.type(screen.getByLabelText("Van"), "Quay 869");
    await userEvent.type(screen.getByLabelText("Naar"), "Ghlin");
    await userEvent.type(screen.getByLabelText("Tarief"), "480");
    await userEvent.type(screen.getByLabelText("Toll"), "12");
    await userEvent.type(screen.getByLabelText("Tunnel"), "0");

    await userEvent.click(
      within(sectionOf("Routeprijzen")).getAllByRole("button", {
        name: "Opslaan",
      })[0],
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/route-configuration");
    expect(options?.method).toBe("POST");
    expect(options?.body).toEqual({
      departure: "Quay 869",
      destination: "Ghlin",
      tarief: 480,
      toll: 12,
      tunnel: 0,
    });
  });

  /** Zero is a real amount an operator may configure, not an empty field. */
  it("sends an explicit zero as zero", async () => {
    respondWith();
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );

    await userEvent.type(screen.getByLabelText("Van"), "Quay 869");
    await userEvent.type(screen.getByLabelText("Naar"), "Ghlin");
    await userEvent.type(screen.getByLabelText("Tarief"), "0");
    await userEvent.type(screen.getByLabelText("Toll"), "0");
    await userEvent.type(screen.getByLabelText("Tunnel"), "0");

    await userEvent.click(
      within(sectionOf("Routeprijzen")).getAllByRole("button", {
        name: "Opslaan",
      })[0],
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    expect(writes()[0][1]?.body).toMatchObject({
      tarief: 0,
      toll: 0,
      tunnel: 0,
    });
  });

  it("edits an existing route through the same form", async () => {
    respondWith();
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Bewerken Quay 869 Dourges",
      }),
    );

    const tarief = screen.getByLabelText("Tarief");

    await userEvent.clear(tarief);
    await userEvent.type(tarief, "550");
    await userEvent.click(
      within(sectionOf("Routeprijzen")).getAllByRole("button", {
        name: "Opslaan",
      })[0],
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/route-configuration/route-1");
    expect(options?.method).toBe("PUT");
    expect(options?.body).toMatchObject({ tarief: 550 });
  });

  /** One switch, because the backend moves the price and both costs together. */
  it("deactivates a route with a single control", async () => {
    respondWith();
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Deactiveren Quay 869 Dourges",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/route-configuration/route-1/state");
    expect(options?.method).toBe("PATCH");
    expect(options?.body).toEqual({ isActive: false });
  });

  it("offers to reactivate an inactive route", async () => {
    respondWith({ routes: [route({ isActive: false })] });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Activeren Quay 869 Dourges",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    expect(writes()[0][1]?.body).toEqual({ isActive: true });
  });

  it("marks an inactive route as such", async () => {
    respondWith({ routes: [route({ isActive: false })] });
    renderPage();

    const row = (await screen.findByText("Dourges")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("Inactief")).toBeInTheDocument();
  });

  /**
   * The duplicate-route rule is the backend's, including the canonical terminal
   * matching it applies. Re-implementing it here would be the same rule in two
   * places, and the browser's copy would be the one that drifted.
   */
  it("shows the backend's refusal rather than checking for duplicates itself", async () => {
    respondWith({ failWith: new Error("already configured") });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );

    await userEvent.type(screen.getByLabelText("Van"), "PSA Quay 869");
    await userEvent.type(screen.getByLabelText("Naar"), "Dourges");
    await userEvent.type(screen.getByLabelText("Tarief"), "1");
    await userEvent.type(screen.getByLabelText("Toll"), "0");
    await userEvent.type(screen.getByLabelText("Tunnel"), "0");

    await userEvent.click(
      within(sectionOf("Routeprijzen")).getAllByRole("button", {
        name: "Opslaan",
      })[0],
    );

    expect(await screen.findByText(/Opslaan mislukt/)).toBeInTheDocument();
    // It was SENT: the browser did not pre-judge the canonical match.
    expect(writes()).toHaveLength(1);
  });

  it("says what an unconfigured route costs when there are none", async () => {
    respondWith({ routes: [] });
    renderPage();

    expect(
      await screen.findByText("Nog geen routeprijzen"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tarief, Toll en Tunnel op €0/)).toBeInTheDocument();
  });
});

/**
 * ── THE STATE THIS SECTION EXISTS FOR ───────────────────────────────────────
 * A fresh deployment has migrations but no pricing settings. The Engine then
 * refuses every calculation and the Ritten pricing screen is empty — and until
 * this section existed there was nothing an operator could do about it from
 * inside the application, because the interface could only ever edit a setting
 * that already existed.
 *
 * So these tests are about one promise: no SQL, and no manual database work.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the pricing configuration", () => {
  it("lists every setting the Pricing Engine reads", async () => {
    respondWith();
    renderPage();

    const section = sectionOf("Prijsinstellingen");

    await waitFor(() =>
      expect(
        within(section).getByText("PRICING_STRATEGY"),
      ).toBeInTheDocument(),
    );

    for (const key of CANONICAL_KEYS) {
      expect(within(section).getByText(key)).toBeInTheDocument();
    }
  });

  it("marks every setting as missing on a fresh database", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    const section = sectionOf("Prijsinstellingen");

    await waitFor(() =>
      expect(within(section).getAllByText("Ontbreekt")).toHaveLength(
        CANONICAL_KEYS.length,
      ),
    );
  });

  it("says that nothing will be priced while they are missing", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    expect(
      await screen.findByText(/berekent het systeem geen prijzen/),
    ).toBeInTheDocument();
  });

  /** The report comes before the write. Displaying it must change nothing. */
  it("writes nothing merely by showing what is missing", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    await screen.findByText(/berekent het systeem geen prijzen/);

    expect(writes()).toHaveLength(0);
  });

  /** What each one would be created with, shown before anything is created. */
  it("shows the value a missing setting would be created with", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    expect(await screen.findByLabelText("PRICING_STRATEGY")).toHaveValue("15");
  });

  it("creates the missing settings in one action, without SQL", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Ontbrekende instellingen aanmaken",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe(BOOTSTRAP_PATH);
    expect(options?.method).toBe("POST");
  });

  it("offers nothing to create once everything is configured", async () => {
    respondWith();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("PRICING_STRATEGY")).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", {
        name: "Ontbrekende instellingen aanmaken",
      }),
    ).toBeNull();
  });

  /**
   * The one value that cannot be invented: it is an id in the operator's own
   * database. The backend says why, and the page repeats the backend's words
   * rather than composing an explanation of its own.
   */
  it("shows the backend's reason for a setting it cannot create", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    expect(
      await screen.findByText(/No active Custom Property named "TAR"/),
    ).toBeInTheDocument();
  });

  /**
   * The Engine treats a switched-off setting exactly as a missing one, so a row
   * that read "configured" would be the most misleading thing here.
   */
  it("distinguishes a switched-off setting from a configured one", async () => {
    respondWith({
      plan: {
        ...configuredPlan(),
        settings: [
          settingStatus({ key: "FUEL_PERCENTAGE", isActive: false }),
          settingStatus({ key: "PRICING_STRATEGY" }),
        ],
      },
    });
    renderPage();

    const row = (await screen.findByText("FUEL_PERCENTAGE")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("Uitgeschakeld")).toBeInTheDocument();
    expect(within(row).queryByText("Ingesteld")).toBeNull();
  });

  /** One call, whether the setting exists or not — the page never has to know. */
  it("saves one setting through the same idempotent call either way", async () => {
    respondWith({ settings: [], plan: freshPlan() });
    renderPage();

    const input = await screen.findByLabelText("WAITING_TIME_BLOCK_PRICE");

    await userEvent.clear(input);
    await userEvent.type(input, "13.75");
    await userEvent.click(
      within(input.closest("tr") as HTMLElement).getByRole("button", {
        name: "Opslaan",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/settings/PRICING/WAITING_TIME_BLOCK_PRICE");
    expect(options?.method).toBe("PUT");
    expect(options?.body).toEqual({ value: "13.75" });
  });

  it("shows the backend's refusal when a value is rejected", async () => {
    respondWith({
      settings: [],
      plan: freshPlan(),
      failWith: new Error("out of range"),
    });
    renderPage();

    const input = await screen.findByLabelText("FUEL_PERCENTAGE");

    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.click(
      within(input.closest("tr") as HTMLElement).getByRole("button", {
        name: "Opslaan",
      }),
    );

    expect(await screen.findByText(/Opslaan mislukt/)).toBeInTheDocument();
  });
});

describe("the page in the other language and theme", () => {
  it("is translated", async () => {
    respondWith();
    renderPage("tr");

    expect(await screen.findByText("Rota fiyatları")).toBeInTheDocument();
    expect(screen.getByLabelText("Yakıt yüzdesi")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Nereden" }),
    ).toBeInTheDocument();
  });

  /*
   * The page carries design TOKENS rather than literal colours, so one
   * definition serves both themes — asserting the token asserts both.
   */
  it.each(["light", "dark"] as const)("renders in %s mode", async (theme) => {
    respondWith();
    renderPage(undefined, theme);

    const section = (await screen.findByText("Brandstof")).closest(
      "section",
    ) as HTMLElement;

    expect(section.className).toContain("bg-card");
    expect(section.className).toContain("border-border");
    expect(section.className).not.toMatch(/#|rgb\(/);
  });
});
