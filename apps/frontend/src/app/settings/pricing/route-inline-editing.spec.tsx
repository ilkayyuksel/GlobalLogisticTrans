import { render, screen, waitFor } from "@testing-library/react";
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
 * Routeprijzen: editing a route where it stands.
 *
 * ── THE VALUE IS THE CONTROL ────────────────────────────────────────────────
 * No Bewerken button, no form, no dialog. Clicking a value opens it, Enter saves
 * it, Escape puts it back — the application's own inline-editing component, the
 * one the Ritten list has always used. These tests hold the behaviour an
 * operator sees and, just as much, the three things that must NOT happen: no
 * save on leaving a field, no value silently changed beside the one being
 * edited, and no success reported for a refusal.
 *
 * ── THE UPDATE IS THE EXISTING ONE ──────────────────────────────────────────
 * There is no per-field endpoint. An ordinary route goes through the same PUT
 * the add form uses, and a Combination leg through the Combination's own
 * transaction — which replaces both legs, so these tests check with care that
 * the untouched leg comes back exactly as it went in.
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
    toll: "310.00",
    tunnel: "12.50",
    hasToll: true,
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    reviewed: false,
    ...overrides,
  };
}

const COMBINATION_ID = "combination-1";

function combination() {
  return {
    id: COMBINATION_ID,
    reviewed: false,
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
        combinationGroupId: COMBINATION_ID,
      }),
      route({
        id: "leg-2",
        departure: "Kallo",
        destination: "Antwerp",
        tarief: "80.00",
        toll: "30.00",
        tunnel: "15.00",
        type: "COMBINATION",
        combinationGroupId: COMBINATION_ID,
      }),
    ],
  };
}

interface Responses {
  routes?: unknown[];
  combinations?: unknown[];
  /** What a save answers with, so the row can show what was stored. */
  onSave?: (path: string, body: unknown) => unknown;
  failWith?: Error;
}

let calls: { path: string; method: string; body: unknown }[];

function respondWith(responses: Responses = {}): void {
  calls = [];

  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    calls.push({ path, method, body: options?.body });

    if (method !== "GET") {
      if (responses.failWith) {
        return Promise.reject(responses.failWith);
      }

      return Promise.resolve(
        responses.onSave?.(path, options?.body) ??
          (path.includes("/combinations/") ? combination() : route()),
      );
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
      return Promise.resolve(responses.combinations ?? []);
    }

    return Promise.resolve(responses.routes ?? []);
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

/** Opens one value for editing and returns its input. */
async function openCell(label: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: label }));

  return screen.getByLabelText(label);
}

/** Types a new value into an open cell and presses Enter. */
async function typeAndEnter(input: HTMLElement, value: string): Promise<void> {
  await userEvent.clear(input);
  await userEvent.type(input, `${value}{Enter}`);
}

const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  respondWith({ routes: [route()] });
});

