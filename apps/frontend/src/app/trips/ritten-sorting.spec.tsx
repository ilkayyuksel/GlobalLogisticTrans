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
 * Ordering the Ritten list.
 *
 * Every assertion here is about the REQUEST. Sorting the rows already in the
 * browser would order only the page in view: a planner asking for "the earliest
 * Trip this week" would be shown the earliest of page one, which is a wrong
 * answer that looks right. So what matters is that the backend was asked.
 */
describe("Ritten sorting", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showList(trips = [buildTrip()]) {
    respondWith(requestMock, { trips: buildPage(trips) });

    renderRitten();
    await screen.findByRole("table");
  }

  describe("what is asked of the backend", () => {
    it("sorts by start time ascending until told otherwise", async () => {
      await showList();

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          sortBy: "startTime",
          sortDirection: "asc",
        });
      });
    });

    it("asks the backend again when the time is changed", async () => {
      await showList();

      await userEvent.click(screen.getByRole("radio", { name: "Eind" }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          sortBy: "endTime",
          sortDirection: "asc",
        });
      });
    });

    it("flips the direction", async () => {
      await showList();

      await userEvent.click(
        screen.getByRole("button", { name: /Oplopend/ }),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          sortBy: "startTime",
          sortDirection: "desc",
        });
      });
    });

    it("keeps the chosen time when the direction flips", async () => {
      await showList();

      await userEvent.click(screen.getByRole("radio", { name: "Eind" }));
      await userEvent.click(screen.getByRole("button", { name: /Oplopend/ }));

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          sortBy: "endTime",
          sortDirection: "desc",
        });
      });
    });

    /** The period is what defines the sections; sorting must not disturb it. */
    it("keeps the period filters alongside the sort", async () => {
      await showList();

      await userEvent.click(screen.getByRole("radio", { name: "Eind" }));

      await waitFor(() => {
        const call = lastListCall(requestMock);

        expect(call.sortBy).toBe("endTime");
        expect(call.planningDateFrom ?? call.planningDate).toBeDefined();
      });
    });
  });

  describe("the control", () => {
    it("marks the chosen time", async () => {
      await showList();

      expect(screen.getByRole("radio", { name: "Begin" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByRole("radio", { name: "Eind" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("names the direction it will apply", async () => {
      await showList();

      expect(screen.getByRole("button", { name: /Oplopend/ })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /Oplopend/ }));

      expect(screen.getByRole("button", { name: /Aflopend/ })).toBeInTheDocument();
    });
  });

  /**
   * The rows arrive already ordered, so the table only marks where one truck's
   * block ends. These check the heading, not the order.
   */
  describe("grouping by vehicle", () => {
    const RED = "#dc2626";

    function onVehicle(id: string, licensePlate: string, booking: string) {
      return buildTrip({
        id,
        bookingNumber: booking,
        vehicle: { id, licensePlate, displayColor: RED, isActive: true },
      });
    }

    it("heads each truck's block with its plate", async () => {
      await showList([
        onVehicle("a", "1-ABC-123", "BK-1"),
        onVehicle("b", "1-ABC-123", "BK-2"),
        onVehicle("c", "2-GUR-425", "BK-3"),
      ]);

      const table = screen.getByRole("table");
      const headings = within(table)
        .getAllByRole("columnheader")
        .filter((cell) => cell.getAttribute("scope") === "colgroup")
        .map((cell) => cell.textContent);

      expect(headings).toEqual(["1-ABC-123(2)", "2-GUR-425(1)"]);
    });

    it("names the block of Trips with no truck", async () => {
      await showList([
        onVehicle("a", "1-ABC-123", "BK-1"),
        buildTrip({ id: "b", bookingNumber: "BK-2", vehicle: null }),
      ]);

      const table = screen.getByRole("table");

      expect(within(table).getByText(/Zonder voertuig/)).toBeInTheDocument();
    });
  });
});
