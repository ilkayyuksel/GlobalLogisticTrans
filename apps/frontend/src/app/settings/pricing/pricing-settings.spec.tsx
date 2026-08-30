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

interface Responses {
  routes?: unknown[];
  settings?: unknown[];
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

    if (path === "/api/v1/settings") {
      return Promise.resolve(responses.settings ?? [FUEL_SETTING]);
    }

    return Promise.resolve(responses.routes ?? [route()]);
  });
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
      within(
        screen.getByText("Brandstof").closest("section") as HTMLElement,
      ).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));

    const [path, options] = writes()[0];

    expect(path).toBe("/api/v1/settings/PRICING/FUEL_PERCENTAGE");
    expect(options?.method).toBe("PATCH");
    expect(options?.body).toEqual({ value: "20" });
  });

  /** Validation is the backend's, and so is the wording of its refusal. */
  it("shows the backend's own refusal", async () => {
    respondWith({ failWith: new Error("nope") });
    renderPage();

    const input = await screen.findByLabelText("Brandstofpercentage");

    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.click(
      within(
        screen.getByText("Brandstof").closest("section") as HTMLElement,
      ).getByRole("button", { name: "Opslaan" }),
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

    const headings = screen
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
      screen.getAllByRole("button", { name: "Opslaan" })[1],
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
      screen.getAllByRole("button", { name: "Opslaan" })[1],
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
      screen.getAllByRole("button", { name: "Opslaan" })[1],
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
      screen.getAllByRole("button", { name: "Opslaan" })[1],
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
