import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import {
  buildPage,
  buildPricing,
  buildTrip,
  mutationCalls,
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
 * Correcting a price from the Ritten list.
 *
 * ── WHAT A CORRECTION IS, AND WHAT IT IS NOT ────────────────────────────────
 * It is an override on ONE Trip. It is not a change to the route, not a change
 * to configuration, and not a change to any other Trip — which is why every
 * test here that edits Trip A also checks Trip B.
 *
 * ── WHERE THE NEW FIGURES COME FROM ─────────────────────────────────────────
 * From the backend, in the response to the correction itself. Raising a Tarief
 * moves Brandstof and Totaal with it, and NONE of that is computed here: the
 * endpoint answers with the whole recalculated breakdown and the row is redrawn
 * from it. So these tests deliberately return figures the browser could not
 * have derived, and then assert that they appear.
 *
 * ── AND WHAT MUST NOT HAPPEN ────────────────────────────────────────────────
 * No refetch of the list. The operator keeps their filters, their selection and
 * their place in a long day.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP_A_ID = "trip-a";
const TRIP_B_ID = "trip-b";
const BOOKING_A = "ANRDUB2602247";
const BOOKING_B = "ANRBEL2768902";

/** Trip A: the one every test edits. Tarief 100, Brandstof 15 — a 15% rate. */
function tripA() {
  return buildTrip({
    id: TRIP_A_ID,
    bookingNumber: BOOKING_A,
    status: "CLOSED",
    pricing: buildPricing({
      tarief: "100.00",
      brandstof: "15.00",
      backload: "0.00",
      tol: "10.00",
      tunnel: "10.00",
      others: "20.00",
      ek: "0.00",
      totaal: "155.00",
    }),
  });
}

/** Trip B: the control. Every amount differs from A's, so a leak is visible. */
function tripB() {
  return buildTrip({
    id: TRIP_B_ID,
    bookingNumber: BOOKING_B,
    status: "CLOSED",
    pricing: buildPricing({
      tarief: "200.00",
      brandstof: "30.00",
      backload: "0.00",
      tol: "40.00",
      tunnel: "45.00",
      others: "60.00",
      ek: "70.00",
      totaal: "445.00",
    }),
  });
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

async function rowOf(bookingNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(bookingNumber)).closest("tr") as HTMLElement;
}

function pricingCells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell").slice(-8);
}

async function cellsOf(bookingNumber: string): Promise<HTMLElement[]> {
  return pricingCells(await rowOf(bookingNumber));
}

/** Shows the pricing columns and waits for them to be on screen. */
async function showPrices(): Promise<void> {
  renderRitten();
  await screen.findByText(BOOKING_A);
  await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));
  await screen.findByRole("columnheader", { name: "Totaal" });
}

/**
 * Opens an amount, types a new one, and saves it.
 *
 * Scoped to a ROW. Every row labels its editors the same way — the row is what
 * tells an operator which Trip they are in — so a page-wide query would find
 * one per Trip and could not say which it had opened.
 */
async function correct(
  booking: string,
  label: string,
  amount: string,
): Promise<void> {
  const row = within(await rowOf(booking));

  await userEvent.click(row.getByRole("button", { name: label }));

  const input = row.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, amount);
  await userEvent.click(row.getByRole("button", { name: "Opslaan" }));
}

