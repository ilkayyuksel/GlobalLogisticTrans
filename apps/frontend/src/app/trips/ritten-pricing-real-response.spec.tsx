import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import type { EffectivePricing } from "@/lib/api/types";
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
 * The Ritten pricing columns, driven by the REAL backend response.
 *
 * ── WHY THIS EXISTS BESIDE THE OTHER PRICING SPECS ──────────────────────────
 * Every other pricing test builds its `pricing` through a fixture helper. That
 * proves the component behaves, but it cannot prove the fixture still resembles
 * what the API sends — and if the two ever drifted, all of them would keep
 * passing while the real screen went blank.
 *
 * The two objects below are not handcrafted. They were captured from the actual
 * Pricing Engine against the real database: one CLOSED Trip on a configured
 * route, one on a route nobody has configured. They are pasted verbatim, keys
 * and string formatting included.
 *
 * ── WHAT THEY PIN ───────────────────────────────────────────────────────────
 * That the eight amounts the list shows are exactly the eight fields the
 * backend sends, under exactly those names; that a component priced at ZERO
 * still arrives as `"0.00"` rather than being omitted; and that a Trip on an
 * unconfigured route arrives as a pricing OBJECT rather than as null — which is
 * what keeps its three corrections editable.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Captured from a CLOSED Trip on `PSA Quay 869 -> Dourges`, a configured route.
 * Tarief 520 at 15% fuel, with the automatic TAR property in Others.
 */
const CONFIGURED_ROUTE_PRICING: EffectivePricing = {
  tarief: "520.00",
  brandstof: "78.00",
  backload: "0.00",
  tol: "0.00",
  tunnel: "0.00",
  others: "20.00",
  ek: "0.00",
  totaal: "618.00",
  components: [
    {
      componentCode: "BASE_PRICE",
      engineAmount: "520.00",
      effectiveAmount: "520.00",
      source: "ENGINE",
    },
    {
      componentCode: "CUSTOM_PROPERTY",
      engineAmount: "20.00",
      effectiveAmount: "20.00",
      source: "ENGINE",
    },
    {
      componentCode: "FUEL_SURCHARGE",
      engineAmount: "78.00",
      effectiveAmount: "78.00",
      source: "ENGINE",
    },
  ],
};

/**
 * Captured from a CLOSED Trip on a route nobody configured. The route-derived
 * amounts are zero; the TAR property still contributes to Others.
 */
const UNCONFIGURED_ROUTE_PRICING: EffectivePricing = {
  tarief: "0.00",
  brandstof: "0.00",
  backload: "0.00",
  tol: "0.00",
  tunnel: "0.00",
  others: "20.00",
  ek: "0.00",
  totaal: "20.00",
  components: [
    {
      componentCode: "BASE_PRICE",
      engineAmount: "0.00",
      effectiveAmount: "0.00",
      source: "ENGINE",
    },
    {
      componentCode: "CUSTOM_PROPERTY",
      engineAmount: "20.00",
      effectiveAmount: "20.00",
      source: "ENGINE",
    },
    {
      componentCode: "FUEL_SURCHARGE",
      engineAmount: "0.00",
      effectiveAmount: "0.00",
      source: "ENGINE",
    },
  ],
};

const CONFIGURED_BOOKING = "ANRDUB2789089";
const UNCONFIGURED_BOOKING = "ANRGHL2790641";

function toggle() {
  return screen.getByRole("checkbox", { name: "Prijzen tonen" });
}

async function rowOf(bookingNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(bookingNumber)).closest("tr") as HTMLElement;
}

/** The eight pricing cells, which are the last eight of the row. */
function pricingCells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell").slice(-8);
}

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

const EDITABLE = ["tarief", "tol", "tunnel"] as const;
const READ_ONLY = ["brandstof", "backload", "others", "ek", "totaal"] as const;

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

/**
 * The eight names the list reads, and nothing else. Asserted against the
 * captured objects rather than against the TypeScript type, because the type is
 * what would be edited to match a drifted API — the captured JSON is not.
 */
