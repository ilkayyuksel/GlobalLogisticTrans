import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import type { EffectivePricing, Trip } from "@/lib/api/types";
import {
  buildPage,
  buildPricing,
  buildTrip,
  listCalls,
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
 * Dynamic pricing, seen from the Ritten list.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * Changing a Trip's own pricing input — a waiting-time window, a Custom
 * Property — recalculates it, and the write ANSWERS with the new figures. The
 * rules that follow from that, all asserted below:
 *
 *   the affected row updates FROM THE RESPONSE. No list refetch, so the filter,
 *     the page, the period, the selection and the scroll position survive and
 *     no other row moves under the operator's hands;
 *   only the edited Trip changes. A second Trip on the same page is untouched;
 *   an operator's Tarief correction survives the recalculation, and Brandstof
 *     follows the corrected figure — the backend decides both, and this side
 *     only has to show what it was told;
 *   a recalculation that FAILED blanks the row rather than leaving the previous
 *     amounts on screen looking current;
 *   and the Trip's status never changes: CLOSED stays CLOSED.
 *
 * Nothing here computes an amount. Every figure asserted is one a fixture said
 * the backend returned.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A finished Trip with a full breakdown, which is what dynamic pricing edits. */
function closedTrip(overrides: Partial<Trip> = {}): Trip {
  return buildTrip({
    id: "trip-1",
    bookingNumber: "ANRDUB2602247",
    status: "CLOSED",
    waitingTimeMinutes: 60,
    pricing: buildPricing({
      tarief: "520.00",
      brandstof: "78.00",
      backload: "0.00",
      tol: "18.00",
      tunnel: "0.00",
      others: "130.00",
      ek: "0.00",
      totaal: "746.00",
    }),
    ...overrides,
  });
}

/** A second row on the same page, so "only one changed" can be proven. */
const UNTOUCHED_TRIP = buildTrip({
  id: "trip-untouched",
  bookingNumber: "ANRBEL2768902",
  status: "CLOSED",
  pricing: buildPricing({
    tarief: "300.00",
    brandstof: "45.00",
    backload: "0.00",
    tol: "0.00",
    tunnel: "0.00",
    others: "20.00",
    ek: "0.00",
    totaal: "365.00",
  }),
});

const CELL = {
  tarief: 0,
  brandstof: 1,
  backload: 2,
  tol: 3,
  tunnel: 4,
  others: 5,
  ek: 6,
  totaal: 7,
} as const;

async function rowOf(bookingNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(bookingNumber)).closest("tr") as HTMLElement;
}

/** The eight pricing cells of a row, appended to the right of every other. */
function pricingCells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell").slice(-8);
}

async function showPrices(): Promise<void> {
  await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));
}

/** The waiting-time cell of one row — both rows have one, so it is by row. */
async function waitingTimeCell(
  bookingNumber: string,
): Promise<HTMLElement> {
  return within(await rowOf(bookingNumber)).getByRole("button", {
    name: "Wachttijd in minuten",
  });
}