/** Every request the page made to the list endpoint. */
function listCallCount(): number {
  return requestMock.mock.calls.filter(
    ([path, options]) =>
      path === "/api/v1/trips" &&
      (options?.query as Record<string, unknown>)?.pageSize !== 1,
  ).length;
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("correcting the Tarief", () => {
  /**
   * 100 -> 120, and the fuel follows it: 15 -> 18, because Brandstof is a
   * percentage of the EFFECTIVE Tarief. The 18.00 comes from the backend; there
   * is nothing on this side that knows the rate.
   */
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([tripA(), tripB()]),
      onPricingOverride: ({ tripId, componentCode, amount }) => {
        if (tripId !== TRIP_A_ID || componentCode !== "BASE_PRICE") {
          return null;
        }

        return buildPricing({
          tarief: `${amount?.toFixed(2)}`,
          brandstof: "18.00",
          backload: "0.00",
          tol: "10.00",
          tunnel: "10.00",
          others: "20.00",
          ek: "0.00",
          totaal: "178.00",
          overriddenComponents: ["BASE_PRICE"],
        });
      },
    });
  });

  it("shows the corrected Tarief", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.tarief]).toHaveTextContent(
        "120.00",
      );
    });
  });

  it("moves Brandstof with it, as the backend recalculated it", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.brandstof]).toHaveTextContent(
        "18.00",
      );
    });
  });

  it("moves the Totaal with it", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.totaal]).toHaveTextContent(
        "178.00",
      );
    });
  });

  it("marks the amount as manually corrected afterwards", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    await waitFor(async () => {
      expect(
        within(await rowOf(BOOKING_A)).getByRole("button", {
          name: "Terug naar berekende waarde Tarief",
        }),
      ).toBeInTheDocument();
    });
  });

  /** One Trip, one component, one request. */
  it("sends exactly one correction, for this Trip and this component", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    const [path, options] = mutationCalls(requestMock)[0];

    expect(path).toBe(`/api/v1/trip-pricing/trip/${TRIP_A_ID}/overrides`);
    expect(options?.method).toBe("PUT");
    expect(options?.body).toEqual({ componentCode: "BASE_PRICE", amount: 120 });
  });

  /** Nothing else on the page moved. */
  it("leaves every other Trip exactly as it was", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.tarief]).toHaveTextContent(
        "120.00",
      );
    });

    const other = await cellsOf(BOOKING_B);

    expect(other[CELL.tarief]).toHaveTextContent("200.00");
    expect(other[CELL.brandstof]).toHaveTextContent("30.00");
    expect(other[CELL.totaal]).toHaveTextContent("445.00");
  });

  /**
   * The list is NOT refetched. The correction's own answer described the whole
   * row, so asking again would throw away an answer already in hand — and would
   * move every other row while somebody was working through them.
   */
  it("does not refetch the list", async () => {
    await showPrices();
    const before = listCallCount();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    expect(listCallCount()).toBe(before);
  });

  /** It touches no route and no global configuration. */
  it("writes to nothing but the Trip's own overrides", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    for (const [path] of mutationCalls(requestMock)) {
      expect(path).toContain("/overrides");
      expect(path).not.toContain("route");
      expect(path).not.toContain("settings");
      expect(path).not.toContain("reprocess");
    }
  });
});

describe.each([
  ["Tol", "Tol aanpassen", "TOLL", CELL.tol],
  ["Tunnel", "Tunnel aanpassen", "TUNNEL", CELL.tunnel],
])("correcting the %s", (_column, label, componentCode, index) => {
  /**
   * 10 -> 25, and nothing else moves but the Total. Neither Toll nor Tunnel
   * feeds any other component, so the backend's answer here changes exactly two
   * figures — which is what the row must show.
   */
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([tripA(), tripB()]),
      onPricingOverride: (correction) => {
        if (correction.tripId !== TRIP_A_ID) {
          return null;
        }

        return buildPricing({
          tarief: "100.00",
          brandstof: "15.00",
          backload: "0.00",
          tol: componentCode === "TOLL" ? "25.00" : "10.00",
          tunnel: componentCode === "TUNNEL" ? "25.00" : "10.00",
          others: "20.00",
          ek: "0.00",
          totaal: "170.00",
          overriddenComponents: [componentCode],
        });
      },
    });
  });

  it("shows the corrected amount", async () => {
    await showPrices();

    await correct(BOOKING_A, label, "25");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[index]).toHaveTextContent("25.00");
    });
  });

  it("moves the Totaal and nothing else", async () => {
    await showPrices();

    await correct(BOOKING_A, label, "25");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.totaal]).toHaveTextContent(
        "170.00",
      );
    });

    const cells = await cellsOf(BOOKING_A);

    expect(cells[CELL.tarief]).toHaveTextContent("100.00");
    expect(cells[CELL.brandstof]).toHaveTextContent("15.00");
    expect(cells[CELL.others]).toHaveTextContent("20.00");
  });

  it("names the right component in the request", async () => {
    await showPrices();

    await correct(BOOKING_A, label, "25");

    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    expect(mutationCalls(requestMock)[0][1]?.body).toEqual({
      componentCode,
      amount: 25,
    });
  });

  it("leaves the other Trip alone", async () => {
    await showPrices();

    await correct(BOOKING_A, label, "25");
    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[index]).toHaveTextContent("25.00");
    });

    const other = await cellsOf(BOOKING_B);

    expect(other[CELL.tol]).toHaveTextContent("40.00");
    expect(other[CELL.tunnel]).toHaveTextContent("45.00");
    expect(other[CELL.totaal]).toHaveTextContent("445.00");
  });
});

