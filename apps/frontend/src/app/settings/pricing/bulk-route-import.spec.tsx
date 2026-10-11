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
 * Settings → Prijzen → Routeprijzen → Bulk toevoegen.
 *
 * ── WHAT THIS SCREEN IS FOR ─────────────────────────────────────────────────
 * Pasting a price list instead of typing forty routes one at a time. JSON is the
 * input format and nothing else: the backend turns each entry into exactly the
 * same records the form does.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   the browser decides almost NOTHING. It reads the text as JSON — unparseable
 *     text cannot be sent anywhere — and asks the backend everything else:
 *     whether each route is valid, what would be created, what already exists;
 *   the preview is asked for before the import, and writes nothing;
 *   a few broken entries no longer block the rest: they are listed as skipped,
 *     with their number and reason, and the valid ones can still be imported;
 *   a document with nothing importable cannot be imported by pressing the
 *     button anyway;
 *   the counts and the per-entry reasons on screen are the backend's answer
 *     rendered, never a second opinion computed here;
 *   and after an import the dialog shows what happened — imported, skipped,
 *     or where it stopped — while the list behind it reloads.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROUTES_PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;
const BULK_PATH = `${ROUTES_PATH}/bulk`;
const BULK_CHECK_PATH = `${BULK_PATH}/check`;
const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";

/** A document an operator might paste. Its content is the backend's to judge. */
const DOCUMENT = JSON.stringify({
  routes: [
    {
      type: "NORMAL",
      departure: "Antwerp",
      destination: "Kallo",
      tarief: 100,
      toll: 25,
      tunnel: 0,
    },
    {
      type: "COMBINATION",
      legs: [
        {
          departure: "Gent",
          destination: "Lille",
          tarief: 240,
          toll: 62.5,
          tunnel: 4.5,
        },
        {
          departure: "Lille",
          destination: "Gent",
          tarief: 205.75,
          toll: 64,
          tunnel: 0,
        },
      ],
    },
  ],
});

function validCheck() {
  return {
    isValid: true,
    summary: {
      normalRoutes: 12,
      combinationGroups: 4,
      combinationLegs: 8,
      totalRoutes: 20,
    },
    errors: [],
    skipped: [],
  };
}

const reason = (
  routeNumber: number,
  legNumber: number | null,
  field: string | null,
  message: string,
  code: string,
) => ({ routeNumber, legNumber, field, message, code });

/** Some entries importable, some skipped — the owner's real case. */
function partialCheck() {
  const skipped = [
    {
      routeNumber: 4,
      type: "NORMAL",
      route: "Gent to Lille",
      reasons: [reason(4, null, "toll", "toll is required", "INVALID")],
    },
    {
      routeNumber: 11,
      type: "COMBINATION",
      route: null,
      reasons: [reason(11, 2, "tarief", "tarief must not be less than 0", "INVALID")],
    },
    {
      routeNumber: 15,
      type: "COMBINATION",
      route: "Antwerp to Kallo and Antwerp to Kallo",
      reasons: [
        reason(15, null, "legs", "the two legs of a Combination must be different routes", "SAME_ROUTE_LEGS"),
      ],
    },
  ];

  return {
    isValid: false,
    summary: { normalRoutes: 2, combinationGroups: 0, combinationLegs: 0, totalRoutes: 2 },
    errors: skipped.flatMap((entry) => entry.reasons),
    skipped,
  };
}

/** A document that cannot be read: nothing importable at all. */
function refusedCheck() {
  return {
    isValid: false,
    summary: { normalRoutes: 0, combinationGroups: 0, combinationLegs: 0, totalRoutes: 0 },
    errors: [reason(null as unknown as number, null, "routes", "routes must not be empty", null as unknown as string)],
    skipped: [],
  };
}

function importResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "COMPLETED",
    imported: { normalRoutes: 12, combinationGroups: 4, combinationLegs: 8, totalRoutes: 20 },
    skipped: [],
    stoppedAt: null,
    notAttempted: 0,
    ...overrides,
  };
}

interface Responses {
  routes?: unknown[];
  combinations?: unknown[];
  check?: unknown;
  imported?: unknown;
  importFailsWith?: Error;
}

/** Every request that went out, so the tests can assert what was sent. */
let calls: { path: string; method: string; body: unknown }[];

