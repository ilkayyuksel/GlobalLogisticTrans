import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildPricing,
  buildTrip,
  listCalls,
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

const BULK = "/api/v1/trip-pricing/reprocessions";

/**
 * "Prijs herberekenen" for a selection.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   1. ONE request with every selected id; the backend decides what qualifies;
 *   2. a summary that says how many were done, skipped and failed — and names
 *      every Trip not done, and why;
 *   3. the list is refetched, so the rows show the price the backend stored;
 *   4. it cannot run twice at once, and a failed request claims nothing.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("Prijs herberekenen for the selection", () => {
  const CLOSED_A = buildTrip({
    id: "trip-a",
    bookingNumber: "ANRDUB2602247",
    status: "CLOSED",
    pricing: buildPricing({ tarief: "100.00" }),
  });
  const CLOSED_B = buildTrip({
    id: "trip-b",
    bookingNumber: "ANRBEL2603249",
    status: "CLOSED",
    pricing: buildPricing({ tarief: "120.00" }),
  });
  const OPEN = buildTrip({ id: "trip-open", bookingNumber: "ANRDUB2765105", status: "OPEN" });

  let responses: { trips: Paginated<Trip> };
  let answer: () => Promise<BulkReprocessResult>;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    responses = { trips: buildPage([CLOSED_A, CLOSED_B, OPEN]) };
    answer = () =>
      Promise.resolve({ reprocessedCount: 2, skippedCount: 0, failedCount: 0, results: [] });

    respondWith(requestMock, responses);
    const backend = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((...args: Parameters<typeof request>) =>
      args[0] === BULK ? answer() : backend(...args),
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

  const repriceButton = () => screen.getByRole("button", { name: /Prijs herberekenen|Bezig met herberekenen/ });
  const bulkCalls = () => mutationCalls(requestMock).filter(([path]) => path === BULK);
  const rowOf = (booking: string) => screen.getByText(booking).closest("tr") as HTMLElement;

  it("is offered next to Afwerken once a finished Trip is selected", async () => {
    await show();
    await select("ANRDUB2602247");

    expect(repriceButton()).toBeEnabled();
  });

  it("is disabled when the selection holds no finished Trip", async () => {
    await show();
    await select("ANRDUB2765105");

    expect(repriceButton()).toBeDisabled();
  });

  it("sends every selected Trip in ONE request and leaves the choice to the backend", async () => {
    await show();
    await select("ANRDUB2602247", "ANRBEL2603249", "ANRDUB2765105");

    await userEvent.click(repriceButton());

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({
      method: "POST",
      body: { tripIds: ["trip-a", "trip-b", "trip-open"] },
    });
  });

  it("summarises the result and names every Trip not done, and why", async () => {
    answer = () =>
      Promise.resolve({
        reprocessedCount: 1,
        skippedCount: 1,
        failedCount: 1,
        results: [
          { tripId: "trip-a", outcome: "REPROCESSED", reasonCode: null, message: null, snapshot: null },
          { tripId: "trip-open", outcome: "SKIPPED", reasonCode: "NOT_CLOSED", message: "not closed", snapshot: null },
          {
            tripId: "trip-b",
            outcome: "FAILED",
            reasonCode: "PRICING_MISSING_SETTING",
            message: "Setting PRICING.FUEL_PERCENTAGE is missing.",
            snapshot: null,
          },
        ],
      });
    await show();
    await select("ANRDUB2602247", "ANRBEL2603249", "ANRDUB2765105");

    await userEvent.click(repriceButton());

    await screen.findByText(/Prijs herberekend: 1 herberekend, 1 overgeslagen, 1 mislukt/);
    const summary = screen.getByRole("status");
    expect(summary).toHaveTextContent("ANRDUB2765105: niet afgewerkt, overgeslagen");
    expect(summary).toHaveTextContent(
      "ANRBEL2603249: mislukt (Setting PRICING.FUEL_PERCENTAGE is missing.)",
    );
    expect(summary).not.toHaveTextContent("ANRDUB2602247:");
  });

  it("refetches the list, so the rows show the price the backend stored", async () => {
    await show({ withPrices: true });
    await select("ANRDUB2602247");
    const listsBefore = listCalls(requestMock).length;
    responses.trips = buildPage([
      { ...CLOSED_A, pricing: buildPricing({ tarief: "300.00" }) },
      CLOSED_B,
      OPEN,
    ]);

    await userEvent.click(repriceButton());

    await waitFor(() => expect(rowOf("ANRDUB2602247")).toHaveTextContent("300.00"));
    expect(listCalls(requestMock).length).toBeGreaterThan(listsBefore);
    expect(screen.queryByRole("checkbox", { name: "Selecteer rit ANRDUB2602247", checked: true })).toBeNull();
  });

  it("cannot be started twice while it runs", async () => {
    let finish: (result: BulkReprocessResult) => void = () => undefined;
    answer = () => new Promise((resolve) => (finish = resolve));
    await show();
    await select("ANRDUB2602247");

    await userEvent.click(repriceButton());

    expect(await screen.findByRole("button", { name: "Bezig met herberekenen…" })).toBeDisabled();
    await userEvent.click(repriceButton());
    expect(bulkCalls()).toHaveLength(1);

    finish({ reprocessedCount: 1, skippedCount: 0, failedCount: 0, results: [] });
    expect(await screen.findByText(/1 herberekend/)).toBeInTheDocument();
  });

  it("reports a failed request without claiming any result", async () => {
    answer = () => Promise.reject(new ApiError("INTERNAL", "Service unavailable", 503));
    await show({ withPrices: true });
    await select("ANRDUB2602247");

    await userEvent.click(repriceButton());

    expect(await screen.findByText(/Herberekenen is niet gelukt/)).toBeInTheDocument();
    expect(screen.queryByText(/herberekend,/)).toBeNull();
    // The old price is still the stored one, shown as it was.
    expect(rowOf("ANRDUB2602247")).toHaveTextContent("100.00");
  });
});
