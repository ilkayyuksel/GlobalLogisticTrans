import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";
import { buildPricing, buildTrip, renderRitten } from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-28",
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Prices in the Week and Month views, which do not fit on one page.
 *
 * ── WHY THIS IS A SEPARATE CONCERN ──────────────────────────────────────────
 * A period is collected page by page — 200 Trips per request — and then shown
 * as one list. Pricing that had to be fetched separately would have to repeat
 * that paging, and getting it wrong is how a month ends up either missing its
 * prices or asking for them six hundred times.
 *
 * It cannot go wrong here, and these tests say why: the prices TRAVEL ON THE
 * TRIP. Every page of the period already carries the pricing of its own rows,
 * so a week of 300 Trips costs the two list requests it already cost, and a
 * month of 600 costs three. There is no pricing request to count because there
 * is none to make.
 *
 * ── AND THE PERIOD ITSELF MUST STILL BE WHOLE ───────────────────────────────
 * Monday sorts LAST — the backend orders `planningDate` descending — so it is
 * the day that disappears when only the first page is read. It is asserted
 * here with prices on, because that is the combination this phase changed.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";
const WEDNESDAY = "2026-08-26";
const THURSDAY = "2026-08-27";
const FRIDAY = "2026-08-28";
const SATURDAY = "2026-08-29";
const SUNDAY = "2026-08-30";

const WEEK_DAYS = [
  MONDAY,
  TUESDAY,
  WEDNESDAY,
  THURSDAY,
  FRIDAY,
  SATURDAY,
  SUNDAY,
];

/**
 * A week of `count` Trips, spread over its seven days.
 *
 * Every Trip is priced, and its Tarief encodes its ordinal, so an assertion can
 * name the exact row it expects and no two rows can be confused.
 */
function buildPeriod(count: number, days: readonly string[]): Trip[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, "0");

    return buildTrip({
      id: `trip-${ordinal}`,
      bookingNumber: `ANRDUB26${ordinal}`,
      status: "CLOSED",
      planningDate: days[index % days.length],
      originalPlanningDate: days[index % days.length],
      pricing: buildPricing({
        tarief: `${index + 1}.00`,
        totaal: `${index + 1000}.00`,
      }),
    });
  });
}

/** Answers like the endpoint: orders newest day first, then returns ONE page. */
function respondPaged(all: readonly Trip[]): void {
  const ordered = [...all].sort((left, right) =>
    (right.planningDate as string).localeCompare(left.planningDate as string),
  );

  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [
      string,
      { query?: Record<string, unknown> } | undefined,
    ];
    const query = options?.query ?? {};

    if (path === "/api/v1/trips" && query.pageSize !== 1) {
      const pageSize = Number(query.pageSize ?? 50);
      const page = Number(query.page ?? 1);
      const start = (page - 1) * pageSize;

      return Promise.resolve({
        items: ordered.slice(start, start + pageSize),
        meta: {
          page,
          pageSize,
          totalItems: ordered.length,
          totalPages: Math.max(1, Math.ceil(ordered.length / pageSize)),
        },
      });
    }

    if (path === "/api/v1/trips/terminals") {
      return Promise.resolve([]);
    }

    if (path === "/api/v1/whatsapp/status") {
      return Promise.resolve({ status: "DISABLED" });
    }

    return Promise.resolve({
      items: [],
      meta: { page: 1, pageSize: 200, totalItems: 0, totalPages: 1 },
    });
  });
}

/** The list requests that collected the period, ignoring the counters. */
function periodListCalls() {
  return requestMock.mock.calls.filter(
    ([path, options]) =>
      path === "/api/v1/trips" &&
      (options?.query as Record<string, unknown>)?.pageSize === 200,
  );
}

/** Every call to any pricing endpoint. There must never be one. */
function pricingCalls() {
  return requestMock.mock.calls.filter((call) =>
    String(call[0]).includes("pricing"),
  );
}

/**
 * Switches to a period view and turns the prices on.
 *
 * The Day view is where the page starts, and it shows only today — so this
 * waits for the VIEW SWITCHER rather than for a particular Trip, which may well
 * be planned on another day of the week.
 */