function respondWith(responses: Responses = {}): void {
  calls = [];

  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    calls.push({ path, method, body: options?.body });

    if (path === BULK_CHECK_PATH) {
      return Promise.resolve(responses.check ?? validCheck());
    }

    if (path === BULK_PATH) {
      if (responses.importFailsWith) {
        return Promise.reject(responses.importFailsWith);
      }

      return Promise.resolve(responses.imported ?? importResult());
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

/** Opens the dialog and returns it. */
async function openDialog(): Promise<HTMLElement> {
  renderPage();
  await waitFor(() => expect(requestMock).toHaveBeenCalled());

  await userEvent.click(
    screen.getByRole("button", { name: "Bulk toevoegen" }),
  );

  return screen.getByRole("dialog");
}

async function paste(text: string): Promise<void> {
  const editor = screen.getByLabelText("JSON");

  await userEvent.clear(editor);
  // `paste` rather than `type`: typing JSON character by character is thousands
  // of events, and an operator pastes it anyway.
  editor.focus();
  await userEvent.paste(text);
}

/** The requests that were not the initial page loads. */
function writes() {
  return calls.filter((call) => call.method !== "GET");
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  respondWith();
});

describe("opening the bulk import", () => {
  it("is offered beside adding a single route", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(
      screen.getByRole("button", { name: "Bulk toevoegen" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    ).toBeInTheDocument();
  });

  it("opens a dialog with an editor", async () => {
    const dialog = await openDialog();

    expect(within(dialog).getByLabelText("JSON")).toBeInTheDocument();
  });

  /** The shape is shown rather than described, so it can be copied. */
  it("shows the expected document shape in the empty editor", async () => {
    await openDialog();

    const placeholder = screen
      .getByLabelText("JSON")
      .getAttribute("placeholder");

    expect(placeholder).toContain('"type": "NORMAL"');
    expect(placeholder).toContain('"type": "COMBINATION"');
    expect(placeholder).toContain('"legs"');
  });

  /** No toll in the format: a route carries KM, and the Engine derives the Toll. */
  /** The example states the Toll as an amount, and names no distance. */
  it("shows a toll amount and no distance in the example", async () => {
    await openDialog();

    const example = screen.getByLabelText("JSON").getAttribute("placeholder");

    expect(example).toContain('"toll"');
    expect(example).not.toContain("kilometres");
  });

  it("says that an older file with KM is refused", async () => {
    await openDialog();

    expect(screen.getByText(/oud bestand met een KM-veld wordt geweigerd/)).toBeInTheDocument();
  });

  it("writes nothing just by being opened", async () => {
    await openDialog();

    expect(writes()).toHaveLength(0);
  });
});

describe("checking a document", () => {
  it("sends the whole document to the check endpoint", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: BULK_CHECK_PATH,
      method: "POST",
    });
    expect(writes()[0].body).toEqual(JSON.parse(DOCUMENT));
  });

  /** The decisive property of the preview: it creates nothing. */
  it("never reaches the import endpoint", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes().map((call) => call.path)).not.toContain(BULK_PATH);
  });

  it("shows the counts the backend reported", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    expect(await screen.findByText("12 normale routes")).toBeInTheDocument();
    expect(screen.getByText("4 Combination-groepen")).toBeInTheDocument();
    expect(screen.getByText("8 Combination-legs")).toBeInTheDocument();
    expect(screen.getByText("Totaal route-legs: 20")).toBeInTheDocument();
  });

  /*
   * ── THE COUNTS ARE NOT COMPUTED HERE ──────────────────────────────────────
   * A document of two entries shown as twelve routes proves the screen renders
   * the backend's answer rather than counting the array itself. Counting here
   * would be a second implementation of what an entry creates — and a Combination
   * entry creates three records, not one.
   */
  it("shows the backend's counts even when they differ from the document", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    await screen.findByText("12 normale routes");
    expect(screen.queryByText("1 normale routes")).not.toBeInTheDocument();
  });

  describe("a document with entries to skip", () => {
    beforeEach(() => {
      respondWith({ check: partialCheck() });
    });

    async function checked(): Promise<void> {
      await openDialog();
      await paste(DOCUMENT);
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));
      await screen.findByText("Overgeslagen (3)");
    }

    it("shows what would be imported beside what would be skipped", async () => {
      await checked();

      expect(screen.getByText("Wordt toegevoegd")).toBeInTheDocument();
      expect(screen.getByText("2 normale routes")).toBeInTheDocument();
    });

    /** Every reason, each naming the entry — and the route — it belongs to. */
    it("lists each skipped entry with its route number, route and reason", async () => {
      await checked();

      expect(screen.getByText("Route 4 (Gent to Lille) — toll is required")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Route 15 (Antwerp to Kallo and Antwerp to Kallo) — beide legs van de combinatie zijn dezelfde route",
        ),
      ).toBeInTheDocument();
    });

    it("names the leg of a Combination it objects to", async () => {
      await checked();

      expect(screen.getByText("Route 11, Leg 2 — tarief must not be less than 0")).toBeInTheDocument();
    });

    it("still offers the import of the valid entries", async () => {
      await checked();

      expect(screen.getByRole("button", { name: "Importeren" })).toBeEnabled();
    });
  });

  describe("a document that cannot be read", () => {
    beforeEach(() => {
      respondWith({ check: refusedCheck() });
    });

    it("says it was refused, labelling the problem as the document's", async () => {
      await openDialog();
      await paste(DOCUMENT);
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      expect(await screen.findByText("Import geweigerd")).toBeInTheDocument();
      expect(screen.getByText("Document: routes must not be empty")).toBeInTheDocument();
      expect(screen.queryByText(/Route 0/)).not.toBeInTheDocument();
    });

    it("refuses to offer the import", async () => {
      await openDialog();
      await paste(DOCUMENT);
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      await screen.findByText("Import geweigerd");
      expect(screen.getByRole("button", { name: "Importeren" })).toBeDisabled();
    });
  });

  /**
   * The one judgement this screen makes about the content, because text that is
   * not JSON cannot be sent: there is nothing to send.
   */
  it("says so when the text is not JSON at all, without calling the backend", async () => {
    await openDialog();
    await paste("Antwerp naar Kallo, 100 euro");
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dit is geen geldige JSON.",
    );
    expect(writes()).toHaveLength(0);
  });

  /**
   * A document with no routes array IS valid JSON, so it goes to the backend —
   * which reports it in the same list, in the same words, as any other problem.
   */
  it("sends JSON with no routes array to the backend anyway", async () => {
    respondWith({ check: refusedCheck() });
    await openDialog();
    await paste('{ "prices": [] }');
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe(BULK_CHECK_PATH);
  });

  it("cannot be checked while empty", async () => {
    await openDialog();

    expect(screen.getByRole("button", { name: "Controleren" })).toBeDisabled();
  });

  /** A preview belongs to the text it was made from. */
  it("clears the preview when the document is edited", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

    await screen.findByText("12 normale routes");

    await paste(DOCUMENT.replace("Antwerp", "Zeebrugge"));

    expect(screen.queryByText("12 normale routes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importeren" })).toBeDisabled();
  });
});