async function saveWaitingTime(begin: string, end: string): Promise<void> {
  await userEvent.click(await waitingTimeCell("ANRDUB2602247"));

  await userEvent.clear(screen.getByLabelText("Begin"));
  await userEvent.type(screen.getByLabelText("Begin"), begin);
  await userEvent.clear(screen.getByLabelText("Eind"));
  await userEvent.type(screen.getByLabelText("Eind"), end);
  await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("a waiting-time change", () => {
  /**
   * 10:00 → 12:15 is 135 minutes, which is what the backend derives and bills.
   * The response below is the backend's answer, verbatim: a longer wait costs
   * more Others, and Totaal follows.
   */
  const RECALCULATED: EffectivePricing = buildPricing({
    tarief: "520.00",
    brandstof: "78.00",
    backload: "0.00",
    tol: "18.00",
    tunnel: "0.00",
    others: "160.00",
    ek: "0.00",
    totaal: "776.00",
  });

  function answerWith(
    pricing: EffectivePricing | null,
    reasonCode: string | null = null,
  ): void {
    respondWith(requestMock, {
      trips: buildPage([closedTrip(), UNTOUCHED_TRIP]),
      onTripUpdate: ({ tripId }) =>
        closedTrip({
          id: tripId,
          waitingTimeStart: "10:00:00",
          waitingTimeEnd: "12:15:00",
          waitingTimeMinutes: 135,
          pricing,
          reasonCode,
        }),
    });
  }

  it("shows the recalculated Others and Totaal from the response", async () => {
    answerWith(RECALCULATED);
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await saveWaitingTime("10:00", "12:15");

    await waitFor(async () => {
      const cells = pricingCells(await rowOf("ANRDUB2602247"));

      expect(cells[CELL.others]).toHaveTextContent("160.00");
      expect(cells[CELL.totaal]).toHaveTextContent("776.00");
    });
  });

  it("shows the new duration without asking for the list again", async () => {
    answerWith(RECALCULATED);
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    const before = listCalls(requestMock).length;

    await saveWaitingTime("10:00", "12:15");
    await screen.findByText("Rit bijgewerkt");

    expect(await waitingTimeCell("ANRDUB2602247")).toHaveTextContent(
      "2 u 15 min",
    );
    expect(listCalls(requestMock)).toHaveLength(before);
  });

  it("leaves every other row exactly as it was", async () => {
    answerWith(RECALCULATED);
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await saveWaitingTime("10:00", "12:15");
    await screen.findByText("Rit bijgewerkt");

    const cells = pricingCells(await rowOf("ANRBEL2768902"));

    expect(cells[CELL.others]).toHaveTextContent("20.00");
    expect(cells[CELL.totaal]).toHaveTextContent("365.00");
  });

  /**
   * CLOSED is terminal. A price may change afterwards; the fact that the work
   * is finished may not, and there is no CLOSED to OPEN anywhere in the system.
   */
  it("leaves the Trip CLOSED", async () => {
    answerWith(RECALCULATED);
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await saveWaitingTime("10:00", "12:15");
    await screen.findByText("Rit bijgewerkt");

    expect(
      within(await rowOf("ANRDUB2602247")).getByText("Afgewerkt"),
    ).toBeInTheDocument();
  });

  /**
   * ── THE FAILURE CONTRACT ────────────────────────────────────────────────
   * The write succeeded and the response is a success. The pricing could not be
   * recalculated, so it is absent — and the row shows the empty marker rather
   * than the amounts from before the edit, which describe a window that no
   * longer exists and would look perfectly current on screen.
   */
  it("blanks the amounts when the recalculation could not price the Trip", async () => {
    answerWith(null, "PRICING_MISSING_ROUTE_PRICING");
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await saveWaitingTime("10:00", "12:15");
    await screen.findByText("Rit bijgewerkt");

    for (const cell of pricingCells(await rowOf("ANRDUB2602247"))) {
      expect(cell).toHaveTextContent("—");
    }
  });

  it("keeps the write: the new duration is still shown", async () => {
    answerWith(null, "PRICING_MISSING_ROUTE_PRICING");
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await saveWaitingTime("10:00", "12:15");
    await screen.findByText("Rit bijgewerkt");

    expect(await waitingTimeCell("ANRDUB2602247")).toHaveTextContent(
      "2 u 15 min",
    );
  });
});

describe("a Custom Property change", () => {
  const WITH_PROPERTY: EffectivePricing = buildPricing({
    tarief: "520.00",
    brandstof: "78.00",
    backload: "0.00",
    tol: "18.00",
    tunnel: "0.00",
    others: "210.00",
    ek: "0.00",
    totaal: "826.00",
  });

  const ADR_ASSIGNMENT = {
    id: "assignment-adr",
    tripId: "trip-1",
    customPropertyId: "prop-adr",
    customProperty: {
      id: "prop-adr",
      name: "ADR toeslag",
      description: null,
      pricingComponentId: null,
      defaultPrice: "80.00",
      displayOrder: 2,
      color: null,
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    assignedAt: "2026-08-01T00:00:00.000Z",
    isAutomatic: false,
    isRequired: false,
  };

  /**
   * The dialog re-reads the assignment set after a change — display order is
   * the backend's — so the GET answers differently before and after. A getter
   * rather than a fixed array, because `respondWith` is configured once.
   */
  function answerWith(
    pricing: EffectivePricing | null,
    reasonCode: string | null = null,
  ): void {
    let hasChanged = false;

    respondWith(requestMock, {
      trips: buildPage([closedTrip(), UNTOUCHED_TRIP]),
      availableCustomProperties: [
        { id: "prop-adr", name: "ADR toeslag", isActive: true },
      ],
      get assignedCustomProperties() {
        return hasChanged ? [ADR_ASSIGNMENT] : [];
      },
      onCustomPropertyMutation: () => {
        hasChanged = true;

        return { ...ADR_ASSIGNMENT, pricing, reasonCode };
      },
    });
  }

  async function assignProperty(): Promise<void> {
    await userEvent.click(
      within(await rowOf("ANRDUB2602247")).getByRole("button", {
        name: "Custom waarden beheren ANRDUB2602247",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "+ ADR toeslag" }),
    );
  }

  it("shows the recalculated Others and Totaal from the write's response", async () => {
    answerWith(WITH_PROPERTY);
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await assignProperty();

    await waitFor(async () => {
      const cells = pricingCells(await rowOf("ANRDUB2602247"));

      expect(cells[CELL.others]).toHaveTextContent("210.00");
      expect(cells[CELL.totaal]).toHaveTextContent("826.00");
    });
  });

  it("never refetches the list", async () => {
    answerWith(WITH_PROPERTY);
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    const before = listCalls(requestMock).length;

    await assignProperty();

    await waitFor(async () => {
      expect(
        pricingCells(await rowOf("ANRDUB2602247"))[CELL.totaal],
      ).toHaveTextContent("826.00");
    });
    expect(listCalls(requestMock)).toHaveLength(before);
  });

  it("leaves every other row exactly as it was", async () => {
    answerWith(WITH_PROPERTY);
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await assignProperty();

    await waitFor(async () => {
      expect(
        pricingCells(await rowOf("ANRDUB2602247"))[CELL.totaal],
      ).toHaveTextContent("826.00");
    });

    const cells = pricingCells(await rowOf("ANRBEL2768902"));

    expect(cells[CELL.others]).toHaveTextContent("20.00");
    expect(cells[CELL.totaal]).toHaveTextContent("365.00");
  });

  it("blanks the amounts when the recalculation could not price the Trip", async () => {
    answerWith(null, "PRICING_MISSING_ROUTE_PRICING");
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await assignProperty();

    await waitFor(async () => {
      for (const cell of pricingCells(await rowOf("ANRDUB2602247"))) {
        expect(cell).toHaveTextContent("—");
      }
    });
  });
});

/**
 * ── AN OPERATOR'S CORRECTION SURVIVES A RECALCULATION ─────────────────────
 * The operator corrected the Tarief to 620.00. A waiting-time change reprices
 * the Trip, and the backend's answer still carries 620.00 with a Brandstof
 * derived from it — corrections live in their own table and are applied on top
 * of a fresh snapshot at read time.
 *
 * This side asserts only that it SHOWS what it was told. Recomputing either
 * figure here would be a second opinion about money.
 */
describe("an operator's correction during a recalculation", () => {
  const OVERRIDDEN: EffectivePricing = buildPricing({
    tarief: "620.00",
    brandstof: "93.00",
    backload: "0.00",
    tol: "18.00",
    tunnel: "0.00",
    others: "160.00",
    ek: "0.00",
    totaal: "891.00",
    overriddenComponents: ["BASE_PRICE"],
  });

  it("keeps the corrected Tarief and the Brandstof derived from it", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        closedTrip({
          pricing: buildPricing({
            tarief: "620.00",
            brandstof: "93.00",
            backload: "0.00",
            tol: "18.00",
            tunnel: "0.00",
            others: "130.00",
            ek: "0.00",
            totaal: "861.00",
            overriddenComponents: ["BASE_PRICE"],
          }),
        }),
      ]),
      onTripUpdate: ({ tripId }) =>
        closedTrip({
          id: tripId,
          waitingTimeMinutes: 135,
          pricing: OVERRIDDEN,
        }),
    });

    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await showPrices();

    await saveWaitingTime("10:00", "12:15");

    await waitFor(async () => {
      const cells = pricingCells(await rowOf("ANRDUB2602247"));

      expect(cells[CELL.tarief]).toHaveTextContent("620.00");
      expect(cells[CELL.brandstof]).toHaveTextContent("93.00");
      expect(cells[CELL.totaal]).toHaveTextContent("891.00");
    });
  });
});
