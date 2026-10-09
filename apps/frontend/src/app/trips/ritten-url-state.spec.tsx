import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  listCalls,
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
  today: () => "2026-10-09",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * G. Back to the Ritten list returns to the SAME list.
 *
 * Back remounts the page, and the address it remounts with is the one the
 * user left: the day, the view, the filters, the sort and the page are read
 * from it and asked of the backend exactly as they were — so the rows, and
 * therefore the scroll position, are the ones the user was looking at.
 */
describe("the Ritten list's view state in the address", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ planningDate: "2026-10-04" })]),
    });
  });

  it("opens on the day, view, filter and sort the address names", async () => {
    window.history.replaceState(
      null,
      "",
      "/trips?view=week&date=2026-10-04&status=OPEN&sort=startTime&direction=desc",
    );

    renderRitten();

    await waitFor(() => expect(listCalls(requestMock).length).toBeGreaterThan(0));
    expect(lastListCall(requestMock)).toMatchObject({
      planningDateFrom: "2026-09-28",
      planningDateTo: "2026-10-04",
      status: "OPEN",
      sortBy: "startTime",
      sortDirection: "desc",
    });
  });

  it("keeps the page it was left on instead of resetting to page 1", async () => {
    window.history.replaceState(null, "", "/trips?date=2026-10-04&page=3");

    renderRitten();

    await waitFor(() => expect(listCalls(requestMock).length).toBeGreaterThan(0));
    expect(lastListCall(requestMock)).toMatchObject({
      planningDate: "2026-10-04",
      page: 3,
    });
  });

  it("opens on today, unfiltered, when the address names nothing", async () => {
    window.history.replaceState(null, "", "/trips");

    renderRitten();

    await waitFor(() => expect(listCalls(requestMock).length).toBeGreaterThan(0));
    expect(lastListCall(requestMock)).toMatchObject({ planningDate: "2026-10-09" });
    expect(lastListCall(requestMock).status).toBeUndefined();
  });

  it("writes a changed filter into the address, as the same entry", async () => {
    window.history.replaceState(null, "", "/trips?date=2026-10-04");
    const entries = window.history.length;
    renderRitten();
    await screen.findAllByRole("radio");

    await userEvent.click(screen.getByRole("radio", { name: /^open$/i }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("status")).toBe("OPEN"),
    );
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-04");
    expect(window.history.length).toBe(entries);
  });
});
