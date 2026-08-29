import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import {
  buildPage,
  buildPricing,
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
 * Prices in the Ritten list: what is shown, and what may be touched.
 *
 * ── WHAT THESE TESTS ARE GUARDING ───────────────────────────────────────────
 * Three things, and they matter more than the layout:
 *
 *   1. the browser never calculates a price. Every amount on screen is one the
 *      backend sent, the total most of all — so a test that "the total equals
 *      the sum of the columns" would be testing the wrong thing entirely, and
 *      is deliberately absent.
 *   2. the prices TRAVEL ON THE TRIP. Showing them costs no request, so there
 *      is no second read that could fail on its own or describe rows that have
 *      since moved.
 *   3. exactly three of the eight amounts can be typed. The other five are
 *      derived, and an editor on any of them would be a competing answer.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Distinct amounts throughout, so no assertion can match the wrong cell. */
const PRICED_TRIP = buildTrip({
  id: "trip-priced",
  bookingNumber: "ANRDUB2602247",
  status: "CLOSED",
  pricing: buildPricing({
    tarief: "100.00",
    brandstof: "15.00",
    backload: "50.00",
    tol: "12.50",
    tunnel: "8.00",
    others: "130.00",
    ek: "165.00",
    totaal: "480.50",
  }),
});

const UNPRICED_TRIP = buildTrip({
  id: "trip-unpriced",
  bookingNumber: "ANRBEL2768902",
  status: "OPEN",
  pricing: null,
});

const PRICING_COLUMNS = [
  "Tarief",
  "Brandstof",
  "Backload",
  "Tol",
  "Tunnel",
  "Others",
  "EK",
  "Totaal",
];

function toggle() {
  return screen.getByRole("checkbox", { name: "Prijzen tonen" });
}

/** Every call the page made to any pricing endpoint. */
function pricingCalls() {
  return requestMock.mock.calls.filter((call) =>
    String(call[0]).includes("pricing"),
  );
}

async function rowOf(bookingNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(bookingNumber)).closest("tr") as HTMLElement;
}

/**
 * The eight pricing cells of a row, in column order.
 *
 * They are the LAST eight cells: the pricing columns are appended to the right
 * of every operational column so the ones an operator works in daily never move
 * when prices are shown.
 */
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

beforeEach(() => {
  requestMock.mockReset();
  // The language is stored, so a test that switches it must not leak into the
  // next one — every assertion here reads Dutch labels.
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("showing prices in Ritten", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([PRICED_TRIP, UNPRICED_TRIP]),
    });
  });

  it("hides the pricing columns until they are asked for", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    expect(toggle()).not.toBeChecked();
    expect(screen.queryByRole("columnheader", { name: "Tarief" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Totaal" })).toBeNull();
    // Not masked, not blank — absent.
    expect(screen.queryByText("480.50")).toBeNull();
    expect(screen.queryByText("******")).toBeNull();
  });

  it("shows the columns in the agreed order when ticked", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");

    await userEvent.click(toggle());

    const headers = await screen.findAllByRole("columnheader");
    const pricing = headers
      .map((header) => header.textContent)
      .filter((label) => PRICING_COLUMNS.includes(label ?? ""));

    expect(pricing).toEqual(PRICING_COLUMNS);
  });

  /**
   * TAR is an ordinary Custom Property and is already inside Others. A column
   * of its own would show the same twenty euros twice, in two places, and
   * invite somebody to add them up.
   */
  it("gives TAR no column of its own", async () => {
    renderRitten();
    await screen.findByText("ANRDUB2602247");
    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    expect(screen.queryByRole("columnheader", { name: "TAR" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Flat" })).toBeNull();
  });

  it("shows each amount the backend sent, in its own column", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRDUB2602247"));

    expect(cells[CELL.tarief]).toHaveTextContent("100.00");
    expect(cells[CELL.brandstof]).toHaveTextContent("15.00");
    expect(cells[CELL.backload]).toHaveTextContent("50.00");
    expect(cells[CELL.tol]).toHaveTextContent("12.50");
    expect(cells[CELL.tunnel]).toHaveTextContent("8.00");
    expect(cells[CELL.others]).toHaveTextContent("130.00");
    expect(cells[CELL.ek]).toHaveTextContent("165.00");
  });

  /**
   * The total is the backend's own figure. It is deliberately NOT the sum of
   * the columns beside it — here they add up to 480.50 only because the backend
   * says so, and the assertion is that the STRING was passed through.
   */
  it("shows the total the backend sent, never one added up here", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          id: "trip-odd",
          bookingNumber: "ANRDUB2602247",
          // The parts sum to 650.50; the backend's total says 651.25. The
          // backend's is the one that must appear.
          pricing: buildPricing({
            tarief: "450.00",
            brandstof: "67.50",
            backload: "50.00",
            tol: "12.50",
            tunnel: "8.00",
            others: "62.50",
            ek: "0.00",
            totaal: "651.25",
          }),
        }),
      ]),
    });

    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRDUB2602247"));

    expect(cells[CELL.totaal]).toHaveTextContent("651.25");
    expect(cells[CELL.totaal]).not.toHaveTextContent("650.50");
  });

  it("leaves an unpriced Trip's cells empty rather than zero", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRBEL2768902"));

    for (const cell of cells) {
      expect(cell).toHaveTextContent("—");
      expect(cell).not.toHaveTextContent("0.00");
    }
  });

  /** And offers nothing to correct: there is no breakdown to correct yet. */
  it("offers no editor on a Trip that has never been priced", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const cells = pricingCells(await rowOf("ANRBEL2768902"));

    for (const cell of cells) {
      expect(within(cell).queryAllByRole("button")).toHaveLength(0);
    }
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
    expect(screen.queryByText("480.50")).toBeNull();
  });
});

