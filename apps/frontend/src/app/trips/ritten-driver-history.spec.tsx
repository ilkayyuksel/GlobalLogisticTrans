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
  today: () => "2026-08-25",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const PIET = {
  id: "driver-1",
  name: "Piet Janssens",
  isActive: true,
  source: "VEHICLE_ASSIGNMENT" as const,
};

const AHMET = {
  id: "driver-2",
  name: "Ahmet Yılmaz",
  isActive: true,
  source: "VEHICLE_ASSIGNMENT" as const,
};

const STAND_IN = {
  id: "driver-3",
  name: "Marc Vermeulen",
  isActive: true,
  source: "OVERRIDE" as const,
};

/**
 * The list, after the truck has changed hands.
 *
 * The truck was Piet's from 1 August and is Ahmet's from the 24th. The backend
 * resolves each Trip against the assignment covering ITS planning date, so the
 * three rows below carry three different answers — and the list's only job is
 * to show each Trip the driver that came with it.
 *
 * ── WHY THIS IS TESTED IN THE FRONTEND AT ALL ───────────────────────────────
 * Because the tempting shortcut is real: the page already knows the vehicle,
 * and could "helpfully" show that vehicle's current driver on every row. That
 * would relabel months of finished work the moment a truck is reassigned,
 * without a single database write to show for it. So the assertion is not only
 * that the right names appear, but that the page asked nobody about drivers.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("Ritten after a vehicle is reassigned", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showTrips(): Promise<void> {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-before",
          bookingNumber: "ANRDUB1000001",
          planningDate: "2026-08-10",
          originalPlanningDate: "2026-08-10",
          effectiveDriver: PIET,
        }),
        buildTrip({
          id: "trip-after",
          bookingNumber: "ANRDUB2000002",
          planningDate: "2026-08-25",
          originalPlanningDate: "2026-08-25",
          effectiveDriver: AHMET,
        }),
        buildTrip({
          id: "trip-override",
          bookingNumber: "ANRDUB3000003",
          planningDate: "2026-08-26",
          originalPlanningDate: "2026-08-26",
          driverId: STAND_IN.id,
          effectiveDriver: STAND_IN,
        }),
      ]),
    });

    renderRitten();

    await screen.findByText("ANRDUB1000001");
  }

  /** The row of one Trip, wherever the current view happens to place it. */
  function rowOf(bookingNumber: string): HTMLElement {
    return screen.getByText(bookingNumber).closest("tr") as HTMLElement;
  }

  it("keeps the previous driver on a Trip from before the handover", async () => {
    await showTrips();

    expect(
      within(rowOf("ANRDUB1000001")).getByText("Piet Janssens"),
    ).toBeInTheDocument();
  });

  it("shows the new driver on a Trip from after it", async () => {
    await showTrips();

    expect(
      within(rowOf("ANRDUB2000002")).getByText("Ahmet Yılmaz"),
    ).toBeInTheDocument();
  });

  /**
   * An override is a decision about one Trip, and outranks both periods. The
   * list shows the name the backend resolved and says nothing about where it
   * came from — that distinction belongs to the Trip's own page.
   */
  it("leaves a Trip's own driver untouched", async () => {
    await showTrips();

    expect(
      within(rowOf("ANRDUB3000003")).getByText("Marc Vermeulen"),
    ).toBeInTheDocument();
  });

  /** Three rows, one truck, three drivers — read, never derived. */
  it("does not resolve a driver for itself", async () => {
    await showTrips();

    const driverLookups = requestMock.mock.calls.filter(([path]) =>
      String(path).includes("/vehicle-assignments"),
    );

    expect(driverLookups).toHaveLength(0);
  });
});
