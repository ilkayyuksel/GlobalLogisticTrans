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
import type { TripStatus } from "@/lib/api/types";

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
 * The row's lifecycle actions, as buttons.
 *
 * ── THE "ACTIES" DROPDOWN IS GONE ───────────────────────────────────────────
 * It hid the thing an operator does all day — marking a transport finished —
 * behind an open, a read and a click. What is left in a row is deterministic:
 * one action per status.
 *
 *   OPEN       → Afwerken
 *   CANCELLED  → Openen
 *   CLOSED     → nothing. CLOSED is terminal in the backend's state machine.
 *   DELETED    → nothing. It leaves only through restore.
 *
 * The rest of the menu had already grown direct controls of its own: the PDF
 * column opens and downloads the document, the group badge opens the
 * Combination, the custom-property cell opens its dialog, and the booking
 * number links to the Trip — which is where cancelling, deleting, restoring and
 * reprocessing now live.
 *
 * NOTHING HERE CONFIRMS, and these tests hold that: no window.confirm, no
 * dialog, and no warning about a missing price.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("Ritten row actions", () => {
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

  async function showTrip(overrides = {}, responses = {}) {
    respondWith(requestMock, {
      trips: buildPage([buildTrip(overrides)]),
      ...responses,
    });

    renderRitten();
    await screen.findByRole("table");
  }

  /** The row's lifecycle button, whatever it currently says. */
  function actionButton(label: string) {
    return screen.queryByRole("button", {
      name: `${label} ANRDUB2602247`,
    });
  }

  function mutations() {
    return mutationCalls(requestMock);
  }

  describe("the menu is gone", () => {
    it.each(["OPEN", "CLOSED", "CANCELLED", "DELETED"] as const)(
      "shows no Acties control for a %s Trip",
      async (status) => {
        await showTrip({ status });

        expect(
          screen.queryByRole("button", { name: /Acties/ }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      },
    );

    /** Removed, not emptied: no leftover container sits in the column. */
    it("leaves no empty menu behind", async () => {
      await showTrip();

      expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    });

    /** The controls that were never lifecycle actions are still one click away. */
    it("keeps the PDF, group and custom-value controls", async () => {
      await showTrip({ tripGroupId: "97777777-7777-4777-8777-777777777777" });

      expect(
        screen.getByRole("button", { name: "PDF bekijken ANRDUB2602247" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "PDF downloaden ANRDUB2602247" }),
      ).toBeEnabled();
      expect(screen.getByText("G-9777")).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Custom waarden beheren ANRDUB2602247",
        }),
      ).toBeInTheDocument();
    });
  });

  /**
   * The action matrix, exhaustively.
   *
   * Listed per status rather than probed one item at a time, because the way
   * this breaks is an action nobody asserted the ABSENCE of — a button that can
   * only ever be refused.
   */
  describe("which action a status gets", () => {
    it("offers Afwerken on an OPEN Trip", async () => {
      await showTrip({ status: "OPEN" });

      expect(actionButton("Afwerken")).toBeInTheDocument();
      expect(actionButton("Openen")).toBeNull();
    });

    it("offers Openen on a CANCELLED Trip", async () => {
      await showTrip({ status: "CANCELLED" });

      expect(actionButton("Openen")).toBeInTheDocument();
      expect(actionButton("Afwerken")).toBeNull();
    });

    /**
     * CLOSED is terminal: `ALLOWED_TRANSITIONS[CLOSED]` is empty in the
     * backend's `trip-status.rules.ts`, and the model states "CLOSED → OPEN is
     * not allowed" outright. A "Heropenen" button here could only ever fail, so
     * there is none.
     */
    it("offers no lifecycle action on a CLOSED Trip", async () => {
      await showTrip({ status: "CLOSED" });

      expect(actionButton("Afwerken")).toBeNull();
      expect(actionButton("Openen")).toBeNull();
      expect(actionButton("Heropenen")).toBeNull();
    });

    it("offers no lifecycle action on a DELETED Trip", async () => {
      await showTrip({ status: "DELETED" });

      expect(actionButton("Afwerken")).toBeNull();
      expect(actionButton("Openen")).toBeNull();
    });

    /**
     * Cancelling is the one transition an operator would regret. It is not
     * routine, it keeps its confirmation, and it lives on the Trip detail page
     * rather than one stray click away in every row.
     */
    it("never offers cancelling from a row", async () => {
      await showTrip({ status: "OPEN" });

      expect(actionButton("Annuleren")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Annuleren/ }),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * LOSRIT is a classification, not a state — so it changes nothing here. Every
   * combination gets exactly the action its STATUS gets.
   */
  describe("LOSRIT does not alter the matrix", () => {
    const CASES: ReadonlyArray<[TripStatus, string | null]> = [
      ["OPEN", "Afwerken"],
      ["CLOSED", null],
      ["CANCELLED", "Openen"],
    ];

    it.each(CASES)("a LOSRIT that is %s", async (status, expected) => {
      await showTrip({ status, isLooseTrip: true });

      expect(screen.getByText("LOSRIT")).toBeInTheDocument();

      if (expected === null) {
        expect(actionButton("Afwerken")).toBeNull();
        expect(actionButton("Openen")).toBeNull();
      } else {
        expect(actionButton(expected)).toBeInTheDocument();
      }
    });

    it.each(CASES)("an ordinary Trip that is %s", async (status, expected) => {
      await showTrip({ status, isLooseTrip: false });

      expect(screen.queryByText("LOSRIT")).toBeNull();

      if (expected === null) {
        expect(actionButton("Afwerken")).toBeNull();
      } else {
        expect(actionButton(expected)).toBeInTheDocument();
      }
    });

    /** The lifecycle badge is still there, and still says the status. */
    it("shows the LOSRIT marker beside the status, not instead of it", async () => {
      await showTrip({ status: "CANCELLED", isLooseTrip: true });

      // Inside the row: "Geannuleerd" is also a status counter above the table.
      const row = screen.getByRole("table");

      expect(within(row).getByText("Geannuleerd")).toBeInTheDocument();
      expect(within(row).getByText("LOSRIT")).toBeInTheDocument();
    });
  });

  describe("Afwerken", () => {
    it("closes the Trip and refetches the list", async () => {
      await showTrip();
      const listsBefore = listCalls(requestMock).length;

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/status",
          expect.objectContaining({
            method: "PATCH",
            body: { status: "CLOSED" },
          }),
        );
      });
      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(listsBefore);
      });
      expect(await screen.findByText("Status gewijzigd")).toBeInTheDocument();
    });

    /**
     * Nothing is asked. Completing is routine, the row says so a moment later,
     * and a dialog in front of a routine action is one people learn to dismiss
     * unread — which then dismisses the dialogs that matter.
     */
    it("asks nothing at all", async () => {
      await showTrip();

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      await waitFor(() => expect(mutations()).toHaveLength(1));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("sends one request, not one per anything", async () => {
      await showTrip();

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      await waitFor(() => expect(mutations()).toHaveLength(1));
    });

    it("reports a refusal in the backend's own words", async () => {
      await showTrip();

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "A Trip cannot move from CLOSED to OPEN.", 409),
      );

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      expect(
        await screen.findByText(/A Trip cannot move from CLOSED/),
      ).toBeInTheDocument();
      expect(await screen.findByText("Actie mislukt")).toBeInTheDocument();
    });
  });

  describe("Openen", () => {
    it("reopens a CANCELLED Trip", async () => {
      await showTrip({ status: "CANCELLED" });

      await userEvent.click(actionButton("Openen") as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/status",
          expect.objectContaining({
            method: "PATCH",
            body: { status: "OPEN" },
          }),
        );
      });
      expect(await screen.findByText("Status gewijzigd")).toBeInTheDocument();
    });

    /** The undo of a cancellation needs no ceremony either. */
    it("asks nothing", async () => {
      await showTrip({ status: "CANCELLED" });

      await userEvent.click(actionButton("Openen") as HTMLElement);

      await waitFor(() => expect(mutations()).toHaveLength(1));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    /** Reopening prices nothing: pricing runs at closing, and only there. */
    it("triggers no pricing", async () => {
      await showTrip({ status: "CANCELLED" });

      await userEvent.click(actionButton("Openen") as HTMLElement);

      await waitFor(() => expect(mutations()).toHaveLength(1));
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/trip-pricing/"),
        ),
      ).toHaveLength(0);
    });

    it("reports a refusal rather than assuming it worked", async () => {
      await showTrip({ status: "CANCELLED" });

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Booking number is already used.", 409),
      );

      await userEvent.click(actionButton("Openen") as HTMLElement);

      expect(
        await screen.findByText(/Booking number is already used/),
      ).toBeInTheDocument();
    });
  });

  /**
   * ── COMPLETING A TRIP WITH NO PRICE ───────────────────────────────────────
   * A Trip whose route is not configured is legitimately finished work. Closing
   * it used to be followed by a warning that read as a failure of the
   * completion, and it never was one.
   *
   * The absence of a price stays visible where prices are — the pricing cells
   * are empty — but nothing is said at the moment somebody ticks a Trip off.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("closing without a price", () => {
    it("closes without warning about the missing price", async () => {
      await showTrip({}, { pricing: null });

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/status",
          expect.objectContaining({ body: { status: "CLOSED" } }),
        );
      });
      expect(screen.queryByText(/geen prijsberekening/)).toBeNull();
      expect(await screen.findByText("Status gewijzigd")).toBeInTheDocument();
    });

    /** And it asks the backend nothing extra to find that out. */
    it("does not read the pricing of the Trip it just closed", async () => {
      await showTrip({}, { pricing: null });

      await userEvent.click(actionButton("Afwerken") as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/status",
          expect.objectContaining({ body: { status: "CLOSED" } }),
        );
      });
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/trip-pricing/trip/"),
        ),
      ).toHaveLength(0);
    });
  });

  describe("Details bewerken", () => {
    /**
     * The three editable fields with no column — distance, execution time and
     * internal notes — kept their dialog when the menu that opened it went.
     */
    it("opens the fields that have no column", async () => {
      await showTrip();

      await userEvent.click(
        screen.getByRole("button", { name: "Details bewerken ANRDUB2602247" }),
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Afstand in km")).toBeInTheDocument();
    });

    /** A DELETED Trip is read-only until it is restored. */
    it("is not offered for a DELETED Trip", async () => {
      await showTrip({ status: "DELETED" });

      expect(
        screen.queryByRole("button", { name: /Details bewerken/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("after a mutation", () => {
    it("keeps the view, the period and the filters", async () => {
      await showTrip();

      await userEvent.click(screen.getByRole("radio", { name: "Week" }));
      await userEvent.type(screen.getByLabelText("Zoeken"), "psa");
      await waitFor(() => {
        expect(
          listCalls(requestMock)[listCalls(requestMock).length - 1].search,
        ).toBe("psa");
      });

      await userEvent.click(
        screen.getAllByRole("button", { name: "Afwerken ANRDUB2602247" })[0],
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

    /** Unlinking moved here from the menu — beside the leg it removes. */
    it("offers unlinking beside each leg", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [
          buildTrip({ id: "a", tripGroupId: GROUP_ID }),
          buildTrip({ id: "b", tripGroupId: GROUP_ID }),
        ],
      });
      renderRitten();

      await userEvent.click(await screen.findByText("G-9777"));
      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getAllByRole("button", {
          name: "Loskoppelen van groep",
        }),
      ).toHaveLength(2);
    });
  });

  describe("presentation", () => {
    it("translates the actions", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip();

      expect(
        screen.getByRole("button", { name: "Tamamla ANRDUB2602247" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /İşlemler/ }),
      ).not.toBeInTheDocument();
    });

    it("translates Openen", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip({ status: "CANCELLED" });

      expect(
        screen.getByRole("button", { name: "Aç ANRDUB2602247" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await showTrip({ isLooseTrip: true });

        const action = actionButton("Afwerken") as HTMLElement;
        const losrit = screen.getByText("LOSRIT");

        expect(action.className).toMatch(/text-primary/);
        expect(action.className).not.toMatch(/#[0-9a-f]{3,8}/i);
        // No lifecycle fill on a marker that is not a state.
        expect(losrit.className).not.toMatch(/bg-(success|danger|info)/);
      },
    );
  });
});
