import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  listCalls,
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
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const GROUP_ID = "97777777-7777-4777-8777-777777777777";

/**
 * Selecting rows, grouping them, and taking one back out.
 *
 * Selection is per PAGE and the tests hold it to that: it clears whenever the
 * page, the filters or the view change, because a selection the operator can no
 * longer see is one they could group by accident.
 */
describe("Ritten selection and grouping", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  const TRIP_A = buildTrip({ id: "trip-a", bookingNumber: "AAA-1" });
  const TRIP_B = buildTrip({
    id: "trip-b",
    bookingNumber: "BBB-2",
    planningDate: "2026-08-13",
  });

  async function showTwoTrips(overrides = {}) {
    respondWith(requestMock, {
      trips: buildPage([TRIP_A, TRIP_B]),
      ...overrides,
    });

    renderRitten();
    await screen.findByRole("table");
  }

  function selectRow(bookingNumber: string) {
    return userEvent.click(
      screen.getByRole("checkbox", { name: `Selecteer rit ${bookingNumber}` }),
    );
  }

  function groupCalls() {
    return mutationCalls(requestMock).filter(
      ([path]) => path === "/api/v1/trip-groups",
    );
  }

  describe("selecting rows", () => {
    it("offers a checkbox per row", async () => {
      await showTwoTrips();

      expect(
        screen.getByRole("checkbox", { name: "Selecteer rit AAA-1" }),
      ).not.toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: "Selecteer rit BBB-2" }),
      ).toBeInTheDocument();
    });

    it("counts what is selected", async () => {
      await showTwoTrips();

      await selectRow("AAA-1");

      expect(await screen.findByText("1 geselecteerd")).toBeInTheDocument();

      await selectRow("BBB-2");

      expect(await screen.findByText("2 geselecteerd")).toBeInTheDocument();
    });

    /** The label says "visible" because that is exactly what it selects. */
    it("selects every visible row", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      await userEvent.click(
        screen.getByRole("button", { name: "Selecteer alle zichtbare ritten" }),
      );

      expect(await screen.findByText("2 geselecteerd")).toBeInTheDocument();
    });

    it("clears the selection", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      await userEvent.click(
        screen.getByRole("button", { name: "Selectie wissen" }),
      );

      await waitFor(() => {
        expect(screen.queryByText("1 geselecteerd")).not.toBeInTheDocument();
      });
    });

    it("unticks a row that is ticked again", async () => {
      await showTwoTrips();

      await selectRow("AAA-1");
      await selectRow("AAA-1");

      await waitFor(() => {
        expect(screen.queryByText(/geselecteerd/)).not.toBeInTheDocument();
      });
    });

    /** A selection that survived a filter change could group unseen Trips. */
    /**
     * ── THE SELECTION SURVIVES NAVIGATION ─────────────────────────────────
     * It used to be cleared on every filter, period and page change, which made
     * a cross-day Combination impossible to select: the operator has to change
     * day between ticking the outbound leg and the return one.
     *
     * So nothing clears it but the operator and a completed action. A Trip that
     * is off screen is still selected, and the toolbar keeps saying so.
     * ──────────────────────────────────────────────────────────────────────
     */
    it("keeps the selection when the filters change", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      await userEvent.type(screen.getByLabelText("Zoeken"), "psa");

      await waitFor(() => {
        expect(lastListCall(requestMock).search).toBe("psa");
      });
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });

    it("keeps the selection when the period changes", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      fireEvent.change(screen.getByLabelText("Kies een datum"), {
        target: { value: "2026-09-02" },
      });

      await waitFor(() => {
        expect(lastListCall(requestMock).planningDate).toBe("2026-09-02");
      });
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });

    it("keeps the selection when the view changes from day to week", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      await userEvent.click(screen.getByRole("radio", { name: "Week" }));

      await waitFor(() => {
        expect(lastListCall(requestMock).planningDateFrom).toBeDefined();
      });
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });
  });

  describe("grouping", () => {
    it("cannot be started with a single Trip", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");

      expect(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      ).toBeDisabled();
    });

    it("confirms what is about to be grouped", async () => {
      await showTwoTrips();
      await selectRow("AAA-1");
      await selectRow("BBB-2");

      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("2 ritten in deze groep")).toBeInTheDocument();
      expect(within(dialog).getByText("AAA-1")).toBeInTheDocument();
      expect(within(dialog).getByText("BBB-2")).toBeInTheDocument();
      expect(within(dialog).getAllByText("13/08/2026").length).toBeGreaterThan(0);
      // Nothing has been sent yet.
      expect(groupCalls()).toHaveLength(0);
    });

    it("posts the selected ids and refetches", async () => {
      await showTwoTrips();
      const listsBefore = listCalls(requestMock).length;

      await selectRow("AAA-1");
      await selectRow("BBB-2");
      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Groeperen",
        }),
      );

      await waitFor(() => {
        expect(groupCalls()[0][1]?.body).toEqual({
          tripIds: ["trip-a", "trip-b"],
        });
      });
      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(listsBefore);
      });
      expect(await screen.findByText("Groep aangemaakt")).toBeInTheDocument();
    });

    it("clears the selection and closes the dialog on success", async () => {
      await showTwoTrips();

      await selectRow("AAA-1");
      await selectRow("BBB-2");
      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Groeperen",
        }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(screen.queryByText("2 geselecteerd")).not.toBeInTheDocument();
    });

    /** A refusal keeps the rows selected so the operator can act on it. */
    it("shows a backend refusal and keeps the selection", async () => {
      await showTwoTrips();

      await selectRow("AAA-1");
      await selectRow("BBB-2");
      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          'Trip "trip-a" already belongs to group "g-1".',
          409,
        ),
      );

      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Groeperen",
        }),
      );

      expect(
        await screen.findByText(/already belongs to group/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    /** The marker in the table is the backend's id, never one invented here. */
    it("invents no group id", async () => {
      await showTwoTrips();

      await selectRow("AAA-1");
      await selectRow("BBB-2");
      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Groeperen",
        }),
      );

      await screen.findByText("Groep aangemaakt");

      // The refetched rows still carry no group, so no marker may appear.
      expect(screen.getAllByText("Geen groep")).toHaveLength(2);
    });
  });

  /**
   * Unlinking lives in the Combination dialog now.
   *
   * It used to be an entry in the row's "Acties" dropdown, which is gone. This
   * is its proper home anyway: a link is dissolved from the thing that shows
   * the link, beside the leg it removes.
   */
  describe("unlinking", () => {
    /** Opens the Combination, which is what the group badge in a row does. */
    async function openCombination() {
      await userEvent.click(
        await screen.findByRole("button", { name: /^G-/ }),
      );

      return screen.getByRole("dialog");
    }

    it("asks first, then clears the group", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        // What the Combination dialog fetches by group id: the legs of the
        // group, which may include days that are not on screen.
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });
      renderRitten();
      await screen.findByRole("table");

      const dialog = await openCombination();
      await userEvent.click(
        (
          await within(dialog).findAllByRole("button", {
            name: "Loskoppelen van groep",
          })
        )[0],
      );

      expect(confirmSpy).toHaveBeenCalledWith(
        "Deze rit uit de groep verwijderen?",
      );
      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/group",
          expect.objectContaining({
            method: "PATCH",
            body: { tripGroupId: null },
          }),
        );
      });
      expect(
        await screen.findByText("Rit losgekoppeld van de groep"),
      ).toBeInTheDocument();
    });

    it("sends nothing when the confirmation is declined", async () => {
      confirmSpy.mockReturnValue(false);
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        // What the Combination dialog fetches by group id: the legs of the
        // group, which may include days that are not on screen.
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });
      renderRitten();
      await screen.findByRole("table");

      const dialog = await openCombination();
      await userEvent.click(
        (
          await within(dialog).findAllByRole("button", {
            name: "Loskoppelen van groep",
          })
        )[0],
      );

      expect(mutationCalls(requestMock)).toHaveLength(0);
    });

    it("reports a refusal", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        // What the Combination dialog fetches by group id: the legs of the
        // group, which may include days that are not on screen.
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });
      renderRitten();
      await screen.findByRole("table");

      const dialog = await openCombination();
      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Trip does not belong to a group.", 409),
      );

      await userEvent.click(
        (
          await within(dialog).findAllByRole("button", {
            name: "Loskoppelen van groep",
          })
        )[0],
      );

      expect(
        await screen.findByText(/does not belong to a group/),
      ).toBeInTheDocument();
    });

    /*
     * Ungrouping reprices BOTH legs on the backend: the one taken out and the
     * one left behind. The response carries only the first, so the other leg's
     * new amounts arrive the way every mutation's do — with the one list
     * refetch that follows it. No row asks for its own pricing.
     */
    it("refetches the list once, so both legs show their repriced amounts", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });
      renderRitten();
      await screen.findByRole("table");

      const dialog = await openCombination();
      const listsBefore = listCalls(requestMock).length;

      await userEvent.click(
        (
          await within(dialog).findAllByRole("button", {
            name: "Loskoppelen van groep",
          })
        )[0],
      );

      await screen.findByText("Rit losgekoppeld van de groep");
      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(listsBefore);
      });
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).startsWith("/api/v1/trip-pricing"),
        ),
      ).toHaveLength(0);
    });
  });

  describe("the group dialog", () => {
    /** A manual group is not a Combination, and both must display. */
    it("shows a manual group of three Trips across dates", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [
          buildTrip({ id: "a", bookingNumber: "AAA-1", tripGroupId: GROUP_ID }),
          buildTrip({
            id: "b",
            bookingNumber: "BBB-2",
            tripGroupId: GROUP_ID,
            planningDate: "2026-09-01",
          }),
          buildTrip({
            id: "c",
            bookingNumber: "CCC-3",
            tripGroupId: GROUP_ID,
            planningDate: "2026-10-15",
            status: "CLOSED",
          }),
        ],
      });
      renderRitten();

      await userEvent.click(await screen.findByText("G-9777"));
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/01\/09\/2026/)).toBeInTheDocument();
      expect(within(dialog).getByText(/15\/10\/2026/)).toBeInTheDocument();
      expect(within(dialog).getByText("Afgewerkt")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("link", { name: "CCC-3" }),
      ).toHaveAttribute("href", "/trips/c");
    });
  });

  describe("in Turkish", () => {
    it("translates the selection toolbar", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTwoTrips();

      await userEvent.click(
        screen.getByRole("checkbox", { name: "Seferi seç AAA-1" }),
      );

      expect(await screen.findByText("1 seçildi")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Seçili seferleri grupla" }),
      ).toBeInTheDocument();
    });
  });
});
