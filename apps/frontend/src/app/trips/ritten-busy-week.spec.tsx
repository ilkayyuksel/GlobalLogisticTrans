import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildTrip, renderRitten } from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { Trip, TripStatus } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-28",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * A WEEK THAT DOES NOT FIT ON ONE PAGE.
 *
 * ── THE REPORTED PRODUCTION CASE ────────────────────────────────────────────
 * Week 24–30 August 2026, as the operator sees it:
 *
 *     Alles       total 142   Monday   0   Tuesday 19
 *     Afgewerkt   total 113   Monday  16
 *
 * Monday's Trips exist — the status-specific filter shows sixteen of them — and
 * they vanish the moment the filter is widened. That is not a filter losing
 * rows: it is the LIST BEING ONE PAGE LONG while the section headings claim to
 * describe a whole week.
 *
 * ── WHY THE MOCK PAGES FOR REAL ─────────────────────────────────────────────
 * A mock that returned every matching Trip regardless of `page`/`pageSize`
 * would make this bug invisible, which is exactly how it survived the previous
 * round of tests. This one sorts the way the backend sorts — `planningDate`
 * DESCENDING, so Monday is the LAST row of the week — and then slices the page
 * it was asked for. Nothing here is more permissive than the real endpoint.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-08-24";
const TUESDAY = "2026-08-25";
const WEDNESDAY = "2026-08-26";
const THURSDAY = "2026-08-27";
const FRIDAY = "2026-08-28";
const SATURDAY = "2026-08-29";
const SUNDAY = "2026-08-30";

/**
 * 142 Trips over one week, shaped like the production week.
 *
 * Monday carries sixteen CLOSED Trips — the ones the operator can see under
 * "Afgewerkt" and cannot see under "Alles".
 */
function buildWeek(): Trip[] {
  const plan: [string, TripStatus, number][] = [
    [MONDAY, "CLOSED", 16],
    [TUESDAY, "CLOSED", 19],
    [WEDNESDAY, "CLOSED", 22],
    [THURSDAY, "CLOSED", 24],
    [FRIDAY, "CLOSED", 20],
    [SATURDAY, "CLOSED", 12],
    [FRIDAY, "OPEN", 14],
    [SATURDAY, "OPEN", 8],
    [SUNDAY, "OPEN", 6],
    [SUNDAY, "CANCELLED", 1],
  ];

  const trips: Trip[] = [];

  for (const [date, status, count] of plan) {
    for (let index = 0; index < count; index += 1) {
      const ordinal = String(trips.length + 1).padStart(4, "0");

      trips.push(
        buildTrip({
          id: `trip-${ordinal}`,
          bookingNumber: `ANRDUB26${ordinal}`,
          status,
          planningDate: date,
          originalPlanningDate: date,
        }),
      );
    }
  }

  return trips;
}

const WEEK = buildWeek();

/** The backend's own ordering: newest day first, so Monday is last. */
function ordered(status: unknown): Trip[] {
  const matching =
    status === undefined || status === null || status === ""
      ? [...WEEK]
      : WEEK.filter((trip) => trip.status === (status as TripStatus));

  return matching.sort((left, right) =>
    (right.planningDate as string).localeCompare(left.planningDate as string),
  );
}