/**
 * ── WITHDRAWING A CORRECTION ──────────────────────────────────────────────
 * Reset is its own operation, never a save of an empty field. An empty box is
 * indistinguishable from zero, and zero is a legitimate amount — a Trip
 * genuinely without toll. Conflating the two would make 0.00 impossible to
 * enter and every cleared field ambiguous.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe.each([
  ["Tarief", "BASE_PRICE", CELL.tarief, "120.00", "100.00"],
  ["Tol", "TOLL", CELL.tol, "25.00", "10.00"],
  ["Tunnel", "TUNNEL", CELL.tunnel, "25.00", "10.00"],
])(
  "withdrawing a correction on %s",
  (column, componentCode, index, corrected, calculated) => {
    /** The Trip arrives already corrected; the test puts it back. */
    function correctedTrip() {
      return buildTrip({
        id: TRIP_A_ID,
        bookingNumber: BOOKING_A,
        status: "CLOSED",
        pricing: buildPricing({
          tarief: componentCode === "BASE_PRICE" ? corrected : "100.00",
          // The fuel of the CORRECTED tarief: 120 at 15%.
          brandstof: componentCode === "BASE_PRICE" ? "18.00" : "15.00",
          backload: "0.00",
          tol: componentCode === "TOLL" ? corrected : "10.00",
          tunnel: componentCode === "TUNNEL" ? corrected : "10.00",
          others: "20.00",
          ek: "0.00",
          totaal: "178.00",
          overriddenComponents: [componentCode],
        }),
      });
    }

    beforeEach(() => {
      respondWith(requestMock, {
        trips: buildPage([correctedTrip(), tripB()]),
        // The engine's own figures, which is what a withdrawal restores.
        onPricingOverride: () =>
          buildPricing({
            tarief: "100.00",
            brandstof: "15.00",
            backload: "0.00",
            tol: "10.00",
            tunnel: "10.00",
            others: "20.00",
            ek: "0.00",
            totaal: "155.00",
          }),
      });
    });

    async function withdraw(): Promise<void> {
      await userEvent.click(
        within(await rowOf(BOOKING_A)).getByRole("button", {
          name: `Terug naar berekende waarde ${column}`,
        }),
      );
    }

    it("returns the amount to the calculated figure", async () => {
      await showPrices();
      expect((await cellsOf(BOOKING_A))[index]).toHaveTextContent(corrected);

      await withdraw();

      await waitFor(async () => {
        expect((await cellsOf(BOOKING_A))[index]).toHaveTextContent(calculated);
      });
    });

    it("recalculates what followed from it", async () => {
      await showPrices();

      await withdraw();

      await waitFor(async () => {
        expect((await cellsOf(BOOKING_A))[CELL.brandstof]).toHaveTextContent(
          "15.00",
        );
      });
      expect((await cellsOf(BOOKING_A))[CELL.totaal]).toHaveTextContent(
        "155.00",
      );
    });

    it("takes the correction mark away with it", async () => {
      await showPrices();

      await withdraw();

      await waitFor(async () => {
        expect(
          within(await rowOf(BOOKING_A)).queryByRole("button", {
            name: `Terug naar berekende waarde ${column}`,
          }),
        ).toBeNull();
      });
    });

    it("asks for a withdrawal, not a save of nothing", async () => {
      await showPrices();

      await withdraw();

      await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

      const [path, options] = mutationCalls(requestMock)[0];

      expect(options?.method).toBe("DELETE");
      expect(path).toBe(
        `/api/v1/trip-pricing/trip/${TRIP_A_ID}/overrides/${componentCode}`,
      );
      expect(options?.body).toBeUndefined();
    });

    /** No dialog. The action is small, visible, and undone by typing again. */
    it("asks for no confirmation", async () => {
      await showPrices();

      await withdraw();

      await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not refetch the list", async () => {
      await showPrices();
      const before = listCallCount();

      await withdraw();
      await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

      expect(listCallCount()).toBe(before);
    });
  },
);

