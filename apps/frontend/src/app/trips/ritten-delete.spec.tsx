import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";
import type { Trip, TripStatus } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-24",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Deleting one Trip from the list.
 *
 * ── THE ONE ROW ACTION THAT ASKS ────────────────────────────────────────────
 * Completing and reopening are routine and visible in the row a moment later,
 * so they ask nothing. Deleting takes a transport out of the planning, and an
 * operator who did it by accident will not see it in the list to put it back —
 * so it opens the application's own dialog. NOT `window.confirm`: that cannot
 * name the Trip, cannot mark one button destructive, and looks like every other
 * browser dialog people have learned to click through.
 *
 * ── SOFT, AND BY ID ─────────────────────────────────────────────────────────
 * The backend sets a status and writes nothing else: the row, its documents,
 * its history and any Cost Confirmation all stay. And it is addressed by
 * `Trip.id`, never by booking number — several Trips legitimately share one, so
 * deleting by booking would take an unrelated transport with it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";

function deleteCalls() {
  return mutationCalls(requestMock).filter(([path]) =>
    String(path).includes("/deletion"),
  );
}

async function showTrip(overrides: Partial<Trip> = {}): Promise<void> {
  respondWith(requestMock, { trips: buildPage([buildTrip(overrides)]) });
  renderRitten();
  await screen.findByRole("table");
}

function deleteButton() {
  return screen.queryByRole("button", { name: "Verwijderen ANRDUB2602247" });
}

async function openConfirmation(): Promise<HTMLElement> {
  await userEvent.click(deleteButton() as HTMLElement);

  return screen.findByRole("dialog");
}

