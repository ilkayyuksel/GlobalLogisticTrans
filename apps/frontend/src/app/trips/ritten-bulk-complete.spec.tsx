import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-25",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Ticking several Trips off at once.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * Closing a day's work used to be one menu, one browser dialog and one refetch
 * per Trip. The dialog is gone — completing is routine, and a confirmation in
 * front of a routine action is one people learn to dismiss without reading —
 * and the whole selection now goes in ONE request.
 *
 * The other thing that is gone is the warning that followed a Trip with no
 * configured price. It read as a failure of the completion and never was one.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("completing several Trips at once", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  const OPEN_A = buildTrip({
    id: "trip-a",
    bookingNumber: "ANRDUB2602247",
    status: "OPEN",
  });

  const OPEN_B = buildTrip({
    id: "trip-b",
    bookingNumber: "ANRBEL2603249",
    status: "OPEN",
    planningDate: "2026-08-26",
    originalPlanningDate: "2026-08-26",
  });

  const CLOSED = buildTrip({
    id: "trip-closed",
    bookingNumber: "ANRDUB2765105",
    status: "CLOSED",
  });

  async function show(trips = [OPEN_A, OPEN_B]): Promise<void> {
    respondWith(requestMock, { trips: buildPage(trips) });
    renderRitten();
    await screen.findByText(trips[0].bookingNumber as string);
  }

  async function select(...bookings: string[]): Promise<void> {
    for (const booking of bookings) {
      await userEvent.click(
        screen.getByRole("checkbox", { name: `Selecteer rit ${booking}` }),
      );
    }
  }

  function completionCalls() {
    return mutationCalls(requestMock).filter(
      ([path]) => path === "/api/v1/trips/completions",
    );
  }

  describe("the bulk action", () => {
    it("appears as soon as one Trip is selected", async () => {
      await show();
      await select("ANRDUB2602247");

      expect(screen.getByRole("button", { name: "Afwerken" })).toBeEnabled();
      expect(screen.getByText(/1 geselecteerd/)).toBeInTheDocument();
    });

    it("is absent while nothing is selected", async () => {
      await show();

      expect(screen.queryByRole("button", { name: "Afwerken" })).toBeNull();
    });

    /** Nothing to do to a Trip that is already finished. */
    it("is disabled when the selection cannot be closed", async () => {
      await show([CLOSED]);
      await select("ANRDUB2765105");

      expect(screen.getByRole("button", { name: "Afwerken" })).toBeDisabled();
    });
  });

  describe("closing the selection", () => {
    it("sends every selected Trip in ONE request", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()).toHaveLength(1);
      });
      expect(completionCalls()[0][1]).toMatchObject({
        method: "POST",
        body: { tripIds: ["trip-a", "trip-b"] },
      });
    });

    /** The regression this guards: never one request per row. */
    it("sends no per-Trip status request", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()).toHaveLength(1);
      });
      expect(
        mutationCalls(requestMock).filter(([path]) =>
          String(path).endsWith("/status"),
        ),
      ).toHaveLength(0);
    });

    it("asks no browser confirmation", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()).toHaveLength(1);
      });
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("clears the selection and refetches afterwards", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");
      const listsBefore = requestMock.mock.calls.filter(
        ([path]) => path === "/api/v1/trips",
      ).length;

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      expect(await screen.findByText("Ritten afgewerkt")).toBeInTheDocument();
      await waitFor(() => {
        expect(
          requestMock.mock.calls.filter(([path]) => path === "/api/v1/trips")
            .length,
        ).toBeGreaterThan(listsBefore);
      });
      expect(screen.queryByRole("button", { name: "Afwerken" })).toBeNull();
    });

    /** Trips from two days are one selection like any other. */
    it("closes Trips that fall on different days", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()[0][1]).toMatchObject({
          body: { tripIds: ["trip-a", "trip-b"] },
        });
      });
    });

    /** Only ids are sent: nothing else about a Trip is touched. */
    it("sends nothing but the ids", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()).toHaveLength(1);
      });

      const body = (completionCalls()[0][1] as { body: object }).body;

      expect(Object.keys(body)).toEqual(["tripIds"]);
    });
  });

  /**
   * ── A TRIP WITH NO CONFIGURED PRICE ───────────────────────────────────────
   * It closes like any other, and nothing says otherwise. The absence of a
   * price is visible where prices are; it is not an outcome of completing.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a selection whose Trips are not all priced", () => {
    it("closes them all without warning about a missing price", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      expect(await screen.findByText("Ritten afgewerkt")).toBeInTheDocument();
      // Nothing about a price is reported by completing. The export button
      // and the pricing toggle are page furniture and stay where they are.
      expect(screen.queryByText(/geen prijsberekening/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reads no pricing while closing", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(completionCalls()).toHaveLength(1);
      });
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/trip-pricing/"),
        ),
      ).toHaveLength(0);
    });
  });

  describe("when the backend refuses", () => {
    it("reports it in the backend's own words, and keeps the selection", async () => {
      await show();
      await select("ANRDUB2602247", "ANRBEL2603249");

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          "A Trip cannot move from CANCELLED to CLOSED.",
          409,
        ),
      );

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      expect(
        await screen.findByText(/cannot move from CANCELLED/),
      ).toBeInTheDocument();
      expect(screen.getByText("Afwerken is niet gelukt")).toBeInTheDocument();
      // Still selected, so the operator can correct and try again.
      expect(screen.getByRole("button", { name: "Afwerken" })).toBeEnabled();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(requestMock, { trips: buildPage([OPEN_A, OPEN_B]) });
      renderRitten();
      await screen.findByText("ANRDUB2602247");

      await userEvent.click(
        screen.getByRole("checkbox", { name: "Seferi seç ANRDUB2602247" }),
      );

      expect(screen.getByRole("button", { name: "Tamamla" })).toBeEnabled();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      await show();
      await select("ANRDUB2602247");

      const button = screen.getByRole("button", { name: "Afwerken" });
      const toolbar = button.closest("div") as HTMLElement;

      expect(button.className).toMatch(/bg-primary/);
      expect(within(toolbar).getByText(/1 geselecteerd/)).toBeInTheDocument();
      expect(toolbar.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    });
  });
});
