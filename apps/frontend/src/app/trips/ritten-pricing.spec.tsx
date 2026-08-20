import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Prices in the Ritten list.
 *
 * ── WHAT THESE TESTS ARE GUARDING ───────────────────────────────────────────
 * Two things, and they matter more than the layout:
 *
 *   1. the browser never calculates a price. Every amount on screen is one the
 *      backend stored, the total most of all — so a test that "the total equals
 *      the sum of the columns" would be testing the wrong thing entirely, and
 *      is deliberately absent.
 *   2. showing prices is a READ. Ticking the box must never price a Trip.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PRICED_TRIP = buildTrip({
  id: "trip-priced",
  bookingNumber: "ANRDUB2602247",
  status: "CLOSED",
});

const UNPRICED_TRIP = buildTrip({
  id: "trip-unpriced",
  bookingNumber: "ANRBEL2768902",
  status: "OPEN",
});

/** A snapshot as the backend stores one: amounts are fixed-2 strings. */
function snapshotFor(tripId: string) {
  return {
    pricing: {
      id: `pricing-${tripId}`,
      tripId,
      totalPrice: "651.25",
      currency: "EUR",
      calculatedAt: "2026-08-18T08:00:00.000Z",
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "2026.1",
      calculationStatus: "CALCULATED",
      notes: null,
      createdAt: "2026-08-18T08:00:00.000Z",
      updatedAt: "2026-08-18T08:00:00.000Z",
    },
    items: [
      { id: "i1", pricingComponentCode: "BASE_PRICE", amount: "450.00" },
      { id: "i2", pricingComponentCode: "FUEL_SURCHARGE", amount: "67.50" },
      { id: "i3", pricingComponentCode: "COMBINATION", amount: "50.00" },
      { id: "i4", pricingComponentCode: "TOLL", amount: "12.50" },
      { id: "i5", pricingComponentCode: "TUNNEL", amount: "8.00" },
      { id: "i6", pricingComponentCode: "CUSTOM_PROPERTY", amount: "20.00" },
      { id: "i7", pricingComponentCode: "CUSTOM_PROPERTY", amount: "35.00" },
      { id: "i8", pricingComponentCode: "WAITING_TIME", amount: "27.50" },
    ],
  };
}

function toggle() {
  return screen.getByRole("checkbox", { name: "Prijzen tonen" });
}

/** Every call the page made to the bulk pricing read. */
function snapshotCalls() {
  return requestMock.mock.calls.filter(
    (call) => call[0] === "/api/v1/trip-pricing/snapshots",
  );
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("showing prices in Ritten", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([PRICED_TRIP, UNPRICED_TRIP]),
      pricingSnapshots: [snapshotFor(PRICED_TRIP.id)],
    });
  });

  it("hides the pricing columns until they are asked for", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    expect(toggle()).not.toBeChecked();
    expect(screen.queryByRole("columnheader", { name: "Tarief" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Totaal" })).toBeNull();
    // Not masked, not blank — absent.
    expect(screen.queryByText("651.25")).toBeNull();
    expect(screen.queryByText("******")).toBeNull();
  });

  it("does not read pricing while the columns are hidden", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    expect(snapshotCalls()).toHaveLength(0);
  });

  it("shows the columns in the agreed order when ticked", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());

    const headers = await screen.findAllByRole("columnheader");
    const pricing = headers
      .map((header) => header.textContent)
      .filter((label) =>
        [
          "Tarief",
          "Brandstof",
          "Backload",
          "Tol",
          "Tunnel",
          "Others",
          "EK",
          "Totaal",
        ].includes(label ?? ""),
      );

    expect(pricing).toEqual([
      "Tarief",
      "Brandstof",
      "Backload",
      "Tol",
      "Tunnel",
      "Others",
      "EK",
      "Totaal",
    ]);
  });

  it("shows the stored amounts of a priced Trip", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await userEvent.click(toggle());

    const row = (await screen.findByText("ANRDUB2602247")).closest("tr");

    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);

    expect(cells.getByText("450.00")).toBeInTheDocument();
    expect(cells.getByText("67.50")).toBeInTheDocument();
    expect(cells.getByText("50.00")).toBeInTheDocument();
    expect(cells.getByText("12.50")).toBeInTheDocument();
    expect(cells.getByText("8.00")).toBeInTheDocument();
    // The two fixed Custom Properties, as the export sums them.
    expect(cells.getByText("55.00")).toBeInTheDocument();
    expect(cells.getByText("27.50")).toBeInTheDocument();
  });

  /**
   * The total is the backend's own `totalPrice`. It is deliberately NOT the sum
   * of the columns beside it — here they add up to 650.50, and the stored total
   * is 651.25. The stored one is what must appear.
   */
  it("shows the stored total verbatim, never a sum of the columns", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await userEvent.click(toggle());

    const row = (await screen.findByText("ANRDUB2602247")).closest("tr");

    expect(within(row as HTMLElement).getByText("651.25")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("650.50")).toBeNull();
  });

  it("leaves an unpriced Trip's cells empty rather than zero", async () => {
    renderRitten();
    await screen.findByText("ANRBEL2768902");
    await userEvent.click(toggle());

    const row = (await screen.findByText("ANRBEL2768902")).closest("tr");

    expect(within(row as HTMLElement).queryByText("0.00")).toBeNull();
    expect(within(row as HTMLElement).queryByText("651.25")).toBeNull();
  });

  it("removes the columns again when unticked", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());
    expect(
      await screen.findByRole("columnheader", { name: "Totaal" }),
    ).toBeInTheDocument();

    await userEvent.click(toggle());

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: "Totaal" })).toBeNull();
    });
    expect(screen.queryByText("651.25")).toBeNull();
  });

  /**
   * ── NO N+1 ────────────────────────────────────────────────────────────────
   * Two Trips on screen, one request for their pricing. The request count
   * follows the page, not the row count — the client batches the ids under the
   * endpoint's own limit.
   */
  it("reads the pricing of the whole page in one request", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    expect(snapshotCalls()).toHaveLength(1);
  });

  it("asks for every Trip on the page in that one request", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    const [, options] = snapshotCalls()[0] as [
      string,
      { query: { tripIds: string } },
    ];

    expect(options.query.tripIds).toBe(`${PRICED_TRIP.id},${UNPRICED_TRIP.id}`);
  });

  /*
   * Showing prices must not price anything. Nothing may be written, and the
   * reprocess route must not be touched.
   */
  it("prices nothing: the read is the only call it makes", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    const writes = requestMock.mock.calls.filter(
      (call) => ((call[1]?.method as string) ?? "GET") !== "GET",
    );

    expect(writes).toHaveLength(0);
    expect(
      requestMock.mock.calls.filter((call) =>
        String(call[0]).includes("/reprocess"),
      ),
    ).toHaveLength(0);
  });
});

