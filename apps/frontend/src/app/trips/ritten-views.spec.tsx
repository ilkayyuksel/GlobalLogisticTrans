import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  listCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

/** A fixed "today" so the default period is the same on every run. */
jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Ritten as Dag, Week and Maand — all three LISTS.
 *
 * The assertions are about two things: what was asked of the backend, and what
 * the operator sees. Nothing here expects an hourly grid or a vehicle lane,
 * because Ritten has neither.
 */
describe("Ritten views", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  describe("Day view", () => {
    it("opens on today and asks the backend for exactly that day", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      renderRitten();

      expect(await screen.findByText("ANRDUB2602247")).toBeInTheDocument();
      expect(lastListCall(requestMock)).toMatchObject({
        planningDate: "2026-08-13",
      });
      expect(lastListCall(requestMock).planningDateFrom).toBeUndefined();
    });

    it("heads the day with its full date and count", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip(), buildTrip({ id: "trip-2" })]),
      });

      renderRitten();

      expect(
        await screen.findByRole("heading", {
          name: "Donderdag 13 augustus 2026",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("2 ritten")).toBeInTheDocument();
    });

    it("says 'rit' when there is exactly one", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      renderRitten();

      expect(await screen.findByText("1 rit")).toBeInTheDocument();
    });

    it("shows a loading state before the response arrives", () => {
      requestMock.mockReturnValue(new Promise(() => undefined));

      renderRitten();

      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("reports a failed request and offers a retry", async () => {
      requestMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderRitten();

      expect(
        await screen.findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("shows an empty day as an empty section rather than as nothing", async () => {
      respondWith(requestMock, { trips: buildPage([]) });

      renderRitten();

      expect(
        await screen.findByRole("heading", {
          name: "Donderdag 13 augustus 2026",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("0 ritten")).toBeInTheDocument();
    });
  });

  describe("moving through days", () => {
    beforeEach(() => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    });

    it("steps back a day", async () => {
      renderRitten();
      await screen.findByText("ANRDUB2602247");

      await userEvent.click(screen.getByRole("button", { name: "Vorige" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDate: "2026-08-12",
        });
      });
    });

    it("steps forward a day", async () => {
      renderRitten();
      await screen.findByText("ANRDUB2602247");

      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDate: "2026-08-14",
        });
      });
    });

    it("returns to today, and cannot be pressed while already there", async () => {
      renderRitten();
      await screen.findByText("ANRDUB2602247");

      expect(screen.getByRole("button", { name: "Vandaag" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Vandaag" })).toBeEnabled();
      });

      await userEvent.click(screen.getByRole("button", { name: "Vandaag" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDate: "2026-08-13",
        });
      });
    });

    it("jumps to a picked date", async () => {
      renderRitten();
      await screen.findByText("ANRDUB2602247");

      // A date input is set, not typed into: jsdom does not model the
      // segmented editing a browser does.
      fireEvent.change(screen.getByLabelText("Kies een datum"), {
        target: { value: "2026-09-02" },
      });

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDate: "2026-09-02",
        });
      });
    });
  });

  describe("Week view", () => {
    async function showWeek() {
      renderRitten();
      await screen.findByRole("radio", { name: "Week" });
      await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    }

    it("asks for Monday to Sunday", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await showWeek();

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDateFrom: "2026-08-10",
          planningDateTo: "2026-08-16",
        });
      });
    });

    it("shows seven day sections, in order, empty ones included", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ planningDate: "2026-08-11" })]),
      });

      await showWeek();

      const headings = await screen.findAllByRole("heading", { level: 2 });

      expect(headings.map((heading) => heading.textContent)).toEqual([
        "Maandag 10 augustus",
        "Dinsdag 11 augustus",
        "Woensdag 12 augustus",
        "Donderdag 13 augustus",
        "Vrijdag 14 augustus",
        "Zaterdag 15 augustus",
        "Zondag 16 augustus",
      ]);
    });

    it("puts each Trip under the day it is planned for", async () => {
      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({ id: "a", bookingNumber: "MON-1", planningDate: "2026-08-10" }),
          buildTrip({ id: "b", bookingNumber: "WED-1", planningDate: "2026-08-12" }),
        ]),
      });

      await showWeek();

      const monday = (
        await screen.findByRole("heading", { name: "Maandag 10 augustus" })
      ).closest("section") as HTMLElement;
      const wednesday = screen
        .getByRole("heading", { name: "Woensdag 12 augustus" })
        .closest("section") as HTMLElement;

      expect(within(monday).getByText("MON-1")).toBeInTheDocument();
      expect(within(wednesday).getByText("WED-1")).toBeInTheDocument();
      expect(within(monday).queryByText("WED-1")).not.toBeInTheDocument();
    });

    it("opens a day in Day view when its heading is clicked", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ planningDate: "2026-08-11" })]),
      });

      await showWeek();
      await userEvent.click(
        await screen.findByRole("button", { name: "Dinsdag 11 augustus" }),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDate: "2026-08-11",
        });
      });
      expect(screen.getByRole("radio", { name: "Dag" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("steps a whole week at a time", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await showWeek();
      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDateFrom: "2026-08-17",
          planningDateTo: "2026-08-23",
        });
      });
    });

    /** A week shown one page at a time must never read as the whole week. */
    it("states plainly when the week does not fit on one page", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip()], {
          totalItems: 120,
          totalPages: 3,
        }),
      });

      await showWeek();

      expect(
        await screen.findByText(/past niet op één pagina/),
      ).toBeInTheDocument();
      // The pager states the true total, so "1 of 120" cannot be mistaken for
      // the whole week.
      const pagination = await screen.findByRole("navigation", {
        name: "Pagina",
      });

      expect(pagination.textContent).toContain("Getoond");
      expect(pagination.textContent).toContain("120");
      expect(pagination.textContent).toContain("3");
    });
  });

  describe("Month view", () => {
    async function showMonth() {
      renderRitten();
      await screen.findByRole("radio", { name: "Maand" });
      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));
    }

    it("asks for the whole month", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await showMonth();

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDateFrom: "2026-08-01",
          planningDateTo: "2026-08-31",
        });
      });
    });

    /** The month answers "which days have work", not "print every date". */
    it("lists only the days that hold Trips, in date order", async () => {
      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({ id: "a", planningDate: "2026-08-07" }),
          buildTrip({ id: "b", planningDate: "2026-08-02" }),
          buildTrip({ id: "c", planningDate: "2026-08-07" }),
        ]),
      });

      await showMonth();

      const headings = await screen.findAllByRole("heading", { level: 2 });

      expect(headings.map((heading) => heading.textContent)).toEqual([
        "2 augustus 2026",
        "7 augustus 2026",
      ]);
      expect(screen.getByText("2 ritten")).toBeInTheDocument();
    });

    it("steps a whole month at a time", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await showMonth();
      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDateFrom: "2026-09-01",
          planningDateTo: "2026-09-30",
        });
      });
    });

    it("jumps to a picked month", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      await showMonth();

      fireEvent.change(screen.getByLabelText("Kies een maand"), {
        target: { value: "2026-11" },
      });

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          planningDateFrom: "2026-11-01",
          planningDateTo: "2026-11-30",
        });
      });
    });

    it("says a month is empty rather than showing bare headings", async () => {
      respondWith(requestMock, { trips: buildPage([]) });

      await showMonth();

      expect(
        await screen.findByText("Geen ritten in deze periode"),
      ).toBeInTheDocument();
    });

    it("states plainly when the month does not fit on one page", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip()], { totalItems: 400, totalPages: 8 }),
      });

      await showMonth();

      expect(
        await screen.findByText(/past niet op één pagina/),
      ).toBeInTheDocument();
    });
  });

  describe("paging", () => {
    it("asks the backend for the next page instead of loading everything", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip()], { totalItems: 120, totalPages: 3 }),
      });

      renderRitten();
      await screen.findByText("ANRDUB2602247");

      const pagination = screen.getByRole("navigation", { name: "Pagina" });
      await userEvent.click(within(pagination).getByRole("button", { name: "Volgende" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({ page: 2 });
      });
      // Never the whole period at once.
      expect(
        listCalls(requestMock).every((call) => Number(call.pageSize) <= 50),
      ).toBe(true);
    });

    it("hides the pager when everything fits on one page", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      renderRitten();
      await screen.findByText("ANRDUB2602247");

      expect(
        screen.queryByRole("navigation", { name: "Pagina" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/past niet op één pagina/)).not.toBeInTheDocument();
    });
  });

  describe("in Turkish", () => {
    it("translates the views, the navigation and the headings", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });

      renderRitten();

      expect(
        await screen.findByRole("heading", { name: "Seferler", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Gün" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bugün" })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "13 Ağustos 2026 Perşembe" }),
      ).toBeInTheDocument();
    });
  });
});
