import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import { buildPage, buildTrip, lastListCall, renderRitten, respondWith } from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * "Route nakijken", from the Ritten list.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * One switch, sent to the BACKEND as `routeAttention=true` — which Trips need
 * attention (no usable route, or a route price not checked) is decided there,
 * against the stored match and the Routeprijzen marks, and proven in
 * `route-attention.db.spec.ts`. Here: off sends nothing at all, so the list is
 * exactly what it was; on combines with the period, the other filters, the
 * sort and the counts; and it clears with the other filters.
 * ────────────────────────────────────────────────────────────────────────────
 */

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/trips");
  respondWith(requestMock, { trips: buildPage([buildTrip({ id: "trip-1", bookingNumber: "ANRDUB2602247" })]) });
});

async function showList() {
  renderRitten();
  await screen.findByText("ANRDUB2602247");
}

const toggle = () => screen.getByRole("checkbox", { name: "Route nakijken" });

/** Every count the tiles ask for: the list's own query with one result. */
function countCalls(): Record<string, unknown>[] {
  return requestMock.mock.calls
    .filter(([path, options]) => path === "/api/v1/trips" && (options?.query as Record<string, unknown>)?.pageSize === 1)
    .map(([, options]) => options?.query as Record<string, unknown>);
}

describe("the route-attention filter", () => {
  it("is off by default and sends no parameter at all", async () => {
    await showList();

    expect(toggle()).not.toBeChecked();
    expect(lastListCall(requestMock).routeAttention).toBeUndefined();
  });

  it("asks the backend for the Trips whose route needs attention", async () => {
    await showList();

    await userEvent.click(toggle());

    await waitFor(() => expect(lastListCall(requestMock).routeAttention).toBe(true));
  });

  it("counts the same Trips the list shows", async () => {
    await showList();

    await userEvent.click(toggle());

    await waitFor(() => {
      const counts = countCalls();

      expect(counts.length).toBeGreaterThan(0);
      expect(counts[counts.length - 1].routeAttention).toBe(true);
    });
  });

  it("goes back to no parameter when switched off", async () => {
    await showList();

    await userEvent.click(toggle());
    await waitFor(() => expect(lastListCall(requestMock).routeAttention).toBe(true));
    await userEvent.click(toggle());

    await waitFor(() => expect(lastListCall(requestMock).routeAttention).toBeUndefined());
  });

  it("combines with the status, the payment, the search and the sort", async () => {
    await showList();

    await userEvent.click(toggle());
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Status" })).getByRole("radio", { name: "Afgewerkt" }),
    );
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Betaling" })).getByRole("radio", { name: "Niet betaald" }),
    );
    await userEvent.type(screen.getByRole("searchbox"), "ANRDUB");

    await waitFor(() =>
      expect(lastListCall(requestMock)).toMatchObject({
        routeAttention: true,
        status: "CLOSED",
        isPaid: false,
        search: "ANRDUB",
        sortBy: "licensePlate",
      }),
    );
  });

  it("keeps the period, so week and month ask for their own range", async () => {
    await showList();

    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    await userEvent.click(toggle());

    await waitFor(() => {
      const call = lastListCall(requestMock);

      expect(call.routeAttention).toBe(true);
      expect(call.planningDateFrom).toBeDefined();
      expect(call.planningDateTo).toBeDefined();
    });
  });

  it("counts as an active filter, so it clears with the others", async () => {
    await showList();

    await userEvent.click(toggle());
    await waitFor(() => expect(lastListCall(requestMock).routeAttention).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Filters wissen" }));

    await waitFor(() => expect(lastListCall(requestMock).routeAttention).toBeUndefined());
    expect(toggle()).not.toBeChecked();
  });

  it("is kept in the address, so Back and a shared link keep it", async () => {
    await showList();

    await userEvent.click(toggle());

    await waitFor(() => expect(window.location.search).toMatch(/[?&]route=/));
  });

  it("says what it shows", async () => {
    await showList();

    expect(toggle().closest("label")).toHaveAttribute(
      "title",
      expect.stringContaining("zonder bruikbare route"),
    );
  });
});
