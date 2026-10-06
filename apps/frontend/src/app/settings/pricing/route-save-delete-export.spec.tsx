import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import { downloadBlob } from "@/lib/download";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import PricingSettingsPage from "./page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/download", () => ({ downloadBlob: jest.fn() }));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;
const downloadMock = downloadBlob as jest.MockedFunction<typeof downloadBlob>;

/**
 * Saving, removing and exporting route prices.
 *
 * ── THE FAILURE THESE TESTS EXIST FOR ───────────────────────────────────────
 * Removing a route worked and said it had failed. The record was gone from the
 * database, the row stayed on the screen, and the banner read "Opslaan mislukt.
 * The server returned a response this application could not read." — because the
 * endpoint answered 204 No Content and every response in this API is supposed to
 * carry the standard envelope. An empty body is not one, so the browser had
 * nothing to read.
 *
 * The endpoints now answer 200 with the record they removed, which is the
 * convention every other DELETE in this API already followed. These tests hold
 * that contract from the screen's side: after a removal the row is gone, the list
 * has been refetched, and no error is shown.
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
    tunnel: "0.00",
    hasToll: true,
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    ...overrides,
  };
}

const COMBINATION_ID = "combination-1";

function combination() {
  return {
    id: COMBINATION_ID,
    overSt: { tarief: null, toll: null, tunnel: null },
    legs: [
      route({
        id: "leg-1",
        departure: "Antwerp",
        destination: "Kallo",
        tarief: "100.00",
        toll: "25.00",
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
  /** What is served once a removal has happened, so the list can change. */
  routesAfterDelete?: unknown[];
  combinationsAfterDelete?: unknown[];
}

let calls: { path: string; method: string }[];
let deleted: boolean;

