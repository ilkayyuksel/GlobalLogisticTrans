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
import type { Trip } from "@/lib/api/types";

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
 * Marking a selection as LOSRIT.
 *
 * ── A CLASSIFICATION, NOT A LIFECYCLE ACTION ────────────────────────────────
 * It writes one column. So it asks nothing — no browser confirmation, no
 * dialog — prices nothing, and touches no document. The badge appearing on the
 * rows after the refetch is the entire confirmation, which is what makes doing
 * it without a dialog safe rather than careless.
 *
 * ── ONE REQUEST, THE WHOLE SELECTION ────────────────────────────────────────
 * Days and pages included, exactly as grouping and completion send it, and by
 * Trip id — two Trips may share a booking number. Whether the selection may be
 * classified is the BACKEND's answer: a leg of a Combination is not a loose
 * trip, and it refuses all of the selection or none of it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";

const MONDAY_TRIP = buildTrip({
  id: "trip-monday",
  bookingNumber: "ANRDUB2600001",
  planningDate: MONDAY,
  originalPlanningDate: MONDAY,
});

const TUESDAY_TRIP = buildTrip({
  id: "trip-tuesday",
  // The SAME booking number, a different container: two Trips, one booking.
  bookingNumber: "ANRDUB2600001",
  containerNumber: "PVDU 301326/0",
  planningDate: TUESDAY,
  originalPlanningDate: TUESDAY,
});