async function showPricesFor(view: "Week" | "Maand"): Promise<void> {
  renderRitten();

  await userEvent.click(await screen.findByRole("radio", { name: view }));
  await waitFor(() => expect(periodListCalls().length).toBeGreaterThan(0));

  await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));
  // One table PER DAY in a period view, so one heading per day section.
  await screen.findAllByRole("columnheader", { name: "Totaal" });
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("a week of 300 Trips", () => {
  beforeEach(() => {
    respondPaged(buildPeriod(300, WEEK_DAYS));
  });

  /** Two pages of 200, and that is the whole cost of the week. */
  it("collects the week in two list requests", async () => {
    await showPricesFor("Week");

    await waitFor(() => expect(periodListCalls()).toHaveLength(2));
    expect(
      periodListCalls().map(
        ([, options]) => (options?.query as Record<string, unknown>).page,
      ),
    ).toEqual([1, 2]);
  });

  it("asks for no pricing separately, for the period or for a row", async () => {
    await showPricesFor("Week");

    expect(pricingCalls()).toHaveLength(0);
  });

  /** Page one's rows carry their prices. */
  it("shows the pricing of a Trip from the first page", async () => {
    await showPricesFor("Week");

    const row = (await screen.findByText("ANRDUB260300")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getAllByRole("cell").slice(-1)[0]).toHaveTextContent(
      "1299.00",
    );
  });

  /**
   * And so do page two's — which is the half that a separately fetched pricing
   * read would have missed.
   */
  it("shows the pricing of a Trip from the second page", async () => {
    await showPricesFor("Week");

    const row = (await screen.findByText("ANRDUB260001")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getAllByRole("cell").slice(-1)[0]).toHaveTextContent(
      "1000.00",
    );
  });

  /** Monday sorts last, so it is the day a single page loses. */
  it("still shows Monday, with its prices", async () => {
    await showPricesFor("Week");

    const monday = await screen.findByRole("button", {
      name: /maandag 24 augustus/i,
    });
    const section = monday.closest("section") as HTMLElement;

    expect(within(section).getAllByRole("row").length).toBeGreaterThan(1);
    expect(
      within(section).getAllByRole("columnheader", { name: "Totaal" }),
    ).toHaveLength(1);
  });

  /**
   * The selection survives showing prices, which it must: an operator ticks
   * Trips across a week and then acts on them, and turning a column on is not
   * a reason to lose that work.
   */
  it("keeps a selection made before the prices were shown", async () => {
    renderRitten();

    await userEvent.click(await screen.findByRole("radio", { name: "Week" }));
    await waitFor(() => expect(periodListCalls().length).toBeGreaterThan(0));

    const row = (await screen.findByText("ANRDUB260001")).closest(
      "tr",
    ) as HTMLElement;
    const tick = within(row).getByRole("checkbox");

    await userEvent.click(tick);
    expect(tick).toBeChecked();

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Prijzen tonen" }),
    );
    await screen.findAllByRole("columnheader", { name: "Totaal" });

    const afterwards = (await screen.findByText("ANRDUB260001")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(afterwards).getByRole("checkbox")).toBeChecked();
  });
});

describe("a month of 600 Trips", () => {
  /** The whole of August, so the month view has every day to fill. */
  const AUGUST = Array.from({ length: 31 }, (_, index) =>
    `2026-08-${String(index + 1).padStart(2, "0")}`,
  );

  beforeEach(() => {
    respondPaged(buildPeriod(600, AUGUST));
  });

  it("collects the month in three list requests", async () => {
    await showPricesFor("Maand");

    await waitFor(() => expect(periodListCalls()).toHaveLength(3));
  });

  it("asks for no pricing separately", async () => {
    await showPricesFor("Maand");

    expect(pricingCalls()).toHaveLength(0);
  });

  it("shows the pricing of a Trip from the last page", async () => {
    await showPricesFor("Maand");

    const row = (await screen.findByText("ANRDUB260001")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getAllByRole("cell").slice(-1)[0]).toHaveTextContent(
      "1000.00",
    );
  });
});