function respondWith(responses: Responses = {}): void {
  calls = [];
  deleted = false;

  requestMock.mockImplementation((path, options) => {
    const method = (options?.method as string) ?? "GET";

    calls.push({ path, method });

    if (method === "DELETE") {
      deleted = true;

      /*
       * The contract under test: 200 with the record that was removed, carried
       * in the envelope the client unwraps. Not an empty body.
       */
      return Promise.resolve(
        path.includes("/combinations/") ? combination() : route(),
      );
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
      return Promise.resolve(
        deleted
          ? (responses.combinationsAfterDelete ?? [])
          : (responses.combinations ?? []),
      );
    }

    return Promise.resolve(
      deleted ? (responses.routesAfterDelete ?? []) : (responses.routes ?? []),
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
  screen
    .getByRole(name === "Van" || name === "Naar" ? "textbox" : "spinbutton", {
      name,
    });

/** How many times the two lists have been fetched. */
function listFetches(): number {
  return calls.filter(
    (call) =>
      call.method === "GET" &&
      (call.path === ROUTES_PATH || call.path === COMBINATIONS_PATH),
  ).length;
}

beforeEach(() => {
  requestMock.mockReset();
  downloadMock.mockReset();
  window.localStorage.clear();
  respondWith();
});

describe("saving a route", () => {
  it("reports it was saved, with no error", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );
    await userEvent.type(field("Van"), "Gent");
    await userEvent.type(field("Naar"), "Lille");
    await userEvent.type(field("Tarief"), "120");
    await userEvent.type(field("Toll"), "55");
    await userEvent.type(field("Tunnel"), "0");
    await userEvent.click(
      within(section()).getByRole("button", { name: "Opslaan" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Opgeslagen.");
    expect(screen.queryByText(/mislukt/)).not.toBeInTheDocument();
  });

  /** The list is refetched, so the new route is on screen without a refresh. */
  it("reloads both lists afterwards", async () => {
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    const before = listFetches();

    await userEvent.click(
      await screen.findByRole("button", { name: "Route toevoegen" }),
    );
    await userEvent.type(field("Van"), "Gent");
    await userEvent.type(field("Naar"), "Lille");
    await userEvent.type(field("Tarief"), "120");
    await userEvent.type(field("Toll"), "55");
    await userEvent.type(field("Tunnel"), "0");
    await userEvent.click(
      within(section()).getByRole("button", { name: "Opslaan" }),
    );

    await waitFor(() => expect(listFetches()).toBe(before + 2));
  });
});

describe("removing a route", () => {
  async function confirmRemoval(name: string): Promise<void> {
    await userEvent.click(await screen.findByRole("button", { name }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Verwijderen" }).at(-1) as HTMLElement,
    );
  }

  it("says it was removed rather than that saving failed", async () => {
    respondWith({ routes: [route()], routesAfterDelete: [] });
    renderPage();

    await confirmRemoval("Verwijderen Quay 869 Dourges");

    expect(await screen.findByRole("status")).toHaveTextContent("Verwijderd.");
  });

  /** The failure that started this: a removal that worked, reported as broken. */
  it("shows no error for a removal that succeeded", async () => {
    respondWith({ routes: [route()], routesAfterDelete: [] });
    renderPage();

    await confirmRemoval("Verwijderen Quay 869 Dourges");

    await waitFor(() => expect(deleted).toBe(true));
    expect(
      screen.queryByText(/could not read|mislukt/),
    ).not.toBeInTheDocument();
  });

  /** And the row goes, without the operator reaching for the refresh key. */
  it("takes the row off the screen without a refresh", async () => {
    respondWith({ routes: [route()], routesAfterDelete: [] });
    renderPage();

    await screen.findByText("Quay 869");
    await confirmRemoval("Verwijderen Quay 869 Dourges");

    await waitFor(() =>
      expect(screen.queryByText("Quay 869")).not.toBeInTheDocument(),
    );
  });

  it("reloads the lists after removing", async () => {
    respondWith({ routes: [route()], routesAfterDelete: [] });
    renderPage();

    await screen.findByText("Quay 869");
    const before = listFetches();

    await confirmRemoval("Verwijderen Quay 869 Dourges");

    await waitFor(() => expect(listFetches()).toBe(before + 2));
  });

  describe("a whole Combination", () => {
    it("removes the group and both legs from the screen", async () => {
      respondWith({
        combinations: [combination()],
        combinationsAfterDelete: [],
      });
      renderPage();

      await screen.findByText("Combination #1");
      await confirmRemoval("Verwijderen Combination 1");

      await waitFor(() =>
        expect(screen.queryByText("Combination #1")).not.toBeInTheDocument(),
      );
      expect(screen.queryByText("Antwerp")).not.toBeInTheDocument();
      expect(screen.queryByText("Kallo")).not.toBeInTheDocument();
    });

    it("shows no error, and says it was removed", async () => {
      respondWith({
        combinations: [combination()],
        combinationsAfterDelete: [],
      });
      renderPage();

      await screen.findByText("Combination #1");
      await confirmRemoval("Verwijderen Combination 1");

      expect(await screen.findByRole("status")).toHaveTextContent("Verwijderd.");
      expect(screen.queryByText(/could not read/)).not.toBeInTheDocument();
    });

    /** The group's id, never a leg's: half a Combination cannot be removed. */
    it("asks the backend to remove the group", async () => {
      respondWith({
        combinations: [combination()],
        combinationsAfterDelete: [],
      });
      renderPage();

      await screen.findByText("Combination #1");
      await confirmRemoval("Verwijderen Combination 1");

      await waitFor(() =>
        expect(
          calls.some(
            (call) =>
              call.method === "DELETE" &&
              call.path === `${COMBINATIONS_PATH}/${COMBINATION_ID}`,
          ),
        ).toBe(true),
      );
    });
  });
});

describe("exporting the configuration", () => {
  it("offers the export beside the other actions", async () => {
    respondWith({ routes: [route()] });
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(
      screen.getByRole("button", { name: "Exporteren JSON" }),
    ).toBeInTheDocument();
  });

  it("downloads a JSON file named for today", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();
    await screen.findByText("Quay 869");

    await userEvent.click(
      screen.getByRole("button", { name: "Exporteren JSON" }),
    );

    expect(downloadMock).toHaveBeenCalledTimes(1);

    const [blob, fileName] = downloadMock.mock.calls[0];

    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(fileName).toMatch(/^route-pricing-\d{4}-\d{2}-\d{2}\.json$/);
  });

  /*
   * ── THE SAME DATA THE TABLE SHOWS ─────────────────────────────────────────
   * Built from the lists the page already holds rather than from a second
   * endpoint, so the file cannot disagree with the screen. Read back here from
   * the blob the download was handed.
   */
  it("writes the routes and Combinations that are on screen", async () => {
    respondWith({ routes: [route()], combinations: [combination()] });
    renderPage();
    await screen.findByText("Quay 869");

    await userEvent.click(
      screen.getByRole("button", { name: "Exporteren JSON" }),
    );

    const [blob] = downloadMock.mock.calls[0];
    const document = JSON.parse(await readBlob(blob)) as {
      routes: { type: string; departure?: string; legs?: unknown[] }[];
    };

    expect(document.routes).toHaveLength(2);
    expect(document.routes[0]).toMatchObject({
      type: "NORMAL",
      departure: "Quay 869",
      tarief: 520,
    });
    expect(document.routes[1].type).toBe("COMBINATION");
    expect(document.routes[1].legs).toHaveLength(2);
  });

  /** Nothing configured is nothing to back up. */
  it("cannot be exported when nothing is configured", async () => {
    respondWith({ routes: [], combinations: [] });
    renderPage();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(
      screen.getByRole("button", { name: "Exporteren JSON" }),
    ).toBeDisabled();
  });

  /** A route removed is a route the next export does not carry. */
  it("leaves out a route that has just been removed", async () => {
    respondWith({ routes: [route()], routesAfterDelete: [] });
    renderPage();

    await screen.findByText("Quay 869");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Verwijderen Quay 869 Dourges",
      }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Verwijderen" }).at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(screen.queryByText("Quay 869")).not.toBeInTheDocument(),
    );

    expect(
      screen.getByRole("button", { name: "Exporteren JSON" }),
    ).toBeDisabled();
  });
});

/** jsdom's Blob has no `text()`, so the bytes are read the long way round. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