describe("editing an ordinary route", () => {
  it("opens the value with the value already in it", async () => {
    renderPage();

    expect(await openCell("Tarief: Quay 869 Dourges")).toHaveValue(520);
  });

  it("opens a text value with the text already in it", async () => {
    renderPage();

    expect(await openCell("Van: Quay 869 Dourges")).toHaveValue("Quay 869");
  });

  it.each([
    ["Van", "Van: Quay 869 Dourges", "Zeebrugge", { departure: "Zeebrugge" }],
    ["Naar", "Naar: Quay 869 Dourges", "Brugge", { destination: "Brugge" }],
    ["Tarief", "Tarief: Quay 869 Dourges", "545.25", { tarief: 545.25 }],
    ["Toll", "Toll: Quay 869 Dourges", "180", { toll: 180 }],
    ["Tunnel", "Tunnel: Quay 869 Dourges", "3.75", { tunnel: 3.75 }],
  ])("saves %s on Enter", async (_name, label, typed, expected) => {
    renderPage();

    await typeAndEnter(await openCell(label), typed);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: `${ROUTES_PATH}/route-1`,
      method: "PUT",
    });
    expect(writes()[0].body).toMatchObject(expected);
  });

  /*
   * ── THE OTHER FOUR VALUES GO BACK UNCHANGED ───────────────────────────────
   * The endpoint takes a whole configuration, so an edit of one field carries
   * the rest. They must be the values on screen — anything else would change a
   * price nobody touched.
   */
  it("sends the other values exactly as they stand", async () => {
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "545.25");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      departure: "Quay 869",
      destination: "Dourges",
      tarief: 545.25,
      toll: 310,
      tunnel: 12.5,
    });
  });

  /** The toll travels unchanged when another field is edited. */
  it("keeps the toll as it is when another field is edited", async () => {
    respondWith({ routes: [route({ toll: "18.40" })] });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "545.25");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body as { toll: unknown }).toll).toBe(18.4);
  });

  /**
   * An emptied amount is not quietly turned into zero: it goes out as typed and
   * the backend refuses it in its own words.
   */
  it("sends an emptied toll as typed, never as zero", async () => {
    renderPage();

    const input = await openCell("Toll: Quay 869 Dourges");

    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body as { toll: unknown }).toll).toBe("");
  });

  it("shows the saved value and closes the cell", async () => {
    respondWith({
      routes: [route()],
      onSave: () => route({ tarief: "545.25" }),
    });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "545.25");

    expect(await screen.findByText("545.25")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("spinbutton", { name: "Tarief: Quay 869 Dourges" }),
      ).not.toBeInTheDocument(),
    );
  });

  /** No round trip to learn what this browser was just told. */
  it("does not refetch the lists after an inline save", async () => {
    renderPage();

    await screen.findByText("Quay 869");
    const reads = calls.filter((call) => call.method === "GET").length;

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "545.25");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(reads);
  });

  it("reports that it was saved", async () => {
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "545.25");

    expect(await screen.findByRole("status")).toHaveTextContent("Opgeslagen.");
  });
});

