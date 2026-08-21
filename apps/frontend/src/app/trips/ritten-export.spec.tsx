import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";
import { EXPORT_MAX_ROWS } from "@/lib/api/trip-export";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The Excel export.
 *
 * The rule under test is that the file describes the CURRENT FILTERED
 * SELECTION, not the page on screen. An export that quietly held the first
 * fifty rows would be wrong in a way only discovered downstream, so the tests
 * assert what was fetched as much as what was written.
 */
describe("Ritten export", () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let clicked: string[];

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    clicked = [];

    createObjectURL = jest.fn(() => "blob:traxo");
    revokeObjectURL = jest.fn();
    // jsdom implements neither, and neither is what this is testing.
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true });

    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Every list request the export made, in order. */
  function exportCalls() {
    return requestMock.mock.calls
      .filter(([path]) => path === "/api/v1/trips")
      .map(
        ([, options]) =>
          (options as { query?: Record<string, unknown> })?.query ?? {},
      )
      // The export asks for the largest page the backend allows; the list and
      // the counters ask for 50 and 1.
      .filter((query) => query.pageSize === 200);
  }

  /**
   * Runs one of the two exports.
   *
   * Both read the same filtered selection; they differ in what they write. The
   * pricing one is the default here because it exercises the pricing fetch as
   * well as the list fetch.
   */
  async function startExport(
    which: "Excel — Prijsoverzicht" | "Excel — Basis" = "Excel — Prijsoverzicht",
  ): Promise<void> {
    renderRitten();
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: which }));
  }

  it("exports the whole filtered selection, not the visible page", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()], { totalItems: 120, totalPages: 3 }),
    });

    await startExport();

    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });

    // One request per page of the selection, and nothing else.
    expect(exportCalls().map((query) => query.page)).toEqual([1, 2, 3]);
  });

  it("carries the current period and filters into the export", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    renderRitten();
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    await userEvent.type(screen.getByLabelText("Zoeken"), "psa");
    // The search is debounced, so wait until the LIST is actually asking for
    // it — that is the same query the export will carry.
    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(
          ([path, options]) =>
            path === "/api/v1/trips" &&
            (options as { query?: { search?: string } })?.query?.search === "psa",
        ),
      ).toBe(true);
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Excel — Prijsoverzicht" }),
    );

    await waitFor(() => {
      expect(exportCalls()).not.toHaveLength(0);
    });
    expect(exportCalls()[0]).toMatchObject({
      planningDateFrom: "2026-08-10",
      planningDateTo: "2026-08-16",
      search: "psa",
    });
  });

  it("downloads a file named after the period", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    await startExport();

    await waitFor(() => {
      expect(clicked).toEqual(["TRANO_Prijzen_2026-08-13.xlsx"]);
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    expect(await screen.findByText("Export gedownload")).toBeInTheDocument();
  });

  /**
   * A browser cannot responsibly collect an unbounded selection, so it refuses
   * rather than half-exporting.
   */
  it("refuses a selection larger than one export may carry", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()], {
        totalItems: EXPORT_MAX_ROWS + 1,
        totalPages: 40,
      }),
    });

    await startExport();

    expect(await screen.findByText(/te groot om te exporteren/)).toBeInTheDocument();
    expect(clicked).toHaveLength(0);
  });

  it("reports a failed export instead of downloading an empty file", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    renderRitten();
    await screen.findByRole("table");
    requestMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Excel — Prijsoverzicht" }),
    );

    expect(
      await screen.findByText(/Export mislukt — De server is niet bereikbaar./),
    ).toBeInTheDocument();
    expect(clicked).toHaveLength(0);
  });

  describe("the two exports", () => {
    it("offers both, clearly named", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      renderRitten();
      await screen.findByRole("table");

      expect(
        screen.getByRole("button", { name: "Excel — Prijsoverzicht" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Excel — Basis" }),
      ).toBeInTheDocument();
    });

    it("names the pricing file after the prices it holds", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await startExport("Excel — Prijsoverzicht");

      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toMatch(/^TRANO_Prijzen_/);
    });

    it("names the basic file after the trips it holds", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await startExport("Excel — Basis");

      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toMatch(/^TRANO_Ritten_/);
    });

    /** Both files describe the same selection; only their columns differ. */
    it("reads the same filtered selection for either", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await startExport("Excel — Basis");

      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(exportCalls()[0]).toMatchObject({ pageSize: 200 });
    });

    /**
     * Reading pricing must never price anything: the export asks the bulk READ
     * endpoint and never the reprocess one.
     */
    it("never triggers a pricing calculation", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await startExport("Excel — Prijsoverzicht");

      await waitFor(() => expect(clicked).toHaveLength(1));

      const paths = requestMock.mock.calls.map(([path]) => String(path));

      expect(paths.some((path) => path.includes("/reprocess"))).toBe(false);
      expect(
        paths.some((path) => path.includes("/trip-pricing/snapshots")),
      ).toBe(true);
    });
  });

  it("is translated", async () => {
    window.localStorage.setItem("tms.language", "tr");
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    renderRitten();

    expect(
      await screen.findByRole("button", { name: "Excel — Fiyat özeti" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Excel — Temel" }),
    ).toBeInTheDocument();
  });
});