/**
 * After an edit that can change what a Trip costs, the amounts on screen come
 * from the backend again — they are never adjusted here.
 */
describe("keeping the displayed prices current", () => {
  it("refetches the pricing after a Trip is saved", async () => {
    respondWith(requestMock, {
      trips: buildPage([PRICED_TRIP]),
      pricingSnapshots: [snapshotFor(PRICED_TRIP.id)],
    });

    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    expect(snapshotCalls()).toHaveLength(1);

    // The waiting-time cell: the field the operator changes most, and the one
    // whose change moves a price. 1h30 -> 2h30 crosses the charging threshold.
    await userEvent.click(
      await screen.findByRole("button", { name: "Wachttijd in minuten" }),
    );

    await userEvent.clear(screen.getByLabelText("uur"));
    await userEvent.type(screen.getByLabelText("uur"), "2");
    await userEvent.clear(screen.getByLabelText("min"));
    await userEvent.type(screen.getByLabelText("min"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => {
      expect(snapshotCalls().length).toBeGreaterThan(1);
    });
  });

  it("does not refetch pricing when the columns are hidden", async () => {
    respondWith(requestMock, {
      trips: buildPage([PRICED_TRIP]),
      pricingSnapshots: [snapshotFor(PRICED_TRIP.id)],
    });

    renderRitten();
    await screen.findByText("ANRDUB2602247");

    expect(snapshotCalls()).toHaveLength(0);
  });
});

/**
 * ── THE FAILED READ ─────────────────────────────────────────────────────────
 * A pricing read that FAILS and a page of Trips that have no pricing look
 * identical: eight columns of dashes. They mean opposite things — "nothing is
 * stored for these Trips" versus "we could not find out" — and on a screen
 * used for invoicing, reading the second as the first is the expensive
 * mistake.
 *
 * The regression this guards: the failure was swallowed entirely. `useAsync`
 * puts the error in `error` and leaves `data` null, the table falls back to an
 * empty map, and every row renders its ordinary empty marker. Nothing on the
 * page said a request had failed.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("when the pricing read fails", () => {
  const CLOSED_TRIP = buildTrip({
    id: "trip-closed",
    bookingNumber: "ANRDUB2602247",
    status: "CLOSED",
  });

  function respondExceptPricing(): void {
    respondWith(requestMock, { trips: buildPage([CLOSED_TRIP]) });

    const answerNormally = requestMock.getMockImplementation() as (
      ...args: unknown[]
    ) => Promise<unknown>;

    requestMock.mockImplementation((...args: unknown[]) => {
      if (args[0] === "/api/v1/trip-pricing/snapshots") {
        return Promise.reject(new Error("Service unavailable"));
      }

      return answerNormally(...args);
    });
  }

  it("says so instead of showing empty price columns", async () => {
    respondExceptPricing();
    const user = userEvent.setup();
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await user.click(toggle());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/konden niet worden geladen/);
  });

  it("keeps the failure out of the way while the columns are hidden", async () => {
    respondExceptPricing();
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    // Nothing was asked for, so there is nothing to report.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers the read again rather than leaving the operator stuck", async () => {
    respondExceptPricing();
    const user = userEvent.setup();
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await user.click(toggle());
    await screen.findByRole("alert");

    const before = snapshotCalls().length;
    await user.click(screen.getByRole("button", { name: "Opnieuw proberen" }));

    await waitFor(() => expect(snapshotCalls().length).toBeGreaterThan(before));
  });

  it("clears the notice once the read succeeds", async () => {
    respondExceptPricing();
    const user = userEvent.setup();
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await user.click(toggle());
    await screen.findByRole("alert");

    // The backend recovers; the same retry must leave no trace of the failure.
    respondWith(requestMock, {
      trips: buildPage([CLOSED_TRIP]),
      pricingSnapshots: [snapshotFor(CLOSED_TRIP.id)],
    });

    await user.click(screen.getByRole("button", { name: "Opnieuw proberen" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("651.25")).toBeInTheDocument();
  });
});