describe("cancelling", () => {
  it("puts the value back on Escape, and sends nothing", async () => {
    renderPage();

    const input = await openCell("Tarief: Quay 869 Dourges");

    await userEvent.clear(input);
    await userEvent.type(input, "999{Escape}");

    // The input goes and the value comes back as a button, ready to be opened.
    await waitFor(() =>
      expect(
        screen.queryByRole("spinbutton", { name: "Tarief: Quay 869 Dourges" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("520.00")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  /*
   * ── LEAVING A FIELD SAVES NOTHING ─────────────────────────────────────────
   * The convention this screen inherits: typed text is not finished until it is
   * confirmed, so tabbing away or clicking elsewhere must not persist a
   * half-considered amount.
   */
  it("sends nothing when the field is left", async () => {
    renderPage();

    const input = await openCell("Tarief: Quay 869 Dourges");

    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.tab();

    expect(writes()).toHaveLength(0);
  });

  it("offers an explicit way out beside Enter", async () => {
    renderPage();

    await openCell("Tarief: Quay 869 Dourges");

    await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    expect(screen.getByText("520.00")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("when the backend refuses", () => {
  it("keeps the cell open with what was typed", async () => {
    respondWith({ routes: [route()], failWith: new Error("refused") });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "-5");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Tarief: Quay 869 Dourges")).toHaveValue(-5);
  });

  it("leaves the stored value on the row", async () => {
    respondWith({ routes: [route()], failWith: new Error("refused") });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "-5");

    await screen.findByRole("alert");
    expect(screen.getByText("310.00")).toBeInTheDocument();
  });

  /** A refusal is never dressed up as a success. */
  it("reports no success", async () => {
    respondWith({ routes: [route()], failWith: new Error("refused") });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "-5");

    await screen.findByRole("alert");
    expect(screen.queryByText("Opgeslagen.")).not.toBeInTheDocument();
  });

  it("can be tried again without reopening the cell", async () => {
    respondWith({ routes: [route()], failWith: new Error("refused") });
    renderPage();

    await typeAndEnter(await openCell("Tarief: Quay 869 Dourges"), "-5");
    await screen.findByRole("alert");

    respondWith({ routes: [route()] });
    await typeAndEnter(screen.getByLabelText("Tarief: Quay 869 Dourges"), "5");

    await waitFor(() => expect(writes()).toHaveLength(1));
  });
});

describe("editing a Combination leg", () => {
  beforeEach(() => {
    respondWith({ combinations: [combination()] });
  });

  it("saves through the Combination's own update", async () => {
    renderPage();

    await typeAndEnter(await openCell("Tarief: Antwerp Kallo"), "110");

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: `${COMBINATIONS_PATH}/${COMBINATION_ID}`,
      method: "PUT",
    });
  });

  /*
   * ── THE OTHER LEG IS NOT TOUCHED ──────────────────────────────────────────
   * That endpoint replaces BOTH legs in one transaction, which is what stops a
   * Combination ever having one. The untouched leg therefore has to be sent —
   * and it has to be sent exactly as it stands.
   */
  it("sends the other leg exactly as it stands", async () => {
    renderPage();

    await typeAndEnter(await openCell("Tarief: Antwerp Kallo"), "110");

    await waitFor(() => expect(writes()).toHaveLength(1));
    // No Over ST: a leg edit leaves it exactly as stored.
    expect(writes()[0].body).toEqual({
      legs: [
        {
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 110,
          toll: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          toll: 30,
          tunnel: 15,
        },
      ],
    });
  });

  it("edits the second leg without moving the first", async () => {
    renderPage();

    await typeAndEnter(await openCell("Toll: Kallo Antwerp"), "31.5");

    await waitFor(() => expect(writes()).toHaveLength(1));

    const { legs } = writes()[0].body as {
      legs: { tarief: number; toll: number }[];
    };

    expect(legs[0]).toMatchObject({ tarief: 100, toll: 25 });
    expect(legs[1]).toMatchObject({ tarief: 80, toll: 31.5 });
  });

  it("offers every value of both legs", async () => {
    renderPage();

    await screen.findByText("Combination #1");

    for (const label of [
      "Van: Antwerp Kallo",
      "Naar: Antwerp Kallo",
      "Tarief: Antwerp Kallo",
      "Toll: Antwerp Kallo",
      "Tunnel: Antwerp Kallo",
      "Van: Kallo Antwerp",
      "Tunnel: Kallo Antwerp",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  /**
   * ── THE GROUP HAS NO FORM EITHER ──────────────────────────────────────────
   * Ten values are editable where they stand, so a Bewerken button on the header
   * row would be a second way to do the same thing — and the only way that could
   * write a leg nobody touched.
   */
  it("has no Bewerken button on the group", async () => {
    renderPage();

    await screen.findByText("Combination #1");

    expect(
      screen.queryByRole("button", { name: /^Bewerken/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Leg 1: Tarief")).not.toBeInTheDocument();
    // What the group DOES keep: its tick and its one action.
    expect(
      screen.getByRole("checkbox", { name: "Gecontroleerd: Combination #1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verwijderen Combination 1" }),
    ).toBeInTheDocument();
  });
});

describe("what inline editing leaves alone", () => {
  it("keeps the review tick working", async () => {
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Gecontroleerd: Quay 869 Dourges",
      }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: `${ROUTES_PATH}/route-1/review`,
      method: "PATCH",
    });
  });

  it("keeps Verwijderen where it was", async () => {
    renderPage();

    await screen.findByText("Quay 869");

    expect(
      screen.getByRole("button", { name: "Verwijderen Quay 869 Dourges" }),
    ).toBeInTheDocument();
  });

  it("still adds a route through the form", async () => {
    renderPage();

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );

    expect(screen.getByRole("textbox", { name: "Van" })).toBeInTheDocument();
  });
});