describe("deleting a Trip from the Ritten list", () => {
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

  /**
   * The backend deletes from OPEN and from CANCELLED. A button on any other
   * status could only ever return a 409.
   *
   * Restore still returns every Trip to OPEN, so a Trip deleted while cancelled
   * comes back open — an administrator recovering a record, not an undo of the
   * cancellation.
   */
  describe("where it is offered", () => {
    it("appears on an OPEN Trip, beside Afwerken", async () => {
      await showTrip({ status: "OPEN" });

      expect(
        screen.getByRole("button", { name: "Afwerken ANRDUB2602247" }),
      ).toBeInTheDocument();
      expect(deleteButton()).toBeEnabled();
    });

    /**
     * Directly, without reopening first: CANCELLED → OPEN → DELETED moved the
     * Trip through a state it was never in on the way past.
     */
    it("is offered on a CANCELLED Trip, beside Openen", async () => {
      await showTrip({ status: "CANCELLED" });

      expect(
        screen.getByRole("button", { name: "Openen ANRDUB2602247" }),
      ).toBeInTheDocument();
      expect(deleteButton()).toBeEnabled();
    });

    it("is not offered on a CLOSED Trip", async () => {
      await showTrip({ status: "CLOSED" });

      expect(deleteButton()).toBeNull();
    });

    it("is not offered on a DELETED Trip", async () => {
      await showTrip({ status: "DELETED" });

      expect(deleteButton()).toBeNull();
    });

    /** And the dropdown stays gone. */
    it.each(["OPEN", "CLOSED", "CANCELLED", "DELETED"] as const)(
      "adds no Acties menu for a %s Trip",
      async (status: TripStatus) => {
        await showTrip({ status });

        expect(
          screen.queryByRole("button", { name: /Acties/ }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      },
    );
  });

  describe("the confirmation", () => {
    it("opens the application's own dialog", async () => {
      await showTrip();

      expect(await openConfirmation()).toBeInTheDocument();
    });

    it("never uses the browser's confirmation", async () => {
      await showTrip();

      await openConfirmation();

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("says which Trip it is about", async () => {
      await showTrip();

      const dialog = await openConfirmation();

      expect(
        within(dialog).getByText("ANRDUB2602247"),
      ).toBeInTheDocument();
    });

    it("says what deleting does", async () => {
      await showTrip();

      const dialog = await openConfirmation();

      expect(
        within(dialog).getByText(/wordt verwijderd uit de planning/),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(/documenten blijven bewaard/),
      ).toBeInTheDocument();
    });

    it("sends nothing until it is confirmed", async () => {
      await showTrip();

      await openConfirmation();

      expect(deleteCalls()).toHaveLength(0);
    });

    it("closes without deleting when it is cancelled", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Annuleren" }),
      );

      expect(deleteCalls()).toHaveLength(0);
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    /**
     * Backing out is the easy path. Focus lands on the dialog's own close
     * control, so Enter on an unread dialog dismisses it — what must never be
     * true is that the destructive button is the one waiting for a keystroke.
     */
    it("never focuses the destructive button", async () => {
      await showTrip();

      const dialog = await openConfirmation();

      expect(
        within(dialog).getByRole("button", { name: "Verwijderen" }),
      ).not.toHaveFocus();
      expect(document.activeElement?.textContent).not.toBe("Verwijderen");
    });

    /** And it is the second button, not the first one reached. */
    it("puts Annuleren before Verwijderen", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      const labels = within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent);

      expect(labels.indexOf("Annuleren")).toBeLessThan(
        labels.indexOf("Verwijderen"),
      );
    });

    it("keeps the Trip on screen after cancelling", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Annuleren" }),
      );

      expect(screen.getByText("ANRDUB2602247")).toBeInTheDocument();
    });
  });

  describe("confirming it", () => {
    async function confirmDelete(): Promise<void> {
      const dialog = await openConfirmation();
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Verwijderen" }),
      );
    }

    it("sends the soft delete for that Trip", async () => {
      await showTrip();
      await confirmDelete();

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1/deletion",
          expect.objectContaining({ method: "PATCH" }),
        );
      });
    });

    /** By id: several Trips legitimately share a booking number. */
    it("addresses it by Trip id, never by booking number", async () => {
      await showTrip();
      await confirmDelete();

      await waitFor(() => expect(deleteCalls()).toHaveLength(1));
      expect(String(deleteCalls()[0][0])).toBe("/api/v1/trips/trip-1/deletion");
      expect(String(deleteCalls()[0][0])).not.toContain("ANRDUB2602247");
    });

    it("sends one request", async () => {
      await showTrip();
      await confirmDelete();

      await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    });

    it("refetches the list rather than reloading the page", async () => {
      await showTrip();

      const before = requestMock.mock.calls.length;
      await confirmDelete();

      await waitFor(() => {
        expect(requestMock.mock.calls.length).toBeGreaterThan(before + 1);
      });
      expect(lastListCall(requestMock)).toBeDefined();
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    it("closes the dialog", async () => {
      await showTrip();
      await confirmDelete();

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("says it happened", async () => {
      await showTrip();
      await confirmDelete();

      expect(await screen.findByText("Rit verwijderd")).toBeInTheDocument();
    });

    /** A DELETED Trip is hidden from the list, so the refetch removes the row. */
    it("drops the row once the refetched list no longer has it", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      respondWith(requestMock, { trips: buildPage([]) });
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Verwijderen" }),
      );

      await waitFor(() => {
        expect(screen.queryByText("ANRDUB2602247")).toBeNull();
      });
    });

    it("keeps the dialog open and reports a refusal", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          'Trip "trip-1" is CLOSED and can only be deleted while OPEN.',
          409,
        ),
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Verwijderen" }),
      );

      expect(
        await screen.findByText(/can only be deleted while OPEN/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  /**
   * The persistent multi-day selection survives. Only the deleted Trip leaves
   * it — the other days the operator ticked are still theirs.
   */
  describe("the selection", () => {
    const MONDAY_TRIP = buildTrip({
      id: "trip-monday",
      bookingNumber: "ANRDUB2600001",
      planningDate: MONDAY,
      originalPlanningDate: MONDAY,
    });

    const TUESDAY_TRIP = buildTrip({
      id: "trip-tuesday",
      bookingNumber: "ANRDUB2600002",
      planningDate: TUESDAY,
      originalPlanningDate: TUESDAY,
    });

    function showDays(): void {
      respondWith(requestMock, {});

      requestMock.mockImplementation((...args: unknown[]) => {
        const [path, options] = args as [
          string,
          { query?: Record<string, unknown>; method?: string } | undefined,
        ];
        const query = options?.query ?? {};

        if ((options?.method ?? "GET") !== "GET") {
          return Promise.resolve({});
        }

        if (path === "/api/v1/trips" && query.pageSize !== 1) {
          const day = query.planningDate;

          return Promise.resolve(
            buildPage(
              day === MONDAY
                ? [MONDAY_TRIP]
                : day === TUESDAY
                  ? [TUESDAY_TRIP]
                  : [MONDAY_TRIP, TUESDAY_TRIP],
            ),
          );
        }

        if (path === "/api/v1/trips/terminals") {
          return Promise.resolve([]);
        }

        return Promise.resolve(buildPage([]));
      });

      renderRitten();
    }

    async function goToDay(date: string): Promise<void> {
      fireEvent.change(screen.getByLabelText("Kies een datum"), {
        target: { value: date },
      });

      await waitFor(() => {
        expect(lastListCall(requestMock).planningDate).toBe(date);
      });
    }

    async function tickTheRow(): Promise<void> {
      await userEvent.click(
        await screen.findByRole("checkbox", { name: /^Selecteer rit / }),
      );
    }

    it("removes only the deleted Trip from it", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();
      expect(screen.getByText("2 geselecteerd")).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwijderen ANRDUB2600002" }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Verwijderen",
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
      });
    });

    it("keeps the other day's Trip selected", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwijderen ANRDUB2600002" }),
      );
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Verwijderen",
        }),
      );

      await waitFor(() =>
        expect(screen.getByText("1 geselecteerd")).toBeInTheDocument(),
      );

      await goToDay(MONDAY);

      expect(
        await screen.findByRole("checkbox", { name: /^Selecteer rit / }),
      ).toBeChecked();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip();

      await userEvent.click(
        screen.getByRole("button", { name: "Sil ANRDUB2602247" }),
      );
      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByText("Bu sefer planlamadan kaldırılır."),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Sil" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Vazgeç" }),
      ).toBeInTheDocument();
    });

    /** Destructive, and never mistakable for the routine button beside it. */
    it.each(["light", "dark"])(
      "marks it as destructive in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await showTrip();

        const remove = deleteButton() as HTMLElement;
        const complete = screen.getByRole("button", {
          name: "Afwerken ANRDUB2602247",
        });

        expect(remove.className).toMatch(/danger/);
        expect(complete.className).not.toMatch(/danger/);
        expect(remove.className).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );

    it("marks the confirming button as destructive too", async () => {
      await showTrip();

      const dialog = await openConfirmation();
      const confirm = within(dialog).getByRole("button", {
        name: "Verwijderen",
      });

      expect(confirm.className).toMatch(/bg-danger/);
      expect(confirm.className).not.toMatch(/#[0-9a-f]{3,8}/i);
    });
  });
});