/**
 * ── ZERO IS A PRICE ───────────────────────────────────────────────────────
 * A Trip genuinely without toll costs 0.00, and an operator must be able to say
 * so. Saving zero is a correction like any other — it is stored, it is marked,
 * and it is emphatically NOT a withdrawal.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("correcting an amount to zero", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([tripA()]),
      onPricingOverride: () =>
        buildPricing({
          tarief: "100.00",
          brandstof: "15.00",
          backload: "0.00",
          tol: "0.00",
          tunnel: "10.00",
          others: "20.00",
          ek: "0.00",
          totaal: "145.00",
          overriddenComponents: ["TOLL"],
        }),
    });
  });

  it("saves it as an amount rather than treating it as a reset", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tol aanpassen", "0");

    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    const [, options] = mutationCalls(requestMock)[0];

    expect(options?.method).toBe("PUT");
    expect(options?.body).toEqual({ componentCode: "TOLL", amount: 0 });
  });

  it("shows 0.00 and marks it as corrected", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tol aanpassen", "0");

    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.tol]).toHaveTextContent("0.00");
    });
    expect(
      within(await rowOf(BOOKING_A)).getByRole("button", {
        name: "Terug naar berekende waarde Tol",
      }),
    ).toBeInTheDocument();
  });
});

/**
 * ── ONE SAVE PER SAVE ─────────────────────────────────────────────────────
 * A double click must not become two writes, and one row saving must not stop
 * anybody working in another. The saving state is per FIELD, not per table.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("while a correction is in flight", () => {
  /** A correction that does not resolve until the test lets it. */
  function respondSlowly(): { release: () => void } {
    let release = (): void => {};
    const pending = new Promise((resolve) => {
      release = () =>
        resolve(
          buildPricing({ tarief: "120.00", overriddenComponents: ["BASE_PRICE"] }),
        );
    });

    respondWith(requestMock, { trips: buildPage([tripA(), tripB()]) });

    const answerNormally = requestMock.getMockImplementation() as (
      ...args: unknown[]
    ) => Promise<unknown>;

    requestMock.mockImplementation((...args: unknown[]) => {
      const [path, options] = args as [string, { method?: string } | undefined];

      if (path.includes("/overrides") && (options?.method ?? "GET") !== "GET") {
        return pending;
      }

      return answerNormally(...args);
    });

    return { release };
  }

  it("does not send a second write when the button is clicked twice", async () => {
    const { release } = respondSlowly();
    await showPrices();

    const row = within(await rowOf(BOOKING_A));

    await userEvent.click(row.getByRole("button", { name: "Tarief aanpassen" }));
    const input = row.getByLabelText("Tarief aanpassen");
    await userEvent.clear(input);
    await userEvent.type(input, "120");

    const save = row.getByRole("button", { name: "Opslaan" });
    await userEvent.click(save);
    await userEvent.click(save);

    expect(mutationCalls(requestMock)).toHaveLength(1);

    release();
    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.tarief]).toHaveTextContent(
        "120.00",
      );
    });
  });

  /** The rest of the table stays usable. Nothing is locked but that field. */
  it("leaves the other rows editable", async () => {
    respondSlowly();
    await showPrices();

    const editing = within(await rowOf(BOOKING_A));

    await userEvent.click(
      editing.getByRole("button", { name: "Tarief aanpassen" }),
    );
    const input = editing.getByLabelText("Tarief aanpassen");
    await userEvent.clear(input);
    await userEvent.type(input, "120");
    await userEvent.click(editing.getByRole("button", { name: "Opslaan" }));

    // Trip B's editors are untouched — there are still three of them, enabled.
    const other = within(await rowOf(BOOKING_B));

    expect(other.getByRole("button", { name: "Tarief aanpassen" })).toBeEnabled();
    expect(other.getByRole("button", { name: "Tol aanpassen" })).toBeEnabled();
    expect(
      other.getByRole("button", { name: "Tunnel aanpassen" }),
    ).toBeEnabled();
  });
});