/**
 * ── NO PRICING REQUEST AT ALL ─────────────────────────────────────────────
 * The prices travel on the Trip, so the request count follows the LIST and
 * nothing else. A hundred rows cost what one row costs, because neither costs
 * anything: the amounts were already in the list response.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("what showing prices costs", () => {
  function pageOfPricedTrips(count: number) {
    return buildPage(
      Array.from({ length: count }, (_, index) =>
        buildTrip({
          id: `trip-${index}`,
          bookingNumber: `ANRDUB26${String(index).padStart(5, "0")}`,
          pricing: buildPricing(),
        }),
      ),
    );
  }

  it.each([1, 20, 100])(
    "asks for no pricing at all with %i Trips on screen",
    async (count) => {
      respondWith(requestMock, { trips: pageOfPricedTrips(count) });

      renderRitten();
      await screen.findByText("ANRDUB2600000");

      await userEvent.click(toggle());
      await screen.findByRole("columnheader", { name: "Totaal" });

      expect(pricingCalls()).toHaveLength(0);
    },
  );

  /** Showing prices must not price anything, and must write nothing. */
  it("prices nothing and writes nothing", async () => {
    respondWith(requestMock, { trips: pageOfPricedTrips(20) });

    renderRitten();
    await screen.findByText("ANRDUB2600000");

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
 * ── THREE EDITABLE, FIVE DERIVED ──────────────────────────────────────────
 * The distinction has to be visible without trying. A derived amount renders as
 * TEXT — not a disabled input, which would still say "this is a field, just not
 * right now" and invite somebody to look for the way to enable it.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("which amounts can be corrected", () => {
  beforeEach(() => {
    respondWith(requestMock, { trips: buildPage([PRICED_TRIP]) });
  });

  it.each([
    ["Tarief", "Tarief aanpassen"],
    ["Tol", "Tol aanpassen"],
    ["Tunnel", "Tunnel aanpassen"],
  ])("offers an editor for %s", async (_column, label) => {
    renderRitten();
    await userEvent.click(toggle());

    expect(await screen.findByRole("button", { name: label })).toBeEnabled();
  });

  it.each([
    ["Brandstof", CELL.brandstof],
    ["Backload", CELL.backload],
    ["Others", CELL.others],
    ["EK", CELL.ek],
    ["Totaal", CELL.totaal],
  ])("offers no control whatever for %s", async (_column, index) => {
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf("ANRDUB2602247"))[index];

    expect(within(cell).queryAllByRole("button")).toHaveLength(0);
    expect(within(cell).queryByRole("textbox")).toBeNull();
    expect(within(cell).queryByRole("spinbutton")).toBeNull();
    expect(within(cell).queryByRole("combobox")).toBeNull();
  });

  /** Not even a disabled one. A disabled field is still a field. */
  it("puts no disabled input behind a derived amount", async () => {
    renderRitten();
    await userEvent.click(toggle());

    const row = await rowOf("ANRDUB2602247");

    for (const index of [CELL.brandstof, CELL.backload, CELL.others, CELL.ek]) {
      expect(
        pricingCells(row)[index].querySelector("input,select,button"),
      ).toBeNull();
    }
  });
});

