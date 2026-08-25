import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { Trip, TripStatus } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-24",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * "Alles" in Week and Month view.
 *
 * ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
 * Not the query. Checked against the running backend, "Alles" is exactly the
 * union it should be — for one real December the three requests answered 18
 * OPEN, 0 CLOSED, 1 CANCELLED and 19 for no status at all.
 *
 * Two things around it made it look otherwise. There was no CANCELLED choice
 * and no cancelled counter, so a cancelled Trip could be seen under "Alles" and
 * never isolated, and the counters read "18 open, 0 afgewerkt, 19 totaal" —
 * arithmetic that reads as a filter losing rows. And one page size served all
 * three periods, so a wider filter over a month pushed rows past the end of
 * page one, where a Trip that had just been visible was suddenly not.
 *
 * The mock below answers like the backend does — it filters by the status
 * parameter it is GIVEN — so a test here fails if the page ever sends the wrong
 * one, rather than passing on a mock that returns everything regardless.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";

const WEEK: readonly Trip[] = [
  buildTrip({
    id: "trip-open-mon",
    bookingNumber: "ANRDUB2600001",
    status: "OPEN",
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
  }),
  buildTrip({
    id: "trip-closed-mon",
    bookingNumber: "ANRDUB2600002",
    status: "CLOSED",
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
  }),
  buildTrip({
    id: "trip-open-tue",
    bookingNumber: "ANRDUB2600003",
    status: "OPEN",
    planningDate: TUESDAY,
    originalPlanningDate: TUESDAY,
  }),
  buildTrip({
    id: "trip-cancelled-tue",
    bookingNumber: "ANRDUB2600004",
    status: "CANCELLED",
    planningDate: TUESDAY,
    originalPlanningDate: TUESDAY,
  }),
];

/** The backend's own rule: a status narrows, its absence shows everything. */
function matching(status: unknown): Trip[] {
  return status === undefined || status === null || status === ""
    ? [...WEEK]
    : WEEK.filter((trip) => trip.status === (status as TripStatus));
}

function showPeriod(): void {
  respondWith(requestMock, {});

  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [
      string,
      { query?: Record<string, unknown> } | undefined,
    ];
    const query = options?.query ?? {};

    if (path === "/api/v1/trips" && query.pageSize !== 1) {
      return Promise.resolve(buildPage(matching(query.status)));
    }

    if (path === "/api/v1/trips" && query.pageSize === 1) {
      return Promise.resolve(
        buildPage([], { totalItems: matching(query.status).length }),
      );
    }

    if (path === "/api/v1/vehicles" || path === "/api/v1/custom-properties") {
      return Promise.resolve(buildPage([]));
    }

    if (path === "/api/v1/trips/terminals") {
      return Promise.resolve([]);
    }

    return Promise.resolve(buildPage([]));
  });

  renderRitten();
}

async function chooseView(name: "Week" | "Maand"): Promise<void> {
  await userEvent.click(screen.getByRole("radio", { name }));
  await waitFor(() => {
    expect(lastListCall(requestMock).planningDateFrom).toBeDefined();
  });
}

async function chooseStatus(name: string): Promise<void> {
  await userEvent.click(
    within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
      "radio",
      { name },
    ),
  );
}

describe("the status filter over a week and a month", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("week", () => {
    /** The reported case: nothing may disappear because Alles is chosen. */
    it("shows every status under Alle", async () => {
      showPeriod();
      await chooseView("Week");

      expect(await screen.findByText("ANRDUB2600001")).toBeInTheDocument();
      expect(screen.getByText("ANRDUB2600002")).toBeInTheDocument();
      expect(screen.getByText("ANRDUB2600003")).toBeInTheDocument();
      expect(screen.getByText("ANRDUB2600004")).toBeInTheDocument();
    });

    it("keeps Monday's OPEN and CLOSED together under Alle", async () => {
      showPeriod();
      await chooseView("Week");

      const monday = (await screen.findByText("ANRDUB2600001")).closest(
        "table",
      ) as HTMLElement;

      expect(within(monday).getByText("ANRDUB2600002")).toBeInTheDocument();
    });

    it("sends no status at all for Alle", async () => {
      showPeriod();
      await chooseView("Week");

      expect(lastListCall(requestMock).status).toBeUndefined();
    });

    it("shows only OPEN under Open", async () => {
      showPeriod();
      await chooseView("Week");
      await chooseStatus("Open");

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("OPEN");
      });
      expect(await screen.findByText("ANRDUB2600001")).toBeInTheDocument();
      expect(screen.queryByText("ANRDUB2600002")).toBeNull();
      expect(screen.queryByText("ANRDUB2600004")).toBeNull();
    });

    it("shows only CLOSED under Afgewerkt", async () => {
      showPeriod();
      await chooseView("Week");
      await chooseStatus("Afgewerkt");

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("CLOSED");
      });
      expect(await screen.findByText("ANRDUB2600002")).toBeInTheDocument();
      expect(screen.queryByText("ANRDUB2600001")).toBeNull();
    });

    /** The choice that did not exist, and whose absence made Alles look wrong. */
    it("shows only CANCELLED under Geannuleerd", async () => {
      showPeriod();
      await chooseView("Week");
      await chooseStatus("Geannuleerd");

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("CANCELLED");
      });
      expect(await screen.findByText("ANRDUB2600004")).toBeInTheDocument();
      expect(screen.queryByText("ANRDUB2600001")).toBeNull();
    });

    /** Alle is the union: everything a narrower filter shows, it shows too. */
    it("is a superset of each single status", async () => {
      showPeriod();
      await chooseView("Week");
      await chooseStatus("Open");
      await screen.findByText("ANRDUB2600001");

      await chooseStatus("Alle");

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBeUndefined();
      });
      for (const booking of [
        "ANRDUB2600001",
        "ANRDUB2600002",
        "ANRDUB2600003",
        "ANRDUB2600004",
      ]) {
        expect(await screen.findByText(booking)).toBeInTheDocument();
      }
    });
  });

  describe("month", () => {
    it("shows every status under Alle", async () => {
      showPeriod();
      await chooseView("Maand");

      expect(await screen.findByText("ANRDUB2600001")).toBeInTheDocument();
      expect(screen.getByText("ANRDUB2600002")).toBeInTheDocument();
      expect(screen.getByText("ANRDUB2600004")).toBeInTheDocument();
    });

    /**
     * A month holds far more than a day, so one page size for all three
     * periods let a wider filter push rows past the end of page one — where a
     * Trip that had just been visible under Open was suddenly gone.
     */
    it("asks for a page large enough to hold the period", async () => {
      showPeriod();
      await chooseView("Maand");

      expect(lastListCall(requestMock).pageSize).toBe(200);
    });

    it("asks for a smaller page for one day", async () => {
      showPeriod();
      await screen.findByText("ANRDUB2600001");

      expect(lastListCall(requestMock).pageSize).toBe(50);
    });
  });

  /** The counters must add up, or the filter looks broken even when it is not. */
  describe("the counters", () => {
    it("counts the cancelled Trips of the period too", async () => {
      showPeriod();
      await chooseView("Week");

      const cancelled = await screen.findByRole("button", {
        name: /Geannuleerd/,
      });

      expect(within(cancelled).getByText("1")).toBeInTheDocument();
    });

    it("offers Geannuleerd as a filter", async () => {
      showPeriod();
      await chooseView("Week");

      await userEvent.click(
        await screen.findByRole("button", { name: /Geannuleerd/ }),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("CANCELLED");
      });
    });
  });
});