/** Answers like the endpoint: filters, orders, then returns ONE page. */
function respondPaged(): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [
      string,
      { query?: Record<string, unknown> } | undefined,
    ];
    const query = options?.query ?? {};

    if (path === "/api/v1/trips") {
      const all = ordered(query.status);
      const pageSize = Number(query.pageSize ?? 50);
      const page = Number(query.page ?? 1);
      const start = (page - 1) * pageSize;

      return Promise.resolve({
        items: all.slice(start, start + pageSize),
        meta: {
          page,
          pageSize,
          totalItems: all.length,
          totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
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

async function chooseWeek(): Promise<void> {
  await userEvent.click(screen.getByRole("radio", { name: "Week" }));
  await waitFor(() => {
    expect(listQueries().at(-1)?.planningDateFrom).toBe(MONDAY);
  });
}

async function chooseStatus(name: string): Promise<void> {
  await userEvent.click(
    within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
      "radio",
      { name },
    ),
  );
}

function listQueries(): Record<string, unknown>[] {
  return requestMock.mock.calls
    .filter(([path]) => path === "/api/v1/trips")
    .map(
      ([, options]) =>
        (options as { query?: Record<string, unknown> } | undefined)?.query ??
        {},
    )
    .filter((query) => query.pageSize !== 1);
}

/** How many Trip rows a named day's section is rendering. */
function daySectionRows(heading: RegExp): number {
  const section = screen
    .getByRole("button", { name: heading })
    .closest("section") as HTMLElement;

  return within(section).queryAllByRole("row").length === 0
    ? 0
    : within(section)
        .getAllByRole("row")
        .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? "")).length;
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the reported production week, 24–30 August 2026", () => {
  /** The fixture is the reported week, exactly. */
  it("is 142 Trips, with 16 CLOSED on Monday and 19 on Tuesday", () => {
    expect(WEEK).toHaveLength(142);
    expect(
      WEEK.filter((t) => t.planningDate === MONDAY && t.status === "CLOSED"),
    ).toHaveLength(16);
    expect(WEEK.filter((t) => t.planningDate === TUESDAY)).toHaveLength(19);
    expect(WEEK.filter((t) => t.status === "CLOSED")).toHaveLength(113);
    expect(WEEK.filter((t) => t.status === "OPEN")).toHaveLength(28);
    expect(WEEK.filter((t) => t.status === "CANCELLED")).toHaveLength(1);
  });

  /**
   * THE BUG. Sixteen Trips are on Monday, the operator asked for everything,
   * and Monday renders empty — because the section was built from page one of
   * a two-page result and Monday sorts last.
   */
  it("shows Monday's Trips under Alles", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();

    await waitFor(() => expect(screen.queryAllByRole("table").length).toBeGreaterThan(0));

    expect(daySectionRows(/maandag/i)).toBe(16);
  });

  it("shows every day of the week under Alles", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();

    await waitFor(() => expect(screen.queryAllByRole("table").length).toBeGreaterThan(0));

    expect(daySectionRows(/maandag/i)).toBe(16);
    expect(daySectionRows(/dinsdag/i)).toBe(19);
    expect(daySectionRows(/woensdag/i)).toBe(22);
    expect(daySectionRows(/donderdag/i)).toBe(24);
  });

  /** Every qualifying Trip of the period, not merely the first page of them. */
  it("renders all 142 Trips of the period under Alles", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();

    await waitFor(() => expect(screen.queryAllByRole("table").length).toBeGreaterThan(0));

    const rendered = screen
      .getAllByRole("row")
      .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? ""));

    expect(rendered).toHaveLength(142);
  });

  it("still shows Monday under Afgewerkt", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();
    await chooseStatus("Afgewerkt");

    await waitFor(() => {
      expect(listQueries().at(-1)?.status).toBe("CLOSED");
    });

    expect(daySectionRows(/maandag/i)).toBe(16);
  });

  /**
   * The property the operator actually relies on: widening the filter may only
   * ever ADD rows. A Trip visible under a status must be visible under Alles.
   */
  it("makes Alles a true superset of Afgewerkt", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();
    await chooseStatus("Afgewerkt");
    await waitFor(() => expect(listQueries().at(-1)?.status).toBe("CLOSED"));

    const underStatus = screen
      .getAllByRole("row")
      .map((row) => row.textContent ?? "")
      .filter((text) => /ANRDUB26\d{4}/.test(text))
      .map((text) => (/ANRDUB26\d{4}/.exec(text) as RegExpExecArray)[0]);

    await chooseStatus("Alle");
    await waitFor(() => expect(listQueries().at(-1)?.status).toBeUndefined());

    const underAlles = new Set(
      screen
        .getAllByRole("row")
        .map((row) => row.textContent ?? "")
        .filter((text) => /ANRDUB26\d{4}/.test(text))
        .map((text) => (/ANRDUB26\d{4}/.exec(text) as RegExpExecArray)[0]),
    );

    const missing = underStatus.filter((booking) => !underAlles.has(booking));

    expect(missing).toEqual([]);
  });

  describe("how the pages are collected", () => {
    /** 142 Trips at 200 a page is ONE request — not one per day, not per Trip. */
    it("loads the week in a single request", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      const forThisWeek = listQueries().filter(
        (query) => query.planningDateFrom === MONDAY,
      );

      expect(forThisWeek).toHaveLength(1);
      expect(forThisWeek[0].pageSize).toBe(200);
    });

    it("asks for no page beyond the last", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      expect(
        listQueries().every((query) => Number(query.page ?? 1) <= 1),
      ).toBe(true);
    });

    /** A period is loaded whole, so a page control would offer page 2 of 1. */
    it("shows no pagination control for a week", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      // Queried as the pagination landmark: the week navigator has a
      // "Volgende" arrow of its own, and it is a different control.
      expect(screen.queryByRole("navigation", { name: "Pagina" })).toBeNull();
    });

    /** The notice described a partial list. A complete one must not show it. */
    it("shows no truncation notice once the week is complete", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      expect(screen.queryByText(/te veel ritten/i)).toBeNull();
      expect(screen.queryByText(/tonen alleen de ritten/i)).toBeNull();
    });
  });

  describe("every status filter covers the whole period", () => {
    it.each([
      ["Open", "OPEN", 28],
      ["Afgewerkt", "CLOSED", 113],
      ["Geannuleerd", "CANCELLED", 1],
    ])("shows all %s Trips of the week", async (label, status, expected) => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await chooseStatus(label);
      await waitFor(() => expect(listQueries().at(-1)?.status).toBe(status));

      await waitFor(() => {
        const rendered = screen
          .getAllByRole("row")
          .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? ""));

        expect(rendered).toHaveLength(expected);
      });
    });

    /** The reported case: Monday's sixteen, complete, under the status filter. */
    it("shows all sixteen of Monday's Trips under Afgewerkt", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await chooseStatus("Afgewerkt");
      await waitFor(() => expect(listQueries().at(-1)?.status).toBe("CLOSED"));

      await waitFor(() => expect(daySectionRows(/maandag/i)).toBe(16));
    });
  });

  describe("when the period cannot be loaded", () => {
    /**
     * Page one succeeds and page two fails. The week must NOT be shown as if
     * page one were all of it — a partial list that looks complete is the whole
     * bug, and relocating it would be worse than leaving it.
     */
    it("reports an error rather than showing page one as the week", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      // Now make the period arrive in two pages, the second of which fails.
      const settled = requestMock.getMockImplementation() as (
        path: string,
        options?: unknown,
      ) => Promise<unknown>;

      requestMock.mockImplementation(((
        path: string,
        options?: { query?: Record<string, unknown> },
      ): Promise<unknown> => {
        const query = options?.query ?? {};

        if (path === "/api/v1/trips" && query.pageSize === 200) {
          if (Number(query.page ?? 1) > 1) {
            return Promise.reject(new Error("page two failed"));
          }

          const all = ordered(query.status);

          return Promise.resolve({
            items: all.slice(0, 100),
            meta: { page: 1, pageSize: 100, totalItems: all.length, totalPages: 2 },
          });
        }

        return settled(path, options);
         
      }) as unknown as typeof request);

      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));
      await userEvent.click(screen.getByRole("radio", { name: "Week" }));

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

      expect(
        screen
          .queryAllByRole("row")
          .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? "")),
      ).toHaveLength(0);
    });

    /** Bounded: past the limit it refuses, and says so, instead of crawling. */
    it("refuses a period larger than the fetch limit", async () => {
      respondPaged();
      renderRitten();
      await chooseWeek();
      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      const settled = requestMock.getMockImplementation() as (
        path: string,
        options?: unknown,
      ) => Promise<unknown>;
      let periodRequests = 0;

      requestMock.mockImplementation(((
        path: string,
        options?: { query?: Record<string, unknown> },
      ): Promise<unknown> => {
        const query = options?.query ?? {};

        if (path === "/api/v1/trips" && query.pageSize === 200) {
          periodRequests += 1;

          return Promise.resolve({
            items: [],
            meta: { page: 1, pageSize: 200, totalItems: 6000, totalPages: 30 },
          });
        }

        return settled(path, options);
         
      }) as unknown as typeof request);

      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));
      await userEvent.click(screen.getByRole("radio", { name: "Week" }));

      expect(await screen.findByText(/te veel ritten/i)).toBeInTheDocument();

      // It reads the total once and refuses. It never starts the 30-page crawl.
      expect(periodRequests).toBeLessThanOrEqual(2);
    });
  });

  /** Selection is a Set of ids and must survive the period being reloaded. */
  it("keeps a selected Trip selected when the week reloads", async () => {
    respondPaged();
    renderRitten();
    await chooseWeek();
    await waitFor(() =>
      expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
    );

    const boxes = screen.getAllByRole("checkbox", { name: /selecteer rit/i });
    await userEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();

    await chooseStatus("Afgewerkt");
    await waitFor(() => expect(listQueries().at(-1)?.status).toBe("CLOSED"));
    await chooseStatus("Alle");
    await waitFor(() => expect(listQueries().at(-1)?.status).toBeUndefined());

    await waitFor(() => {
      expect(
        screen.getAllByRole("checkbox", { name: /selecteer rit/i })[0],
      ).toBeChecked();
    });
  });

  /**
   * ── THE MONTH HAS THE SAME PROMISE ────────────────────────────────────────
   * Its headings name the days of a month, so it must hold them. 142 Trips fit
   * in one request; this makes the period genuinely span several pages, so the
   * collecting loop itself is exercised rather than merely the single-page
   * happy path.
   */
  describe("month", () => {
    it("collects every page of a month that does not fit in one", async () => {
      respondPaged();
      renderRitten();
      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));

      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      const rendered = screen
        .getAllByRole("row")
        .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? ""));

      // August holds the whole fixture week, and all of it must be there.
      expect(rendered).toHaveLength(142);
      // The month heading names the date without the weekday.
      expect(daySectionRows(/24 augustus/i)).toBe(16);
    });

    it("requests the month with the bounded page size", async () => {
      respondPaged();
      renderRitten();
      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));

      await waitFor(() =>
        expect(screen.queryAllByRole("table").length).toBeGreaterThan(0),
      );

      const forMonth = listQueries().filter(
        (query) => query.planningDateFrom === "2026-08-01",
      );

      expect(forMonth.length).toBeGreaterThan(0);
      expect(forMonth.every((query) => query.pageSize === 200)).toBe(true);
    });

    /** Pages are collected one after another, never in a burst. */
    it("walks the pages in order when a month spans several", async () => {
      const requested: number[] = [];

      respondPaged();
      const settled = requestMock.getMockImplementation() as (
        path: string,
        options?: unknown,
      ) => Promise<unknown>;

      requestMock.mockImplementation(((
        path: string,
        options?: { query?: Record<string, unknown> },
      ): Promise<unknown> => {
        const query = options?.query ?? {};

        if (path === "/api/v1/trips" && query.pageSize === 200) {
          const page = Number(query.page ?? 1);
          requested.push(page);
          const all = ordered(query.status);
          const start = (page - 1) * 60;

          return Promise.resolve({
            items: all.slice(start, start + 60),
            meta: {
              page,
              pageSize: 60,
              totalItems: all.length,
              totalPages: Math.ceil(all.length / 60),
            },
          });
        }

        return settled(path, options);
         
      }) as unknown as typeof request);

      renderRitten();
      await userEvent.click(screen.getByRole("radio", { name: "Maand" }));

      await waitFor(() => {
        const rendered = screen
          .getAllByRole("row")
          .filter((row) => /ANRDUB26\d{4}/.test(row.textContent ?? ""));

        expect(rendered).toHaveLength(142);
      });

      // 142 over pages of 60 is three, asked for in order and no more.
      expect(requested).toEqual([1, 2, 3]);
    });
  });
});