/**
 * ── A CORRECTED AMOUNT SAYS SO ────────────────────────────────────────────
 * Subtly: an operator must be able to see that a figure was typed rather than
 * calculated, and to put it back. Not a status system, not a badge — a mark on
 * the value and the action beside it.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("marking a manually corrected amount", () => {
  const CORRECTED = buildTrip({
    id: "trip-corrected",
    bookingNumber: "ANRDUB2602247",
    pricing: buildPricing({
      tarief: "120.00",
      overriddenComponents: ["BASE_PRICE"],
    }),
  });

  it("marks the corrected amount and says why on hover", async () => {
    respondWith(requestMock, { trips: buildPage([CORRECTED]) });
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf("ANRDUB2602247"))[CELL.tarief];

    expect(within(cell).getByTitle("Handmatig aangepast")).toHaveTextContent(
      "120.00",
    );
  });

  it("offers to put it back", async () => {
    respondWith(requestMock, { trips: buildPage([CORRECTED]) });
    renderRitten();
    await userEvent.click(toggle());

    expect(
      await screen.findByRole("button", {
        name: "Terug naar berekende waarde Tarief",
      }),
    ).toBeInTheDocument();
  });

  /** Nothing to withdraw where nothing was corrected. */
  it("offers no reset on a calculated amount", async () => {
    respondWith(requestMock, { trips: buildPage([CORRECTED]) });
    renderRitten();
    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    expect(
      screen.queryByRole("button", {
        name: "Terug naar berekende waarde Tol",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Terug naar berekende waarde Tunnel",
      }),
    ).toBeNull();
  });

  it("and none at all on a Trip nobody has corrected", async () => {
    respondWith(requestMock, { trips: buildPage([PRICED_TRIP]) });
    renderRitten();
    await userEvent.click(toggle());
    await screen.findByRole("columnheader", { name: "Totaal" });

    expect(
      screen.queryByRole("button", { name: /Terug naar berekende waarde/ }),
    ).toBeNull();
  });

  it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    respondWith(requestMock, { trips: buildPage([CORRECTED]) });
    renderRitten();
    await userEvent.click(toggle());

    const cell = pricingCells(await rowOf("ANRDUB2602247"))[CELL.tarief];

    expect(cell.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("is translated", async () => {
    respondWith(requestMock, { trips: buildPage([CORRECTED]) });
    renderRitten({ language: "tr" });
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Fiyatları göster" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Hesaplanan değere dön Tarife",
      }),
    ).toBeInTheDocument();
  });
});

/**
 * ── THE CONFIRMED COST, IN THE LIST ─────────────────────────────────────────
 * Eucon's confirmed amount is money, so it lives with the other money. What it
 * must never do is look like something the operator can change, or like the
 * waiting time they entered themselves.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the confirmed cost in Ritten", () => {
  const CONFIRMED = buildTrip({
    id: "trip-confirmed",
    bookingNumber: "ANRDUB2789089",
    costConfirmation: {
      id: "cc-1",
      ccNumber: "4132482",
      costCode: "WAIT",
      amount: "25.00",
      currency: "EUR",
      receivedAt: "2026-08-18T09:00:00.000Z",
      pdfDocumentId: "pdf-cc-1",
    },
  });

  /**
   * It does NOT follow the pricing toggle.
   *
   * A confirmation is the sender's answer to a waiting time the operator
   * reported, and it is checked while working the list — not only when prices
   * are turned on to look at margins. So the column is operational and always
   * there, while staying read-only.
   */
  it("stays visible while prices are hidden", async () => {
    respondWith(requestMock, { trips: buildPage([CONFIRMED]) });
    renderRitten();
    await screen.findByText("ANRDUB2789089");

    expect(screen.getByText("CC4132482")).toBeInTheDocument();
    expect(screen.getByText("25.00")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "CC" })).toBeInTheDocument();
  });

  /** And it costs no request of its own: it travels on the Trip. */
  it("asks the backend for nothing extra to show it", async () => {
    respondWith(requestMock, { trips: buildPage([CONFIRMED]) });
    renderRitten();
    await screen.findByText("CC4132482");

    expect(
      requestMock.mock.calls.filter(([path]) =>
        String(path).includes("cost-confirmation"),
      ),
    ).toHaveLength(0);
  });

  /** Beside the buttons, and never among the prices. */
  it("sits with the operational columns, not among the prices", async () => {
    respondWith(requestMock, { trips: buildPage([CONFIRMED]) });
    renderRitten();
    await screen.findByText("CC4132482");

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headers.indexOf("CC")).toBe(headers.indexOf("Acties") + 1);
    expect(headers).not.toContain("Tarief");
  });

  /**
   * Read-only still means read-only. The one control in the cell OPENS the
   * confirmation document; nothing there changes the number or the amount.
   */
  it("offers no control to change it", async () => {
    respondWith(requestMock, { trips: buildPage([CONFIRMED]) });
    renderRitten();
    const cell = (await screen.findByText("CC4132482")).closest(
      "td",
    ) as HTMLElement;

    expect(within(cell).getAllByRole("button")).toHaveLength(1);
    expect(
      within(cell).getByRole("button", {
        name: "Kostenbevestiging-PDF bekijken CC4132482",
      }),
    ).toBeInTheDocument();
    expect(within(cell).queryByRole("textbox")).toBeNull();
  });

  it("shows the empty marker for a Trip with nothing confirmed", async () => {
    respondWith(requestMock, { trips: buildPage([PRICED_TRIP]) });
    renderRitten();
    const row = await rowOf("ANRDUB2602247");

    expect(within(row).queryByText(/^CC/)).toBeNull();
  });
});
