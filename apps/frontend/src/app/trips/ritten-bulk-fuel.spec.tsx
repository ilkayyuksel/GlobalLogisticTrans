import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildPricing,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";
import type { BulkReprocessResult, Paginated, Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-25",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const FUEL = "/api/v1/trip-pricing/fuel-recalculations";
const REPRICE = "/api/v1/trip-pricing/reprocessions";

/**
 * "Brandstof herberekenen" for a selection, and the percentage each Trip's
 * Brandstof shows. Nothing here calculates: the backend recalculates and the
 * refetched rows show what it stored.
 */
describe("Brandstof herberekenen for the selection", () => {
  const CLOSED_A = buildTrip({
    id: "trip-a",
    bookingNumber: "ANRDUB2602247",
    status: "CLOSED",
    pricing: buildPricing({ tarief: "200.00", brandstof: "26.00", fuelPercentage: "13" }),
  });
  const CLOSED_B = buildTrip({
    id: "trip-b",
    bookingNumber: "ANRBEL2603249",
    status: "CLOSED",
    // A calculation from before the percentage was recorded.
    pricing: buildPricing({ tarief: "120.00", brandstof: "18.00", fuelPercentage: null }),
  });
  const OPEN = buildTrip({ id: "trip-open", bookingNumber: "ANRDUB2765105", status: "OPEN" });

  let responses: { trips: Paginated<Trip> };
  let answer: () => Promise<BulkReprocessResult>;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    responses = { trips: buildPage([CLOSED_A, CLOSED_B, OPEN]) };
    answer = () => Promise.resolve({ reprocessedCount: 2, skippedCount: 0, failedCount: 0, results: [] });

    respondWith(requestMock, responses);
    const backend = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((...args: Parameters<typeof request>) =>
      args[0] === FUEL ? answer() : backend(...args),
    );
  });

  async function show({ withPrices = false } = {}): Promise<void> {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    if (withPrices) {
      await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));
    }
  }

  async function select(...bookings: string[]): Promise<void> {
    for (const booking of bookings) {
      await userEvent.click(screen.getByRole("checkbox", { name: `Selecteer rit ${booking}` }));
    }
  }

  const fuelButton = () => screen.getByRole("button", { name: /Brandstof herberekenen|Bezig met brandstof/ });
  const repriceButton = () => screen.getByRole("button", { name: /Prijs herberekenen|Bezig met herberekenen/ });
  const callsTo = (path: string) => mutationCalls(requestMock).filter(([called]) => called === path);
  const rowOf = (booking: string) => screen.getByText(booking).closest("tr") as HTMLElement;

  it("is offered beside Prijs herberekenen once a finished Trip is selected", async () => {
    await show();
    await select("ANRDUB2602247");

    expect(fuelButton()).toBeEnabled();
    expect(repriceButton()).toBeEnabled();
  });

  it("is disabled when the selection holds no finished Trip", async () => {
    await show();
    await select("ANRDUB2765105");

    expect(fuelButton()).toBeDisabled();
  });

  it("sends every selected Trip in ONE request to its own endpoint, never the full reprice", async () => {
    await show();
    await select("ANRDUB2602247", "ANRBEL2603249");

    await userEvent.click(fuelButton());

    await waitFor(() => expect(callsTo(FUEL)).toHaveLength(1));
    expect(callsTo(FUEL)[0][1]).toMatchObject({ method: "POST", body: { tripIds: ["trip-a", "trip-b"] } });
    expect(callsTo(REPRICE)).toHaveLength(0);
  });

  it("summarises the result and names every Trip not done, and why", async () => {
    answer = () =>
      Promise.resolve({
        reprocessedCount: 1,
        skippedCount: 2,
        failedCount: 0,
        results: [
          { tripId: "trip-a", outcome: "REPROCESSED", reasonCode: null, message: null, snapshot: null },
          { tripId: "trip-b", outcome: "SKIPPED", reasonCode: "NOT_PRICED", message: "no price", snapshot: null },
          { tripId: "trip-open", outcome: "SKIPPED", reasonCode: "NOT_CLOSED", message: "not closed", snapshot: null },
        ],
      });
    await show();
    await select("ANRDUB2602247", "ANRBEL2603249", "ANRDUB2765105");

    await userEvent.click(fuelButton());

    await screen.findByText(/Brandstof herberekend: 1 herberekend, 2 overgeslagen, 0 mislukt/);
    const summary = screen.getByRole("status");
    expect(summary).toHaveTextContent("ANRBEL2603249: nog geen prijs, overgeslagen");
    expect(summary).toHaveTextContent("ANRDUB2765105: niet afgewerkt, overgeslagen");
  });

  it("refetches the list: the row shows the new Brandstof and its stored percentage", async () => {
    await show({ withPrices: true });
    await select("ANRDUB2602247");
    responses.trips = buildPage([
      { ...CLOSED_A, pricing: buildPricing({ tarief: "200.00", brandstof: "30.00", fuelPercentage: "15" }) },
      CLOSED_B,
      OPEN,
    ]);

    await userEvent.click(fuelButton());

    await waitFor(() => expect(rowOf("ANRDUB2602247")).toHaveTextContent("30.00(15%)"));
  });

  it("cannot run while either selection action runs", async () => {
    let finish: (result: BulkReprocessResult) => void = () => undefined;
    answer = () => new Promise((resolve) => (finish = resolve));
    await show();
    await select("ANRDUB2602247");

    await userEvent.click(fuelButton());

    expect(await screen.findByRole("button", { name: "Bezig met brandstof…" })).toBeDisabled();
    expect(repriceButton()).toBeDisabled();
    await userEvent.click(fuelButton());
    expect(callsTo(FUEL)).toHaveLength(1);

    finish({ reprocessedCount: 1, skippedCount: 0, failedCount: 0, results: [] });
    expect(await screen.findByText(/Brandstof herberekend: 1 herberekend/)).toBeInTheDocument();
  });

  it("reports a failed request without claiming any result", async () => {
    answer = () => Promise.reject(new ApiError("INTERNAL", "Service unavailable", 503));
    await show({ withPrices: true });
    await select("ANRDUB2602247");

    await userEvent.click(fuelButton());

    expect(await screen.findByText(/Brandstof herberekenen is niet gelukt/)).toBeInTheDocument();
    expect(rowOf("ANRDUB2602247")).toHaveTextContent("26.00(13%)");
  });

  describe("the percentage beside Brandstof", () => {
    it("shows the percentage the Trip's fuel was calculated with", async () => {
      await show({ withPrices: true });

      expect(within(rowOf("ANRDUB2602247")).getByText("(13%)")).toHaveAttribute(
        "title",
        "Percentage waarmee deze brandstof berekend werd",
      );
    });

    it("shows none for an older calculation that recorded none — never a guess", async () => {
      await show({ withPrices: true });

      expect(rowOf("ANRBEL2603249")).toHaveTextContent("18.00");
      expect(rowOf("ANRBEL2603249").textContent).not.toMatch(/%/);
    });
  });
});
