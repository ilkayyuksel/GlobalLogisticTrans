import { screen, within } from "@testing-library/react";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/** One booking, three containers: three transports, and three rows. */
const BOOKING = "ANRDUB2602247";

/**
 * A booking that carries more than one container.
 *
 * ── WHY THIS IS A TEST ABOUT THE LIST ───────────────────────────────────────
 * A Trip is identified by its booking number AND its container number, so the
 * same booking legitimately appears several times — once per container, each
 * its own transport with its own truck, its own day and its own status.
 *
 * The list must therefore never fold them together on the strength of a shared
 * booking number. Each is a row, and each shows its own state; anything else
 * hides work an operator has to plan.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("Ritten with several containers on one booking", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  async function showTrips(): Promise<HTMLElement> {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-1",
          bookingNumber: BOOKING,
          containerNumber: "EUCU 453232/2",
          status: "OPEN",
        }),
        buildTrip({
          id: "trip-2",
          bookingNumber: BOOKING,
          containerNumber: "PVDU 301326/0",
          status: "CANCELLED",
        }),
        buildTrip({
          id: "trip-3",
          bookingNumber: BOOKING,
          // A collection names no container: (booking, none) is a whole
          // identity, not a missing value.
          containerNumber: null,
          status: "OPEN",
        }),
      ]),
    });

    renderRitten();
    await screen.findByText("EUCU 453232/2");

    return screen.getByRole("table");
  }

  function rowOf(containerNumber: string): HTMLElement {
    return screen.getByText(containerNumber).closest("tr") as HTMLElement;
  }

  it("shows one row per container, not one per booking", async () => {
    const table = await showTrips();

    expect(within(table).getAllByText(BOOKING)).toHaveLength(3);
    expect(within(table).getByText("EUCU 453232/2")).toBeInTheDocument();
    expect(within(table).getByText("PVDU 301326/0")).toBeInTheDocument();
  });

  /** Each identity has its own lifecycle: one cancelled says nothing about the rest. */
  it("gives each row its own status", async () => {
    await showTrips();

    expect(within(rowOf("EUCU 453232/2")).getByText("Open")).toBeInTheDocument();
    expect(
      within(rowOf("PVDU 301326/0")).getByText("Geannuleerd"),
    ).toBeInTheDocument();
  });

  /**
   * A collection names no container, and (booking, none) is a whole identity.
   * The list shows it as its own row with the container column empty — the em
   * dash the table uses everywhere for an absent value.
   */
  it("shows the collection that names no container as its own row", async () => {
    const table = await showTrips();
    const links = within(table).getAllByRole("link", { name: BOOKING });

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/trips/trip-1",
      "/trips/trip-2",
      "/trips/trip-3",
    ]);
  });

  it("does not group them merely because the booking is equal", async () => {
    const table = await showTrips();

    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(4);
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrips();

      expect(
        within(rowOf("PVDU 301326/0")).getByText("İptal edildi"),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      await showTrips();

      // The row's own cells carry no literal colour. The vehicle's planning
      // colour is a configured hex and is deliberately inline; it is not one.
      for (const container of ["EUCU 453232/2", "PVDU 301326/0"]) {
        // The BADGE, not the row's "Openen" button, which carries the same
        // word and is a control rather than a status.
        const status = within(rowOf(container)).getByText(
          /^(Open|Geannuleerd)$/,
        );

        expect(status.className).toMatch(/bg-(info|danger)/);
        expect(status.className).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    });
  });
});
