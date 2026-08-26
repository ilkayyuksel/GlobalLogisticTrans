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

/**
 * The grouping confirmation, when the selection spans days.
 *
 * ── IT USED TO HIDE THE HALF THAT MATTERED ──────────────────────────────────
 * The dialog listed only the rows that happened to be on screen and said "1 of
 * the selected Trips is on a day that is not shown". That is precisely the Trip
 * an operator needs to check: nobody can confirm a group whose other half they
 * have never seen.
 *
 * It now FETCHES the selection by id — one request for all of them, whatever
 * days they fall on — and lists every one, read in the direction the containers
 * travel: DUB first, ANR second.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";

/** The outbound leg, planned for Monday. Its booking starts with DUB. */
const DUB_TRIP = buildTrip({
  id: "trip-dub",
  bookingNumber: "DUBANR2598395",
  containerNumber: "EUCU 453232/2",
  direction: "DELIVERY",
  planningDate: MONDAY,
  originalPlanningDate: MONDAY,
});

/** The empty coming back, planned for Tuesday. Its booking starts with ANR. */
const ANR_TRIP = buildTrip({
  id: "trip-anr",
  bookingNumber: "ANRBEL2603249",
  containerNumber: "PVDU 301326/0",
  direction: "COLLECTION",
  planningDate: TUESDAY,
  originalPlanningDate: TUESDAY,
});

/**
 * One day at a time, exactly as the operator sees it — and the selection
 * lookup, which asks by id and ignores the day entirely.
 */
function showDays(selected: Trip[] = [DUB_TRIP, ANR_TRIP]): void {
  respondWith(requestMock, {});

  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [
      string,
      { query?: Record<string, unknown>; method?: string } | undefined,
    ];
    const query = options?.query ?? {};

    if ((options?.method ?? "GET") !== "GET") {
      return Promise.resolve({ id: "group-1", tripCount: 2, trips: [] });
    }

    if (path === "/api/v1/trips" && query.tripIds) {
      const ids = query.tripIds as string[];

      return Promise.resolve(
        buildPage(selected.filter((trip) => ids.includes(trip.id))),
      );
    }

    if (path === "/api/v1/trips" && query.pageSize !== 1) {
      const day = query.planningDate;

      return Promise.resolve(
        buildPage(
          day === MONDAY ? [DUB_TRIP] : day === TUESDAY ? [ANR_TRIP] : [],
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

/** Selects the Monday Trip and the Tuesday one, then opens the dialog. */
async function selectAcrossDaysAndOpen(): Promise<HTMLElement> {
  await goToDay(MONDAY);
  await tickTheRow();
  await goToDay(TUESDAY);
  await tickTheRow();

  await userEvent.click(
    screen.getByRole("button", { name: "Groepeer geselecteerde ritten" }),
  );

  return screen.findByRole("dialog");
}

/**
 * The booking of each listed Trip, in the order they appear.
 *
 * Matched on the booking's own shape — three route letters, three more, seven
 * digits — because an item's text runs the date straight on after it.
 */
function bookingsIn(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole("listitem")
    .map(
      (item) => item.textContent?.match(/(?:DUB|ANR)[A-Z]{3}\d{7}/)?.[0] ?? "",
    );
}

describe("the grouping confirmation across days", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("what it shows", () => {
    it("lists BOTH selected Trips, not only the visible one", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      expect(
        await within(dialog).findByText("DUBANR2598395"),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("ANRBEL2603249")).toBeInTheDocument();
    });

    it("says nothing about hidden Trips, because none are hidden", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");

      expect(within(dialog).queryByText(/niet zichtbaar/)).toBeNull();
    });

    it("shows each Trip's own day", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");

      expect(within(dialog).getByText("24/08/2026")).toBeInTheDocument();
      expect(within(dialog).getByText("25/08/2026")).toBeInTheDocument();
    });

    /** Enough to tell one selected Trip from another, and no more. */
    it("shows the container and the direction", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");

      expect(within(dialog).getByText(/EUCU 453232\/2/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Leveren/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Ophalen/)).toBeInTheDocument();
    });

    it("counts the whole selection", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      expect(
        await within(dialog).findByText(/^2 /),
      ).toBeInTheDocument();
    });
  });

  describe("the order it reads in", () => {
    it("puts the DUB leg first and the ANR leg second", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");

      expect(bookingsIn(dialog)).toEqual(["DUBANR2598395", "ANRBEL2603249"]);
    });

    /** Even when the backend answers the other way round. */
    it("orders them however they arrive", async () => {
      showDays([ANR_TRIP, DUB_TRIP]);
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");

      expect(bookingsIn(dialog)).toEqual(["DUBANR2598395", "ANRBEL2603249"]);
    });
  });

  describe("how it asks for them", () => {
    /** ONE request for the whole selection, never one per Trip. */
    it("fetches the selection in a single request", async () => {
      showDays();
      await selectAcrossDaysAndOpen();

      await waitFor(() => {
        expect(
          requestMock.mock.calls.filter(
            ([, options]) =>
              (options as { query?: Record<string, unknown> } | undefined)
                ?.query?.tripIds !== undefined,
          ),
        ).toHaveLength(1);
      });
    });

    it("asks by id, for both days at once", async () => {
      showDays();
      await selectAcrossDaysAndOpen();

      await waitFor(() => {
        const call = requestMock.mock.calls.find(
          ([, options]) =>
            (options as { query?: Record<string, unknown> } | undefined)?.query
              ?.tripIds !== undefined,
        );
        const query = (call?.[1] as { query: Record<string, unknown> }).query;

        expect(query.tripIds).toEqual(["trip-dub", "trip-anr"]);
      });
    });

    /** No day filter: the selection is not narrowed to what is on screen. */
    it("sends no planning date with it", async () => {
      showDays();
      await selectAcrossDaysAndOpen();

      await waitFor(() => {
        const call = requestMock.mock.calls.find(
          ([, options]) =>
            (options as { query?: Record<string, unknown> } | undefined)?.query
              ?.tripIds !== undefined,
        );
        const query = (call?.[1] as { query: Record<string, unknown> }).query;

        expect(query.planningDate).toBeUndefined();
        expect(query.planningDateFrom).toBeUndefined();
      });
    });
  });

  /** The request that actually groups still carries both ids. */
  describe("what grouping sends", () => {
    it("groups both Trips", async () => {
      showDays();
      const dialog = await selectAcrossDaysAndOpen();

      await within(dialog).findByText("DUBANR2598395");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Groeperen" }),
      );

      await waitFor(() => {
        const call = mutationCalls(requestMock).find(
          ([path]) => String(path) === "/api/v1/trip-groups",
        );

        expect((call?.[1] as { body: { tripIds: string[] } }).body).toEqual({
          tripIds: ["trip-dub", "trip-anr"],
        });
      });
    });
  });
});