describe("the shape the backend actually sends", () => {
  it.each([
    ["a configured route", CONFIGURED_ROUTE_PRICING],
    ["an unconfigured route", UNCONFIGURED_ROUTE_PRICING],
  ])("carries the eight amounts plus components, for %s", (_label, pricing) => {
    expect(Object.keys(pricing).sort()).toEqual([
      "backload",
      "brandstof",
      "components",
      "ek",
      "others",
      "tarief",
      "tol",
      "totaal",
      "tunnel",
    ]);
  });

  /** Zero arrives as a formatted amount, never as null or a missing key. */
  it("sends a zero component as \"0.00\"", () => {
    expect(UNCONFIGURED_ROUTE_PRICING.tarief).toBe("0.00");
    expect(UNCONFIGURED_ROUTE_PRICING.brandstof).toBe("0.00");
    expect(UNCONFIGURED_ROUTE_PRICING.tol).toBe("0.00");
    expect(UNCONFIGURED_ROUTE_PRICING.tunnel).toBe("0.00");
  });

  /** Preformatted by the backend: the browser never formats or rounds. */
  it.each([
    ["a configured route", CONFIGURED_ROUTE_PRICING],
    ["an unconfigured route", UNCONFIGURED_ROUTE_PRICING],
  ])("sends every amount as a fixed two-decimal string, for %s", (_l, pricing) => {
    for (const key of [...EDITABLE, ...READ_ONLY] as const) {
      expect(pricing[key]).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

describe("a Trip priced on a configured route", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-configured",
          bookingNumber: CONFIGURED_BOOKING,
          status: "CLOSED",
          pricing: CONFIGURED_ROUTE_PRICING,
        }),
      ]),
    });
  });

  it("shows the backend's own amounts in the eight columns", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf(CONFIGURED_BOOKING));

    expect(cells[CELL.tarief]).toHaveTextContent("520.00");
    expect(cells[CELL.brandstof]).toHaveTextContent("78.00");
    expect(cells[CELL.backload]).toHaveTextContent("0.00");
    expect(cells[CELL.tol]).toHaveTextContent("0.00");
    expect(cells[CELL.tunnel]).toHaveTextContent("0.00");
    expect(cells[CELL.others]).toHaveTextContent("20.00");
    expect(cells[CELL.ek]).toHaveTextContent("0.00");
    expect(cells[CELL.totaal]).toHaveTextContent("618.00");
  });

  /**
   * The total is the backend's, not a sum computed here. 520 + 78 + 20 happens
   * to be 618, and that is a coincidence this test must not rely on — asserting
   * the rendered string against the captured one is the point.
   */
  it("shows the backend's total rather than a locally added one", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf(CONFIGURED_BOOKING));

    expect(cells[CELL.totaal]).toHaveTextContent(
      CONFIGURED_ROUTE_PRICING.totaal,
    );
  });
});

/**
 * ── THE CASE THE OPERATOR ACTUALLY HITS ─────────────────────────────────────
 * A CLOSED Trip whose route nobody configured. Every route-derived amount is
 * zero, and all three corrections must still be offered — this is precisely the
 * Trip an operator needs to type a Tarief into.
 */
describe("a Trip priced on an unconfigured route", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-unconfigured",
          bookingNumber: UNCONFIGURED_BOOKING,
          status: "CLOSED",
          pricing: UNCONFIGURED_ROUTE_PRICING,
        }),
      ]),
    });
  });

  it("shows zeros rather than the empty marker", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf(UNCONFIGURED_BOOKING));

    for (const key of ["tarief", "brandstof", "tol", "tunnel"] as const) {
      expect(cells[CELL[key]]).toHaveTextContent("0.00");
    }

    expect(cells[CELL.others]).toHaveTextContent("20.00");
    expect(cells[CELL.totaal]).toHaveTextContent("20.00");
  });

  it.each(EDITABLE)("still offers an editor on %s", async (key) => {
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf(UNCONFIGURED_BOOKING))[CELL[key]];

    expect(within(cell).getAllByRole("button").length).toBeGreaterThan(0);
  });

  it.each(READ_ONLY)("offers no editor on %s", async (key) => {
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf(UNCONFIGURED_BOOKING))[CELL[key]];

    expect(within(cell).queryAllByRole("button")).toHaveLength(0);
  });

  /** Clicking a zero opens the editor with the zero in it, ready to type over. */
  it.each(EDITABLE)("opens %s for editing, showing the zero", async (key) => {
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf(UNCONFIGURED_BOOKING))[CELL[key]];

    await userEvent.click(within(cell).getAllByRole("button")[0]);

    expect(within(cell).getByRole("spinbutton")).toHaveValue(0);
    expect(within(cell).getByRole("button", { name: "Opslaan" })).toBeVisible();
    expect(
      within(cell).getByRole("button", { name: "Annuleren" }),
    ).toBeVisible();
  });
});

/**
 * ── AND THE STATE THAT LOOKS LIKE A BROKEN UI ───────────────────────────────
 * A Trip that has never been priced sends `pricing: null`, and the list shows
 * the empty marker in all eight columns with no editor anywhere.
 *
 * That is correct — there is no breakdown to correct yet — but it is
 * indistinguishable, at a glance, from the pricing columns being broken. It is
 * pinned here so the difference between "no data" and "no feature" stays
 * visible in the test suite.
 */
describe("a Trip that has never been priced", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-unpriced",
          bookingNumber: "ANRDUB2797456",
          status: "CLOSED",
          pricing: null,
        }),
      ]),
    });
  });

  it("shows the empty marker in all eight columns", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRDUB2797456"));

    for (const index of Object.values(CELL)) {
      expect(cells[index]).toHaveTextContent("—");
    }
  });

  it("offers no editor at all", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRDUB2797456"));

    for (const index of Object.values(CELL)) {
      expect(within(cells[index]).queryAllByRole("button")).toHaveLength(0);
    }
  });
});
