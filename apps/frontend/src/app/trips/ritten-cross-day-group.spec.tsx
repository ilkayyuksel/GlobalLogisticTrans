import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  mutationCalls,
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

/**
 * Grouping Trips that fall on different days.
 *
 * ── THE JOB THIS SERVES ─────────────────────────────────────────────────────
 * One movement often spans two days: the container goes out on the 25th and the
 * empty comes back on the 26th. They are one job, and an operator must be able
 * to say so without first moving either Trip onto the other's day — which would
 * re-plan a truck to make the interface happy.
 *
 * So the list never filters what may be selected by date, and the confirmation
 * says the difference is intentional rather than leaving the operator to wonder.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("grouping Trips from different days", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  const DELIVERY = buildTrip({
    id: "trip-delivery",
    bookingNumber: "DUBANR2598395",
    planningDate: "2026-08-25",
    originalPlanningDate: "2026-08-25",
    direction: "DELIVERY",
  });

  const COLLECTION = buildTrip({
    id: "trip-collection",
    bookingNumber: "ANRBEL2603249",
    planningDate: "2026-08-26",
    originalPlanningDate: "2026-08-26",
    direction: "COLLECTION",
  });

  async function showBothDays(): Promise<void> {
    respondWith(requestMock, { trips: buildPage([DELIVERY, COLLECTION]) });
    renderRitten();
    await screen.findByText("DUBANR2598395");
  }

  async function selectBoth(): Promise<void> {
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Selecteer rit DUBANR2598395" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Selecteer rit ANRBEL2603249" }),
    );
  }

  async function openConfirmation(): Promise<HTMLElement> {
    await selectBoth();
    await userEvent.click(
      screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
    );

    return screen.findByRole("dialog");
  }

  it("lets both be selected, though they are a day apart", async () => {
    await showBothDays();
    await selectBoth();

    expect(
      screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
    ).toBeEnabled();
  });

  it("shows each Trip on its own date in the confirmation", async () => {
    await showBothDays();
    const dialog = await openConfirmation();

    expect(within(dialog).getByText("25/08/2026")).toBeInTheDocument();
    expect(within(dialog).getByText("26/08/2026")).toBeInTheDocument();
  });

  /** Said plainly, so the operator does not take it for a mistake. */
  it("says that different days are intentional", async () => {
    await showBothDays();
    const dialog = await openConfirmation();

    expect(
      within(dialog).getByText(/verschillende dagen/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/eigen planningsdatum/),
    ).toBeInTheDocument();
  });

  it("does not say it when both fall on one day", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        DELIVERY,
        buildTrip({
          id: "trip-same-day",
          bookingNumber: "ANRBEL2603249",
          planningDate: "2026-08-25",
          originalPlanningDate: "2026-08-25",
        }),
      ]),
    });
    renderRitten();
    await screen.findByText("DUBANR2598395");

    const dialog = await openConfirmation();

    expect(within(dialog).queryByText(/verschillende dagen/)).toBeNull();
  });

  it("sends both ids to the existing grouping endpoint", async () => {
    await showBothDays();
    const dialog = await openConfirmation();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Groeperen" }),
    );

    await waitFor(() => {
      expect(mutationCalls(requestMock)[0][0]).toBe("/api/v1/trip-groups");
    });
    expect(mutationCalls(requestMock)[0][1]).toMatchObject({
      method: "POST",
      body: { tripIds: ["trip-delivery", "trip-collection"] },
    });
  });

  /** Nothing about a date is sent: grouping never re-plans a Trip. */
  it("sends no planning date with the group", async () => {
    await showBothDays();
    const dialog = await openConfirmation();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Groeperen" }),
    );

    await waitFor(() => {
      expect(mutationCalls(requestMock)).toHaveLength(1);
    });
    expect(JSON.stringify(mutationCalls(requestMock)[0][1])).not.toContain(
      "planningDate",
    );
    expect(JSON.stringify(mutationCalls(requestMock)[0][1])).not.toContain(
      "2026-08-25",
    );
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(requestMock, { trips: buildPage([DELIVERY, COLLECTION]) });
      renderRitten();
      await screen.findByText("DUBANR2598395");

      await userEvent.click(
        screen.getByRole("checkbox", { name: "Seferi seç DUBANR2598395" }),
      );
      await userEvent.click(
        screen.getByRole("checkbox", { name: "Seferi seç ANRBEL2603249" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Seçili seferleri grupla" }),
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/farklı günlerde/)).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      await showBothDays();
      const dialog = await openConfirmation();

      expect(dialog.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(within(dialog).getByText(/verschillende dagen/)).toBeInTheDocument();
    });
  });
});