/**
 * ── A REFUSED CORRECTION ──────────────────────────────────────────────────
 * The persisted amount stays on screen. Nothing was painted before the backend
 * answered, so there is nothing to roll back — and the reason appears beside
 * the field it is about, in the backend's own words.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("when a correction is refused", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([tripA(), tripB()]),
      pricingOverrideFailureMessage:
        "Het bedrag mag niet meer dan twee decimalen hebben.",
    });
  });

  it("says why, in the backend's own words", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Het bedrag mag niet meer dan twee decimalen hebben.",
    );
  });

  /**
   * Nothing was persisted, so nothing that DEPENDS on the amount moved either.
   * Brandstof and Totaal are outside the open editor and are checked straight
   * away: if the row had been painted optimistically, they would already show
   * the figures of a correction that never happened.
   */
  it("moves nothing that followed from the amount", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await screen.findByRole("alert");

    const cells = await cellsOf(BOOKING_A);

    expect(cells[CELL.brandstof]).toHaveTextContent("15.00");
    expect(cells[CELL.totaal]).toHaveTextContent("155.00");
    expect(cells[CELL.brandstof]).not.toHaveTextContent("18.00");
  });

  /**
   * And the persisted amount is what the cell returns to.
   *
   * While the editor is open it shows what was TYPED — that is what makes the
   * refusal correctable rather than merely reported. Closing it reveals the
   * amount that is actually stored, which never changed.
   */
  it("returns to the persisted amount when the editor is closed", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await screen.findByRole("alert");

    await userEvent.click(
      within(await rowOf(BOOKING_A)).getByRole("button", { name: "Annuleren" }),
    );

    const cells = await cellsOf(BOOKING_A);

    expect(cells[CELL.tarief]).toHaveTextContent("100.00");
    expect(cells[CELL.tarief]).not.toHaveTextContent("120.00");
  });

  /** A refusal leaves no correction mark: nothing was corrected. */
  it("does not mark the amount as corrected", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await screen.findByRole("alert");

    expect(
      within(await rowOf(BOOKING_A)).queryByRole("button", {
        name: "Terug naar berekende waarde Tarief",
      }),
    ).toBeNull();
  });

  /** The editor stays open with what was typed, so it can be corrected. */
  it("keeps the attempted value in the open editor", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await screen.findByRole("alert");

    expect(
      within(await rowOf(BOOKING_A)).getByLabelText("Tarief aanpassen"),
    ).toHaveValue(120);
  });

  it("reloads nothing and changes no other row", async () => {
    await showPrices();
    const before = listCallCount();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await screen.findByRole("alert");

    expect(listCallCount()).toBe(before);
    expect((await cellsOf(BOOKING_B))[CELL.totaal]).toHaveTextContent("445.00");
  });
});

/**
 * ── A CORRECTION IS NOT A LIFECYCLE EVENT ─────────────────────────────────
 * CLOSED is terminal. Pricing is mostly looked at on CLOSED Trips, so the one
 * thing a price correction must never do is put one back into the planning.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe("correcting the price of a CLOSED Trip", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([tripA()]),
      onPricingOverride: () =>
        buildPricing({ tarief: "120.00", overriddenComponents: ["BASE_PRICE"] }),
    });
  });

  it("asks for no status change of any kind", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await waitFor(() => expect(mutationCalls(requestMock)).toHaveLength(1));

    for (const [path] of mutationCalls(requestMock)) {
      expect(path).not.toContain("/status");
      expect(path).not.toContain("/restoration");
      expect(path).not.toContain("/deletion");
    }
  });

  it("leaves the Trip CLOSED on screen", async () => {
    await showPrices();

    await correct(BOOKING_A, "Tarief aanpassen", "120");
    await waitFor(async () => {
      expect((await cellsOf(BOOKING_A))[CELL.tarief]).toHaveTextContent(
        "120.00",
      );
    });

    expect(within(await rowOf(BOOKING_A)).getByText("Afgewerkt")).toBeInTheDocument();
  });
});
