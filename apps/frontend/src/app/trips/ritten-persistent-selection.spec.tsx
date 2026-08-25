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
import { request } from "@/lib/api/client";
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

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";

/**
 * A selection that survives the operator walking through the week.
 *
 * ── WHY THIS HAD TO CHANGE ──────────────────────────────────────────────────
 * The selection was cleared on every filter, period, page and view change. That
 * made the thing it exists for impossible: a Combination that runs over two
 * days — out on Monday, the empty back on Tuesday — cannot be ticked without
 * changing day in between, and changing day threw the first tick away.
 *
 * So selected ids live at the page level. Nothing clears them but the operator
 * and a completed action, and a Trip that is off screen stays selected — the
 * toolbar keeps saying how many, and the checkbox is still ticked when the
 * operator comes back to it.
 *
 * They are Trip IDS. Never booking numbers: two Trips legitimately share one
 * now, so a selection keyed by booking would tick a transport nobody chose.
 * ────────────────────────────────────────────────────────────────────────────
 */

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

/** The list answers with whatever day is being asked for. */
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
      const trips: Trip[] =
        day === MONDAY
          ? [MONDAY_TRIP]
          : day === TUESDAY
            ? [TUESDAY_TRIP]
            : [MONDAY_TRIP, TUESDAY_TRIP];

      return Promise.resolve(buildPage(trips));
    }

    if (path === "/api/v1/trips" && query.pageSize === 1) {
      return Promise.resolve(buildPage([], { totalItems: 0 }));
    }

    if (path === "/api/v1/trips/terminals") {
      return Promise.resolve([]);
    }

    return Promise.resolve(buildPage([]));
  });

  renderRitten();
}

async function goToDay(date: string, label = "Kies een datum"): Promise<void> {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value: date },
  });

  await waitFor(() => {
    expect(lastListCall(requestMock).planningDate).toBe(date);
  });
}

/** Ticks the one row on screen. */
async function tickTheRow(): Promise<void> {
  const checkbox = await screen.findByRole("checkbox", {
    name: /^Selecteer rit /,
  });

  await userEvent.click(checkbox);
}

describe("a selection that survives navigation", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("keeps Monday's Trip selected after moving to Tuesday", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();

    expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();

    await goToDay(TUESDAY);

    expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
  });

  it("adds Tuesday's Trip to it", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();
    await goToDay(TUESDAY);
    await tickTheRow();

    expect(screen.getByText("2 geselecteerd")).toBeInTheDocument();
  });

  it("still shows Monday's checkbox ticked when the operator returns", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();
    await goToDay(TUESDAY);
    await goToDay(MONDAY);

    expect(
      await screen.findByRole("checkbox", { name: /^Selecteer rit / }),
    ).toBeChecked();
  });

  it("removes only the Trip that is unticked", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();
    await goToDay(TUESDAY);
    await tickTheRow();
    expect(screen.getByText("2 geselecteerd")).toBeInTheDocument();

    await goToDay(MONDAY);
    await tickTheRow();

    expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
  });

  it("keeps the toolbar visible when nothing selected is on screen", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();

    await goToDay("2026-09-15");

    expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Selectie wissen" }),
    ).toBeInTheDocument();
  });

  it("clears only when the operator says so", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();

    await userEvent.click(
      screen.getByRole("button", { name: "Selectie wissen" }),
    );

    expect(screen.queryByText("1 geselecteerd")).toBeNull();
  });

  describe("across views and filters", () => {
    it("survives day to week and back", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();

      await userEvent.click(screen.getByRole("radio", { name: "Week" }));
      await waitFor(() => {
        expect(lastListCall(requestMock).planningDateFrom).toBeDefined();
      });
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));
      await userEvent.click(screen.getByRole("radio", { name: "Week" }));

      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });

    it("survives a status filter change", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();

      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
          "radio",
          { name: "Open" },
        ),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("OPEN");
      });
      expect(screen.getByText("1 geselecteerd")).toBeInTheDocument();
    });
  });

  /** Select-all adds to what is there; it never replaces another day's picks. */
  it("adds the visible rows to the selection rather than replacing it", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();

    await goToDay(TUESDAY);
    await screen.findByRole("checkbox", { name: /^Selecteer rit / });

    await userEvent.click(
      screen.getByRole("button", { name: "Selecteer alle zichtbare ritten" }),
    );

    await waitFor(() => {
      expect(screen.getByText("2 geselecteerd")).toBeInTheDocument();
    });
  });

  describe("what the actions send", () => {
    function bodyOf(path: string) {
      const call = mutationCalls(requestMock).find(([called]) => called === path);

      return (call?.[1] as { body?: { tripIds?: string[] } } | undefined)?.body;
    }

    it("groups both days' Trips, not just the visible one", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(
        screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Groeperen" }),
      );

      await waitFor(() => {
        expect(bodyOf("/api/v1/trip-groups")).toEqual({
          tripIds: ["trip-monday", "trip-tuesday"],
        });
      });
    });

    it("completes both days' Trips, not just the visible one", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(bodyOf("/api/v1/trips/completions")).toEqual({
          tripIds: ["trip-monday", "trip-tuesday"],
        });
      });
    });

    /** Identity is the Trip id — these two share a booking number. */
    it("selects by Trip id, never by booking number", async () => {
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);
      await tickTheRow();

      await userEvent.click(screen.getByRole("button", { name: "Afwerken" }));

      await waitFor(() => {
        expect(bodyOf("/api/v1/trips/completions")?.tripIds).toHaveLength(2);
      });
      expect(
        JSON.stringify(bodyOf("/api/v1/trips/completions")),
      ).not.toContain("ANRDUB2600001");
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      showDays();
      await goToDay(MONDAY, "Bir tarih seçin");

      await userEvent.click(
        await screen.findByRole("checkbox", { name: /^Seferi seç / }),
      );
      await goToDay(TUESDAY, "Bir tarih seçin");

      expect(screen.getByText("1 seçildi")).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      showDays();
      await goToDay(MONDAY);
      await tickTheRow();
      await goToDay(TUESDAY);

      const toolbar = screen.getByText("1 geselecteerd").closest(
        "div",
      ) as HTMLElement;

      expect(toolbar.className).toMatch(/border-primary/);
      expect(toolbar.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    });
  });
});
