import { screen, waitFor, within } from "@testing-library/react";
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
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;
const REPRICE = "Prijs opnieuw berekenen";

/**
 * "Prijs opnieuw berekenen" on one row of the Ritten list.
 *
 * It goes through the backend's existing single-Trip reprocess — the route
 * matched again and the whole price calculated again, nothing else written —
 * so these tests are about what is SENT, what the row does while it runs and
 * what the operator is told. Nothing here matches or prices.
 */
describe("repricing one Trip from its row", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  /** The reprocess answers with `answer`; every other request as the support does. */
  async function showTrips(trips: Trip[], answer: () => Promise<unknown>) {
    respondWith(requestMock, { trips: buildPage(trips) });

    const support = requestMock.getMockImplementation()!;

    requestMock.mockImplementation((...args: Parameters<typeof request>) => {
      const [path, options] = args;

      return options?.method === "POST" && /\/trip-pricing\/trip\/[^/]+\/reprocess$/.test(path)
        ? (answer() as ReturnType<typeof request>)
        : support(...args);
    });

    renderRitten();
    await screen.findByRole("table");
  }

  const reprocessCalls = () =>
    mutationCalls(requestMock).filter(([path]) => path.endsWith("/reprocess"));
  const rowOf = (bookingNumber: string) =>
    screen.getByRole("link", { name: bookingNumber }).closest("tr") as HTMLElement;
  const repriceButton = (bookingNumber: string) =>
    within(rowOf(bookingNumber)).getByRole("button", { name: `${REPRICE} ${bookingNumber}` });

  const snapshot = (method: string) => ({
    pricing: {},
    items: [],
    routeMatch: { method, routePricingId: method === "NOT_FOUND" ? null : "route-1" },
  });

  it("reprices a closed Trip whose route is found, and refetches the list", async () => {
    await showTrips([buildTrip({ status: "CLOSED" })], () => Promise.resolve(snapshot("EXACT")));
    const listReadsBefore = listCalls(requestMock).length;

    await userEvent.click(repriceButton("ANRDUB2602247"));

    expect(await screen.findByText(/Prijs opnieuw berekend/)).toBeInTheDocument();
    expect(reprocessCalls()).toEqual([
      ["/api/v1/trip-pricing/trip/trip-1/reprocess", expect.objectContaining({ method: "POST" })],
    ]);
    await waitFor(() => expect(listCalls(requestMock).length).toBeGreaterThan(listReadsBefore));
  });

  /** Only the price: the reprocess is the one write, no Trip update beside it. */
  it("writes nothing but the reprocess", async () => {
    await showTrips([buildTrip({ status: "CLOSED" })], () => Promise.resolve(snapshot("EXACT")));

    await userEvent.click(repriceButton("ANRDUB2602247"));
    await screen.findByText(/Prijs opnieuw berekend/);

    expect(mutationCalls(requestMock)).toEqual(reprocessCalls());
  });

  it("says so when no route matches", async () => {
    await showTrips([buildTrip({ status: "CLOSED" })], () => Promise.resolve(snapshot("NOT_FOUND")));

    await userEvent.click(repriceButton("ANRDUB2602247"));

    expect(await screen.findByText(/geen passende route gevonden/)).toBeInTheDocument();
  });

  it("shows the backend's reason when the calculation fails", async () => {
    await showTrips([buildTrip({ status: "CLOSED" })], () =>
      Promise.reject(new ApiError("CONFLICT", "De brandstoftoeslag is niet ingesteld.", 409)),
    );

    await userEvent.click(repriceButton("ANRDUB2602247"));

    expect(await screen.findByText(/Herberekenen is niet gelukt/)).toBeInTheDocument();
    expect(screen.getByText(/De brandstoftoeslag is niet ingesteld\./)).toBeInTheDocument();
    // Usable again: a failure leaves nothing running.
    await waitFor(() => expect(repriceButton("ANRDUB2602247")).toBeEnabled());
  });

  /**
   * The existing reprocess prices the Trip it is asked about; a Combination
   * leg is no exception — its partner is neither sent nor touched here.
   */
  it("reprices a Combination leg through the same per-Trip reprocess", async () => {
    const legs = [
      buildTrip({ id: "leg-1", bookingNumber: "ANRDUB2600001", status: "CLOSED", tripGroupId: "group-1" }),
      buildTrip({ id: "leg-2", bookingNumber: "ANRDUB2600002", status: "CLOSED", tripGroupId: "group-1" }),
    ];

    await showTrips(legs, () => Promise.resolve(snapshot("EXACT")));

    await userEvent.click(repriceButton("ANRDUB2600002"));
    await screen.findByText(/Prijs opnieuw berekend/);

    expect(reprocessCalls().map(([path]) => path)).toEqual([
      "/api/v1/trip-pricing/trip/leg-2/reprocess",
    ]);
  });

  /**
   * The backend prices the partner leg with the one that was clicked; the
   * refetched list is what shows the operator both new prices.
   */
  it("shows the partner leg's new price from the refetched list", async () => {
    const legs = [
      buildTrip({ id: "leg-1", bookingNumber: "ANRDUB2600001", status: "CLOSED", tripGroupId: "group-1", pricing: buildPricing({ totaal: "155.00" }) }),
      buildTrip({ id: "leg-2", bookingNumber: "ANRDUB2600002", status: "CLOSED", tripGroupId: "group-1", pricing: buildPricing({ totaal: "155.00" }) }),
    ];

    await showTrips(legs, () => {
      legs[0].pricing = buildPricing({ totaal: "201.00" });
      legs[1].pricing = buildPricing({ totaal: "324.50" });

      return Promise.resolve(snapshot("EXACT"));
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));

    await userEvent.click(repriceButton("ANRDUB2600001"));

    expect(await within(rowOf("ANRDUB2600002")).findByText("324.50")).toBeInTheDocument();
    expect(within(rowOf("ANRDUB2600001")).getByText("201.00")).toBeInTheDocument();
    expect(reprocessCalls()).toHaveLength(1);
  });

  it("sends one request however often it is clicked while running", async () => {
    let finish: (value: unknown) => void = () => undefined;

    await showTrips([buildTrip({ status: "CLOSED" })], () => new Promise((resolve) => (finish = resolve)));

    const button = repriceButton("ANRDUB2602247");

    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.dblClick(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Bezig met herberekenen…");
    expect(reprocessCalls()).toHaveLength(1);

    finish(snapshot("EXACT"));

    expect(await screen.findByText(/Prijs opnieuw berekend/)).toBeInTheDocument();
    expect(reprocessCalls()).toHaveLength(1);
  });

  /** Only a finished Trip has a price; an OPEN one is priced when it closes. */
  it.each(["OPEN", "CANCELLED", "DELETED"] as const)("is not offered on a %s Trip", async (status) => {
    await showTrips([buildTrip({ status })], () => Promise.resolve(snapshot("EXACT")));

    expect(within(rowOf("ANRDUB2602247")).queryByRole("button", { name: new RegExp(REPRICE) })).toBeNull();
  });

  it("leaves Heropenen beside it on a closed Trip", async () => {
    await showTrips([buildTrip({ status: "CLOSED" })], () => Promise.resolve(snapshot("EXACT")));

    expect(
      within(rowOf("ANRDUB2602247")).getByRole("button", { name: "Heropenen ANRDUB2602247" }),
    ).toBeInTheDocument();
  });
});
