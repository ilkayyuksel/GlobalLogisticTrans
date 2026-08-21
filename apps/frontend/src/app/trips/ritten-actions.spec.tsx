import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
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

/**
 * The row action menu: status, deletion, restoration and reprocessing.
 *
 * Which actions appear mirrors the backend's state machine for display only —
 * every one of them is still sent, and a refusal is shown as the backend worded
 * it. The tests below check both halves: that an impossible action is not
 * offered, and that a refused one is reported rather than assumed.
 */
describe("Ritten actions", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  async function openMenu(overrides = {}, responses = {}) {
    respondWith(requestMock, {
      trips: buildPage([buildTrip(overrides)]),
      ...responses,
    });

    renderRitten();

    await userEvent.click(
      await screen.findByRole("button", { name: /Acties ANRDUB2602247/ }),
    );

    return screen.getByRole("menu");
  }

  function mutations() {
    return mutationCalls(requestMock);
  }

  describe("what the menu offers", () => {
    it("offers closing and cancelling an OPEN Trip", async () => {
      const menu = await openMenu();

      expect(
        within(menu).getByRole("menuitem", { name: "Afwerken" }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: "Annuleren" }),
      ).toBeInTheDocument();
    });

    /**
     * A transport leaves the planning because a CANCEL: document says so — a
     * soft cancellation that keeps the record. A manual delete beside it would
     * be a second way to do the same thing, and the destructive one.
     */
    it.each(["OPEN", "CLOSED", "CANCELLED"] as const)(
      "offers no manual deletion of a %s Trip",
      async (status) => {
        const menu = await openMenu({ status });

        expect(
          within(menu).queryByRole("menuitem", { name: "Verwijderen" }),
        ).not.toBeInTheDocument();
      },
    );

    /** CLOSED is terminal in the backend, so reopening is never offered. */
    it("offers no transition out of CLOSED, but does offer reprocessing", async () => {
      const menu = await openMenu({ status: "CLOSED" });

      expect(
        within(menu).queryByRole("menuitem", { name: "Heropenen" }),
      ).not.toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: "Opnieuw verwerken" }),
      ).toBeInTheDocument();
    });

    it("offers reopening a CANCELLED Trip", async () => {
      const menu = await openMenu({ status: "CANCELLED" });

      expect(
        within(menu).getByRole("menuitem", { name: "Heropenen" }),
      ).toBeInTheDocument();
      expect(
        within(menu).queryByRole("menuitem", { name: "Verwijderen" }),
      ).not.toBeInTheDocument();
    });

    it("offers only restoration for a DELETED Trip", async () => {
      const menu = await openMenu({ status: "DELETED" });

      expect(
        within(menu).getByRole("menuitem", { name: "Herstellen" }),
      ).toBeInTheDocument();
      expect(
        within(menu).queryByRole("menuitem", { name: "Details bewerken" }),
      ).not.toBeInTheDocument();
    });

    it("does not offer reprocessing before a Trip is closed", async () => {
      const menu = await openMenu();

      expect(
        within(menu).queryByRole("menuitem", { name: "Opnieuw verwerken" }),
      ).not.toBeInTheDocument();
    });

    it("offers the group only for a Trip that has one", async () => {
      const menu = await openMenu({
        tripGroupId: "97777777-7777-4777-8777-777777777777",
      });

      expect(
        within(menu).getByRole("menuitem", { name: "Groep bekijken" }),
      ).toBeInTheDocument();
    });

    /** Every entry now has an endpoint behind it. */
    it("offers the PDF actions, and unlinking for a grouped Trip", async () => {
      const menu = await openMenu({
        tripGroupId: "97777777-7777-4777-8777-777777777777",
      });

      expect(
        within(menu).getByRole("menuitem", { name: "PDF bekijken" }),
      ).toBeEnabled();
      expect(
        within(menu).getByRole("menuitem", { name: "PDF downloaden" }),
      ).toBeEnabled();
      expect(
        within(menu).getByRole("menuitem", { name: "Loskoppelen van groep" }),
      ).toBeEnabled();
    });

    it("does not offer unlinking for a Trip with no group", async () => {
      const menu = await openMenu();

      expect(
        within(menu).queryByRole("menuitem", { name: "Loskoppelen van groep" }),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * The whole menu, per status.
   *
   * Listed exhaustively rather than probed item by item, because the rule that
   * matters is "do not display impossible actions" — and the way that breaks is
   * an entry nobody asserted the ABSENCE of. Every entry here has an endpoint
   * behind it, and the backend still decides.
   */
  describe("the menu, per status", () => {
    function itemsOf(menu: HTMLElement): string[] {
      return within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent ?? "");
    }

    const GROUP_ID = "97777777-7777-4777-8777-777777777777";

    it("offers an OPEN Trip everything that is possible for it", async () => {
      const menu = await openMenu({ status: "OPEN", tripGroupId: GROUP_ID });

      expect(itemsOf(menu)).toEqual([
        "Afwerken",
        "Annuleren",
        "Details bewerken",
        "Custom waarden",
        "Groep bekijken",
        "PDF bekijken",
        "PDF downloaden",
        "Loskoppelen van groep",
      ]);
    });

    /**
     * CLOSED is terminal in the backend's state machine, so "Heropenen" is not
     * offered — see the note in `trip-actions.ts`. Reopening is possible only
     * from CANCELLED. Soft deletion is likewise accepted only from OPEN.
     * Reprocessing appears here and nowhere else: pricing runs at closing.
     */
    it("offers a CLOSED Trip only what its status still allows", async () => {
      const menu = await openMenu({ status: "CLOSED", tripGroupId: GROUP_ID });

      expect(itemsOf(menu)).toEqual([
        "Details bewerken",
        "Custom waarden",
        "Opnieuw verwerken",
        "Groep bekijken",
        "PDF bekijken",
        "PDF downloaden",
        "Loskoppelen van groep",
      ]);
      expect(
        within(menu).queryByRole("menuitem", { name: "Heropenen" }),
      ).not.toBeInTheDocument();
    });

    it("offers reopening a CANCELLED Trip", async () => {
      const menu = await openMenu({ status: "CANCELLED" });

      expect(itemsOf(menu)).toEqual([
        "Heropenen",
        "Details bewerken",
        "Custom waarden",
        "PDF bekijken",
        "PDF downloaden",
      ]);
    });

    /** A DELETED Trip is read-only until it is restored. */
    it("offers a DELETED Trip only restoration", async () => {
      const menu = await openMenu({ status: "DELETED" });

      expect(itemsOf(menu)).toEqual([
        "Custom waarden",
        "PDF bekijken",
        "PDF downloaden",
        "Herstellen",
      ]);
    });

    it("never offers an Openen entry — the booking number is the link", async () => {
      const menu = await openMenu();

      expect(
        within(menu).queryByRole("menuitem", { name: "Openen" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("status changes", () => {
    it("closes a Trip after confirmation and refetches", async () => {
      const menu = await openMenu();
      const listsBefore = listCalls(requestMock).length;

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Afwerken" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/status",
          expect.objectContaining({
            method: "PATCH",
            body: { status: "CLOSED" },
          }),
        );
      });
      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(listsBefore);
      });
      expect(await screen.findByText("Status gewijzigd")).toBeInTheDocument();
    });

    it("sends nothing when the confirmation is declined", async () => {
      confirmSpy.mockReturnValue(false);
      const menu = await openMenu();

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Afwerken" }),
      );

      expect(mutations()).toHaveLength(0);
    });

    it("reports a refusal in the backend's own words", async () => {
      const menu = await openMenu();

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          "A Trip cannot move from CLOSED to CANCELLED.",
          409,
        ),
      );

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Annuleren" }),
      );

      expect(
        await screen.findByText(/A Trip cannot move from CLOSED/),
      ).toBeInTheDocument();
      expect(await screen.findByText("Actie mislukt")).toBeInTheDocument();
    });
  });

  describe("closing without a price", () => {
    /**
     * Pricing runs automatically at closing and can fail. The Trip is CLOSED
     * either way — it is never reopened to hide that.
     */
    it("says pricing needs attention when no snapshot exists", async () => {
      const menu = await openMenu({}, { pricing: null });

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Afwerken" }),
      );

      expect(
        await screen.findByText(/geen prijsberekening/),
      ).toBeInTheDocument();
    });

    it("says nothing when the snapshot is there", async () => {
      const menu = await openMenu(
        {},
        { pricing: { id: "pricing-1", totalPrice: "598.00" } },
      );

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Afwerken" }),
      );

      await screen.findByText("Status gewijzigd");

      expect(
        screen.queryByText(/geen prijsberekening/),
      ).not.toBeInTheDocument();
    });
  });

  describe("reprocessing", () => {
    it("posts to the reprocess endpoint and reports success", async () => {
      const menu = await openMenu({ status: "CLOSED" });

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Opnieuw verwerken" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trip-pricing/trip/trip-1/reprocess",
          expect.objectContaining({ method: "POST" }),
        );
      });
      expect(
        await screen.findByText("Prijs opnieuw berekend"),
      ).toBeInTheDocument();
    });

    it("reports a rejection cleanly", async () => {
      const menu = await openMenu({ status: "CLOSED" });

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "No route is configured for this trip.", 409),
      );

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Opnieuw verwerken" }),
      );

      expect(
        await screen.findByText(/No route is configured/),
      ).toBeInTheDocument();
    });
  });

  describe("deletion and restoration", () => {
    /**
     * Restoration stays reachable: a Trip soft-deleted before manual deletion
     * was withdrawn must still be recoverable, and stranding those records
     * would be the more destructive choice.
     */
    it("restores through the restoration sub-resource", async () => {
      const menu = await openMenu({ status: "DELETED" });

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Herstellen" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/restoration",
          expect.objectContaining({ method: "PATCH" }),
        );
      });
      expect(await screen.findByText("Rit hersteld")).toBeInTheDocument();
    });
  });

  describe("after a mutation", () => {
    it("keeps the view, the period and the filters", async () => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });
      renderRitten();
      await screen.findByRole("table");

      await userEvent.click(screen.getByRole("radio", { name: "Week" }));
      await userEvent.type(screen.getByLabelText("Zoeken"), "psa");
      await waitFor(() => {
        expect(
          listCalls(requestMock)[listCalls(requestMock).length - 1].search,
        ).toBe("psa");
      });

      await userEvent.click(
        screen.getAllByRole("button", { name: /Acties ANRDUB2602247/ })[0],
      );
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Afwerken" }),
      );

      await waitFor(() => {
        const latest = listCalls(requestMock)[listCalls(requestMock).length - 1];

        expect(latest).toMatchObject({
          search: "psa",
          planningDateFrom: "2026-08-10",
          planningDateTo: "2026-08-16",
        });
      });
    });
  });

  describe("the Combination dialog", () => {
    const GROUP_ID = "97777777-7777-4777-8777-777777777777";

    it("shows every leg with what identifies it, across dates", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [
          buildTrip({
            id: "a",
            bookingNumber: "DUBANR2598395",
            tripGroupId: GROUP_ID,
          }),
          buildTrip({
            id: "b",
            bookingNumber: "ANRBEL2603249",
            tripGroupId: GROUP_ID,
            planningDate: "2026-08-20",
            terminal: "Quay 869",
            destinationCity: "Rotterdam",
            destinationCountry: "Netherlands",
          }),
        ],
      });
      renderRitten();

      await userEvent.click(await screen.findByText("G-9777"));
      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByRole("link", { name: "DUBANR2598395" }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/20\/08\/2026/)).toBeInTheDocument();
      expect(within(dialog).getByText("Quay 869")).toBeInTheDocument();
      expect(
        within(dialog).getByText("Rotterdam, Netherlands"),
      ).toBeInTheDocument();
      expect(within(dialog).getAllByText("1-ABC-123")).toHaveLength(2);
      expect(within(dialog).getAllByText("Piet Janssens")).toHaveLength(2);
      expect(within(dialog).getAllByText("Open")).toHaveLength(2);
    });

    it("opens from the action menu as well", async () => {
      const menu = await openMenu(
        { tripGroupId: GROUP_ID },
        { groupMembers: [buildTrip({ tripGroupId: GROUP_ID })] },
      );

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Groep bekijken" }),
      );

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("in Turkish", () => {
    it("translates the menu", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });
      renderRitten();

      await userEvent.click(
        await screen.findByRole("button", { name: /İşlemler ANRDUB2602247/ }),
      );

      expect(
        screen.getByRole("menuitem", { name: "Tamamla" }),
      ).toBeInTheDocument();
    });
  });
});