/** The list answers with whatever day is asked for. */
function showDays(): void {
  respondWith(requestMock, {});

  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [
      string,
      { query?: Record<string, unknown>; method?: string } | undefined,
    ];
    const query = options?.query ?? {};

    if ((options?.method ?? "GET") !== "GET") {
      return Promise.resolve([]);
    }

    if (path === "/api/v1/trips" && query.pageSize !== 1) {
      const day = query.planningDate;
      const trips: Trip[] =
        day === MONDAY
          ? [MONDAY_TRIP]
          : day === TUESDAY
            ? [TUESDAY_TRIP]
            : [MONDAY_TRIP, TUESDAY_TRIP];

      return Promise.resolve(buildPage(trips));
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

function looseCalls() {
  return mutationCalls(requestMock).filter(
    ([path]) => String(path) === "/api/v1/trips/loose",
  );
}

function looseBody(): { tripIds?: string[] } | undefined {
  return (looseCalls()[0]?.[1] as { body?: { tripIds?: string[] } } | undefined)
    ?.body;
}

describe("marking a selection as LOSRIT", () => {
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

  async function showOneTrip(overrides = {}): Promise<void> {
    respondWith(requestMock, { trips: buildPage([buildTrip(overrides)]) });
    renderRitten();
    await screen.findByRole("table");
  }

  async function selectTheRow(): Promise<void> {
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /^Selecteer rit / }),
    );
  }

  function losritButton() {
    return screen.queryByRole("button", { name: "Losrit" });
  }

  describe("the action", () => {
    it("is absent while nothing is selected", async () => {
      await showOneTrip();

      expect(losritButton()).toBeNull();
    });

    it("appears as soon as one Trip is selected", async () => {
      await showOneTrip();
      await selectTheRow();

      expect(losritButton()).toBeEnabled();
    });

    it("stands beside Groeperen and Afwerken", async () => {
      await showOneTrip();
      await selectTheRow();

      expect(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Afwerken" })).toBeInTheDocument();
      expect(losritButton()).toBeInTheDocument();
    });

    it("disappears again when the selection is cleared", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(
        screen.getByRole("button", { name: "Selectie wissen" }),
      );

      expect(losritButton()).toBeNull();
    });
  });

  describe("what it sends", () => {
    it("posts the selected ids to the bulk endpoint", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/loose",
          expect.objectContaining({
            method: "POST",
            body: { tripIds: ["trip-1"] },
          }),
        );
      });
    });

    it("sends one request, not one per Trip", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
    });

    /** Days the operator cannot currently see are still in the selection. */
    it("sends Trips selected on different days", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => {
        expect(looseBody()).toEqual({
          tripIds: ["trip-monday", "trip-tuesday"],
        });
      });
    });

    /** Identity is the Trip id — these two share a booking number. */
    it("identifies Trips by id, never by booking number", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseBody()?.tripIds).toHaveLength(2));
      expect(JSON.stringify(looseBody())).not.toContain("ANRDUB2600001");
    });

    /** The ids are the whole body: no boolean it could accidentally invert. */
    it("sends nothing but the ids", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseBody()).toBeDefined());
      expect(Object.keys(looseBody() as object)).toEqual(["tripIds"]);
    });
  });

  describe("what it does not do", () => {
    it("asks no browser confirmation", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("opens no dialog", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("reads and writes no pricing", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/trip-pricing/"),
        ),
      ).toHaveLength(0);
    });

    it("touches no document", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/pdf-documents"),
        ),
      ).toHaveLength(0);
    });

    it("changes no status", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => expect(looseCalls()).toHaveLength(1));
      expect(
        mutationCalls(requestMock).filter(([path]) =>
          String(path).includes("/status"),
        ),
      ).toHaveLength(0);
      expect(
        mutationCalls(requestMock).filter(
          ([path]) => String(path) === "/api/v1/trips/completions",
        ),
      ).toHaveLength(0);
    });
  });

  describe("afterwards", () => {
    it("clears the selection", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      await waitFor(() => {
        expect(screen.queryByText("1 geselecteerd")).toBeNull();
      });
    });

    it("says what happened", async () => {
      await showOneTrip();
      await selectTheRow();

      await userEvent.click(losritButton() as HTMLElement);

      expect(
        await screen.findByText("Als losrit gemarkeerd"),
      ).toBeInTheDocument();
    });

    /** The badge comes from the refetched rows, never painted optimistically. */
    it("shows the badge once the refetched rows carry it", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ isLooseTrip: false })]),
      });
      renderRitten();
      await screen.findByRole("table");
      await selectTheRow();

      respondWith(requestMock, {
        trips: buildPage([buildTrip({ isLooseTrip: true })]),
      });

      await userEvent.click(losritButton() as HTMLElement);

      expect(
        await within(await screen.findByRole("table")).findByText("LOSRIT"),
      ).toBeInTheDocument();
    });
  });

  /**
   * A leg of a Combination is not a loose trip. The backend decides that, for
   * the whole selection at once, and its refusal is shown as it worded it.
   */
  describe("when the selection contains a grouped Trip", () => {
    const REFUSAL =
      'Trip "trip-1" belongs to group "97777777-7777-4777-8777-777777777777" and cannot be marked as a loose trip. Remove it from the group first.';

    async function refuse(): Promise<void> {
      await showOneTrip({ tripGroupId: "97777777-7777-4777-8777-777777777777" });
      await selectTheRow();

      requestMock.mockRejectedValueOnce(new ApiError("CONFLICT", REFUSAL, 409));

      await userEvent.click(losritButton() as HTMLElement);
    }

    it("reports the refusal in the backend's own words", async () => {
      await refuse();

      expect(
        await screen.findByText(/cannot be marked as a loose trip/),
      ).toBeInTheDocument();
    });

    it("names the group that stopped it", async () => {
      await refuse();

      expect(
        await screen.findByText(/97777777-7777-4777-8777-777777777777/),
      ).toBeInTheDocument();
    });

    /** Nothing was applied, so the selection is still there to correct. */
    it("keeps the selection", async () => {
      await refuse();

      await screen.findByText(/cannot be marked as a loose trip/);
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });

    /** One attempt, refused. Nothing is retried and nothing else is written. */
    it("attempts it once and writes nothing else", async () => {
      await refuse();

      await screen.findByText(/cannot be marked as a loose trip/);
      expect(looseCalls()).toHaveLength(1);
      expect(mutationCalls(requestMock)).toHaveLength(1);
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showOneTrip();

      await userEvent.click(
        await screen.findByRole("checkbox", { name: /^Seferi seç / }),
      );

      expect(
        screen.getByRole("button", { name: "Tekil sefer" }),
      ).toBeInTheDocument();
    });

    it("reports success in Turkish", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showOneTrip();

      await userEvent.click(
        await screen.findByRole("checkbox", { name: /^Seferi seç / }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Tekil sefer" }),
      );

      expect(
        await screen.findByText("Tekil sefer olarak işaretlendi"),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await showOneTrip();
        await selectTheRow();

        const button = losritButton() as HTMLElement;

        // A classification is a quiet control, not the primary action.
        expect(button.className).toMatch(/bg-hover/);
        expect(button.className).not.toMatch(/bg-primary\b/);
        expect(button.className).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );
  });
});