describe("importing", () => {
  async function checkedAndImported(): Promise<void> {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));
    await screen.findByText("12 normale routes");
    await userEvent.click(screen.getByRole("button", { name: "Importeren" }));
  }

  it("sends the same document to the import endpoint", async () => {
    await checkedAndImported();

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ path: BULK_PATH, method: "POST" });
    expect(writes()[1].body).toEqual(JSON.parse(DOCUMENT));
  });

  it("shows that everything was imported", async () => {
    await checkedAndImported();

    expect(
      await screen.findByText("Import voltooid: alle routes zijn toegevoegd"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /** 13/14. The owner's case: imported AND skipped, both on screen. */
  it("shows a partial import with the imported counts and every skipped route", async () => {
    respondWith({
      imported: importResult({
        outcome: "PARTIAL",
        imported: { normalRoutes: 24, combinationGroups: 0, combinationLegs: 0, totalRoutes: 24 },
        skipped: partialCheck().skipped.slice(2),
      }),
    });

    await checkedAndImported();

    expect(
      await screen.findByText("Import gedeeltelijk gelukt: geldige routes toegevoegd, de rest overgeslagen"),
    ).toBeInTheDocument();
    expect(screen.getByText("24 normale routes")).toBeInTheDocument();
    expect(screen.getByText("Overgeslagen (1)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Route 15 (Antwerp to Kallo and Antwerp to Kallo) — beide legs van de combinatie zijn dezelfde route",
      ),
    ).toBeInTheDocument();
  });

  it("does not present an import that stopped as a success", async () => {
    respondWith({
      imported: importResult({
        outcome: "ABORTED",
        imported: { normalRoutes: 3, combinationGroups: 0, combinationLegs: 0, totalRoutes: 3 },
        stoppedAt: { routeNumber: 4, message: "An unexpected error stopped the import at this route." },
        notAttempted: 6,
      }),
    });

    await checkedAndImported();

    expect(await screen.findByText("Import gestopt door een onverwachte fout")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "Route 4: onverwachte fout, deze route is niet opgeslagen. Routes ervoor zijn toegevoegd; 6 route(s) erna zijn niet geprobeerd.",
    );
  });

  it("is run once per preview", async () => {
    await checkedAndImported();
    await screen.findByText("Import voltooid: alle routes zijn toegevoegd");

    expect(screen.getByRole("button", { name: "Importeren" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Sluiten" }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });

  /** So the imported routes and Combinations appear without a refresh. */
  it("reloads the route list afterwards", async () => {
    await checkedAndImported();

    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === "GET" && call.path === ROUTES_PATH),
      ).toHaveLength(2),
    );
    expect(
      calls.filter(
        (call) => call.method === "GET" && call.path === COMBINATIONS_PATH,
      ),
    ).toHaveLength(2);
  });

  it("reports that it was saved", async () => {
    await checkedAndImported();

    expect(await screen.findByRole("status")).toHaveTextContent("Opgeslagen");
  });

  /**
   * 15. A document the backend cannot read is refused as a whole. The refusal
   * is shown rather than swallowed, and the dialog stays open with the text
   * still in it.
   */
  it("shows a refusal from the import itself and keeps the document", async () => {
    respondWith({
      importFailsWith: new Error("refused"),
    });

    await checkedAndImported();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("JSON")).toHaveValue(DOCUMENT);
  });
});

describe("closing without importing", () => {
  it("writes nothing", async () => {
    await openDialog();
    await paste(DOCUMENT);
    await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});
