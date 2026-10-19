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

function unpaidCalls() {
  return mutationCalls(requestMock).filter(([path]) => String(path) === "/api/v1/trips/unpaid");
}

function unpaidIds(): string[] | undefined {
  return (unpaidCalls()[0]?.[1] as { body?: { tripIds?: string[] } } | undefined)?.body?.tripIds;
}

/**
 * Marking a selection NOT PAID — an operator's explicit correction.
 *
 * Unlike LOSRIT it asks first, and says how many Trips it will change — and how
 * many of them are not on screen, because a selection may reach other days.
 * Exactly the ticked ids go to the backend, which changes all of them or none.
 */
describe("marking a selection as not paid", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showTrips(trips: Trip[]): Promise<void> {
    respondWith(requestMock, { trips: buildPage(trips) });
    renderRitten();
    await screen.findByRole("table");
  }

  const actionButton = () => screen.queryByRole("button", { name: "Geselecteerde ritten op onbetaald zetten" });
  const dialog = () => screen.getByRole("dialog");
  const rowCheckbox = (booking: string) => screen.getByRole("checkbox", { name: `Selecteer rit ${booking}` });

  async function confirm(): Promise<void> {
    await userEvent.click(within(dialog()).getByRole("button", { name: "Op onbetaald zetten" }));
  }

  const TRIP_A = buildTrip({ id: "trip-a", bookingNumber: "ANRDUB2600010", isPaid: true });
  const TRIP_B = buildTrip({ id: "trip-b", bookingNumber: "ANRDUB2600020", isPaid: true });
  const TRIP_C = buildTrip({ id: "trip-c", bookingNumber: "ANRDUB2600030", isPaid: true });

  it("offers nothing, and changes nothing, while nothing is selected", async () => {
    await showTrips([TRIP_A]);

    expect(actionButton()).toBeNull();
    expect(unpaidCalls()).toHaveLength(0);
  });

  it("marks one selected Trip not paid, after saying how many", async () => {
    await showTrips([TRIP_A, TRIP_B]);
    await userEvent.click(rowCheckbox("ANRDUB2600010"));
    await userEvent.click(actionButton() as HTMLElement);

    expect(dialog()).toHaveTextContent("1 ritten worden op onbetaald gezet.");

    await confirm();

    await waitFor(() => expect(unpaidIds()).toEqual(["trip-a"]));
    expect(await screen.findByText(/Op onbetaald gezet/, { selector: "[role=status], [role=status] *" })).toBeInTheDocument();
    // The selection is cleared once it worked.
    expect(actionButton()).toBeNull();
  });

  it("sends only the ticked Trips, never their unticked neighbours", async () => {
    await showTrips([TRIP_A, TRIP_B, TRIP_C]);
    await userEvent.click(rowCheckbox("ANRDUB2600010"));
    await userEvent.click(rowCheckbox("ANRDUB2600030"));
    await userEvent.click(actionButton() as HTMLElement);

    expect(dialog()).toHaveTextContent("2 ritten worden op onbetaald gezet.");

    await confirm();

    await waitFor(() => expect(unpaidIds()).toEqual(["trip-a", "trip-c"]));
    expect(unpaidCalls()).toHaveLength(1);
  });

  it("ticks and unticks every row of the table from its header", async () => {
    await showTrips([TRIP_A, TRIP_B]);
    const all = screen.getByRole("checkbox", { name: "Alle ritten in deze tabel selecteren" });

    await userEvent.click(all);

    expect(rowCheckbox("ANRDUB2600010")).toBeChecked();
    expect(rowCheckbox("ANRDUB2600020")).toBeChecked();
    expect(screen.getByText(/^2 geselecteerd/)).toBeInTheDocument();

    await userEvent.click(all);

    expect(rowCheckbox("ANRDUB2600010")).not.toBeChecked();
    expect(actionButton()).toBeNull();
  });

  it("changes nothing when the confirmation is cancelled", async () => {
    await showTrips([TRIP_A]);
    await userEvent.click(rowCheckbox("ANRDUB2600010"));
    await userEvent.click(actionButton() as HTMLElement);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Annuleren" }));

    expect(unpaidCalls()).toHaveLength(0);
    expect(rowCheckbox("ANRDUB2600010")).toBeChecked();
  });

  it("shows the backend's reason when it refuses, and keeps the selection", async () => {
    await showTrips([TRIP_A]);
    const answer = requestMock.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;

    requestMock.mockImplementation((...args: unknown[]) =>
      String(args[0]) === "/api/v1/trips/unpaid"
        ? Promise.reject(new ApiError("NOT_FOUND", "Rit trip-a bestaat niet.", 404))
        : answer(...args),
    );

    await userEvent.click(rowCheckbox("ANRDUB2600010"));
    await userEvent.click(actionButton() as HTMLElement);
    await confirm();

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Rit trip-a bestaat niet.");
    expect(screen.queryByText("Op onbetaald gezet", { selector: "p" })).toBeNull();
    expect(rowCheckbox("ANRDUB2600010")).toBeChecked();
  });

  /** A selection reaches other days: the dialog says so, and only the ticked ones go. */
  it("says how many selected Trips are not on screen, and sends exactly those ticked", async () => {
    showDays();
    await goToDay(MONDAY);
    await tickTheRow();
    await goToDay(TUESDAY);
    await tickTheRow();
    await userEvent.click(actionButton() as HTMLElement);

    expect(dialog()).toHaveTextContent("2 ritten worden op onbetaald gezet.");
    expect(dialog()).toHaveTextContent("1 daarvan staan niet in de huidige weergave");

    await confirm();

    await waitFor(() => expect(unpaidIds()?.sort()).toEqual(["trip-monday", "trip-tuesday"]));
  });
});
