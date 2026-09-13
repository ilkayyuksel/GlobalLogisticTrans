import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardPage from "./page";
import { ApiError } from "@/lib/api/client";
import {
  getCalendarRange,
  type CalendarEvent,
  type CalendarRange,
} from "@/lib/api/calendar-events";
import { uploadTransportOrderPdfs } from "@/lib/api/imports";
import {
  getDriverStatistics,
  type DriverStatistics,
} from "@/lib/api/driver-statistics";
import {
  getMaintenanceAttention,
  listMaintenance,
  type Maintenance,
} from "@/lib/api/maintenance";
import { type ListTripsParams, listTrips } from "@/lib/api/trips";
import type { Paginated, Trip } from "@/lib/api/types";
import { addDays, today } from "@/lib/calendar/calendar-dates";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/trips", () => ({
  ...jest.requireActual("@/lib/api/trips"),
  listTrips: jest.fn(),
}));

jest.mock("@/lib/api/imports", () => ({
  ...jest.requireActual("@/lib/api/imports"),
  uploadTransportOrderPdfs: jest.fn(),
}));

jest.mock("@/lib/api/maintenance", () => ({
  ...jest.requireActual("@/lib/api/maintenance"),
  listMaintenance: jest.fn(),
  getMaintenanceAttention: jest.fn(),
}));

jest.mock("@/lib/api/driver-statistics", () => ({
  ...jest.requireActual("@/lib/api/driver-statistics"),
  getDriverStatistics: jest.fn(),
}));

jest.mock("@/lib/api/calendar-events", () => ({
  ...jest.requireActual("@/lib/api/calendar-events"),
  getCalendarRange: jest.fn(),
}));

const listTripsMock = listTrips as jest.MockedFunction<typeof listTrips>;
const uploadMock = uploadTransportOrderPdfs as jest.MockedFunction<
  typeof uploadTransportOrderPdfs
>;
const listMaintenanceMock = listMaintenance as jest.MockedFunction<
  typeof listMaintenance
>;
const driverStatisticsMock = getDriverStatistics as jest.MockedFunction<
  typeof getDriverStatistics
>;
const attentionMock = getMaintenanceAttention as jest.MockedFunction<
  typeof getMaintenanceAttention
>;

const calendarRangeMock = getCalendarRange as jest.MockedFunction<
  typeof getCalendarRange
>;

/** The backend's top five, exactly as it answers. */
function attention(items: Maintenance[] = []) {
  return { today: "2026-09-14", items };
}

/** Today's Agenda, as the calendar's endpoint answers today to today. */
function agendaDay(items: CalendarEvent[] = []): CalendarRange {
  return { from: today(), to: today(), dayStart: "06:00", dayEnd: "23:00", items };
}

function agendaItem(
  id: string,
  title: string,
  start: string,
  end: string,
): CalendarEvent {
  return {
    id,
    title,
    date: today(),
    startTime: `${start}:00`,
    endTime: `${end}:00`,
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
  };
}

/** The windows come from the backend; the widget never works them out. */
const PERIOD: DriverStatistics["period"] = {
  today: "2026-08-20",
  weekStart: "2026-08-17",
  weekEnd: "2026-08-23",
  monthStart: "2026-08-01",
  monthEnd: "2026-08-31",
};

function driverStatistics(
  drivers: DriverStatistics["drivers"] = [],
): DriverStatistics {
  return { period: PERIOD, drivers };
}

function buildWarning(overrides: Partial<Maintenance> = {}): Maintenance {
  return {
    id: "maintenance-1",
    vehicleId: "vehicle-1",
    vehicle: {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      isActive: true,
    },
    status: "PLANNED",
    maintenanceType: "Onderhoud",
    maintenanceDate: "2026-09-10",
    description: "Grote beurt",
    mileage: 245000,
    cost: "1250.50",
    workshop: "Garage Peeters",
    nextMaintenanceDate: null,
    nextMaintenanceMileage: 275000,
    notes: null,
    urgency: { level: "OVERDUE", daysOverdue: 4 },
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

function maintenancePage(items: Maintenance[]) {
  return {
    items,
    meta: { page: 1, pageSize: 5, totalItems: items.length, totalPages: 1 },
  };
}

/**
 * The Dashboard.
 *
 * The figures are the backend's own counts, so the tests assert that the
 * queries asked for them and that the rendered numbers are exactly what came
 * back. Anything the backend cannot answer must render as unavailable — the
 * tests check that too, because an invented number here would be acted on.
 */

const VEHICLE = {
  id: "vehicle-1",
  licensePlate: "1-ABC-123",
  displayColor: "#2563eb",
  isActive: true,
};

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: VEHICLE.id,
    driverId: null,
    customProperties: [],
    direction: null,
    vehicle: VEHICLE,
    effectiveDriver: {
      id: "driver-1",
      name: "Piet Janssens",
      isActive: true,
      source: "VEHICLE_ASSIGNMENT",
      hasPhoneNumber: true,
    },
    latestUpdate: null,
    costConfirmation: null,
    pricing: null,
    reasonCode: null,
    route: null,
    status: "OPEN",
    isLooseTrip: false,
    isPaid: false,
    bookingNumber: "BK-2026-1001",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: "2026-08-14",
    planningDate: "2026-08-14",
    startTime: "08:00:00",
    endTime: "12:00:00",
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
  internalNotes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: Trip[], totalItems: number): Paginated<Trip> {
  return {
    items,
    meta: { page: 1, pageSize: 1, totalItems, totalPages: 1 },
  };
}

/**
 * Answers each dashboard query with its own total, so the tests can tell the
 * counts apart the way the backend does.
 */
function respondWithCounts(counts: {
  total: number;
  today: number;
  week: number;
  open: number;
  closed: number;
  recent?: Trip[];
}) {
  listTripsMock.mockImplementation((params: ListTripsParams = {}) => {
    if (params.status === "OPEN") return Promise.resolve(page([], counts.open));
    if (params.status === "CLOSED") return Promise.resolve(page([], counts.closed));
    if (params.planningDate) return Promise.resolve(page([], counts.today));
    if (params.planningDateFrom) return Promise.resolve(page([], counts.week));
    if (params.pageSize && params.pageSize > 1) {
      return Promise.resolve(page(counts.recent ?? [], counts.total));
    }

    return Promise.resolve(page([], counts.total));
  });
}

function renderDashboard() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <DashboardPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/**
 * Waits until the counts have loaded.
 *
 * A specific number is a poor barrier here: the same figure legitimately
 * appears in the statistics and again in the status widget.
 */
async function waitForCounts(): Promise<void> {
  await waitFor(() => {
    expect(
      within(statCard("Totaal ritten")).queryByRole("status"),
    ).not.toBeInTheDocument();
  });
}

/** The card carrying a given label. */
function statCard(label: string): HTMLElement {
  return screen.getByText(label).closest("section") as HTMLElement;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    listMaintenanceMock.mockReset();
    listMaintenanceMock.mockResolvedValue(maintenancePage([]));
    attentionMock.mockReset();
    attentionMock.mockResolvedValue(attention());
    driverStatisticsMock.mockReset();
    driverStatisticsMock.mockResolvedValue(driverStatistics());
    calendarRangeMock.mockReset();
    calendarRangeMock.mockResolvedValue(agendaDay());
    window.localStorage.clear();
    respondWithCounts({ total: 42, today: 3, week: 11, open: 7, closed: 30 });
  });

  describe("the page", () => {
    it("is titled for the product", async () => {
      renderDashboard();

      expect(
        await screen.findByRole("heading", { name: "TRANO Dashboard" }),
      ).toBeInTheDocument();
    });

    it("shows loading before the counts arrive", () => {
      listTripsMock.mockReturnValue(new Promise(() => undefined));

      renderDashboard();

      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    });
  });

  describe("the statistics", () => {
    it("shows the backend's totals", async () => {
      renderDashboard();

      await waitForCounts();

      expect(within(statCard("Totaal ritten")).getByText("42")).toBeInTheDocument();
      expect(within(statCard("Vandaag")).getByText("3")).toBeInTheDocument();
      expect(within(statCard("Deze week")).getByText("11")).toBeInTheDocument();
    });

    it("asks the backend to count rather than counting rows here", async () => {
      renderDashboard();

      await waitForCounts();

      // Every counting query asks for a single row and reads meta.totalItems.
      const counting = listTripsMock.mock.calls.filter(
        ([params]) => params?.pageSize === 1,
      );

      expect(counting.length).toBeGreaterThanOrEqual(5);
    });

    it("asks for today by exact planning date", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        listTripsMock.mock.calls.some(([p]) => Boolean(p?.planningDate)),
      ).toBe(true);
    });

    it("asks for the week as a date range", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        listTripsMock.mock.calls.some(
          ([p]) => Boolean(p?.planningDateFrom) && Boolean(p?.planningDateTo),
        ),
      ).toBe(true);
    });

    it("no longer shows an average waiting time", async () => {
      renderDashboard();

      await waitForCounts();

      expect(screen.queryByText("Gemiddelde wachttijd")).not.toBeInTheDocument();
    });

    /** The same Agenda widget, moved into the fourth place of the headline row. */
    it("puts the Agenda where the average waiting time was", async () => {
      renderDashboard();

      await waitForCounts();

      const headline = statCard("Totaal ritten").parentElement as HTMLElement;

      expect(headline.children).toHaveLength(4);
      expect(within(headline.children[3] as HTMLElement).getByText("Agenda vandaag")).toBeInTheDocument();
    });

    it("shows the Agenda once, not twice", async () => {
      renderDashboard();

      await waitForCounts();

      expect(screen.getAllByText("Agenda vandaag")).toHaveLength(1);
    });
  });

  describe("the trip status widget", () => {
    it("shows open, closed and total from the backend", async () => {
      renderDashboard();

      const widget = (await screen.findByText("Ritstatus")).closest(
        "section",
      ) as HTMLElement;

      expect(within(widget).getByText("7")).toBeInTheDocument();
      expect(within(widget).getByText("30")).toBeInTheDocument();
      expect(within(widget).getByText("42")).toBeInTheDocument();
    });

    it("links to all trips", async () => {
      renderDashboard();

      expect(
        await screen.findByRole("link", { name: /Bekijk alle ritten/ }),
      ).toHaveAttribute("href", "/trips");
    });

    it("reports a backend failure", async () => {
      listTripsMock.mockRejectedValue(
        new ApiError("INTERNAL_ERROR", "De database is niet bereikbaar.", 500),
      );

      renderDashboard();

      expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    });
  });

  describe("recent trips", () => {
    it("lists the latest trips with their details", async () => {
      respondWithCounts({
        total: 42,
        today: 3,
        week: 11,
        open: 7,
        closed: 30,
        recent: [buildTrip()],
      });

      renderDashboard();

      expect(await screen.findByText("BK-2026-1001")).toBeInTheDocument();
      expect(screen.getByText(/PSA Quay 869/)).toBeInTheDocument();
      expect(screen.getByText(/1-ABC-123/)).toBeInTheDocument();
      expect(screen.getByText(/Piet Janssens/)).toBeInTheDocument();
    });

    it("links each trip to its detail page", async () => {
      respondWithCounts({
        total: 1,
        today: 0,
        week: 0,
        open: 1,
        closed: 0,
        recent: [buildTrip()],
      });

      renderDashboard();

      expect(
        await screen.findByRole("link", { name: "BK-2026-1001" }),
      ).toHaveAttribute("href", "/trips/trip-1");
    });

    /** Vehicle and driver are embedded, so no request may be made per row. */
    it("makes no request per row", async () => {
      respondWithCounts({
        total: 3,
        today: 0,
        week: 0,
        open: 3,
        closed: 0,
        recent: [
          buildTrip({ id: "a" }),
          buildTrip({ id: "b", bookingNumber: "BK-B" }),
          buildTrip({ id: "c", bookingNumber: "BK-C" }),
        ],
      });

      renderDashboard();
      await screen.findByText("BK-C");

      // Five counts plus one list — never one per trip.
      expect(listTripsMock.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it("explains an empty list", async () => {
      respondWithCounts({ total: 0, today: 0, week: 0, open: 0, closed: 0, recent: [] });

      renderDashboard();

      expect(await screen.findByText("Nog geen ritten")).toBeInTheDocument();
    });
  });

  /**
   * ── TODAY'S AGENDA ──────────────────────────────────────────────────────────
   * The calendar's own day endpoint, asked for today, drawn by the calendar's
   * own grid. That the day query returns that one date and nothing of
   * yesterday or tomorrow is the backend's contract (see the repository spec);
   * here it is that the Dashboard asks for today only and shows what came back.
   * ────────────────────────────────────────────────────────────────────────────
   */
  describe("today's Agenda", () => {
    async function agendaSection(): Promise<HTMLElement> {
      return (await screen.findByText("Agenda vandaag")).closest(
        "section",
      ) as HTMLElement;
    }

    it("asks the calendar's endpoint for today to today, and nothing wider", async () => {
      renderDashboard();

      await agendaSection();
      await waitFor(() => expect(calendarRangeMock).toHaveBeenCalled());

      expect(calendarRangeMock.mock.calls.map(([from, to]) => [from, to])).toEqual([
        [today(), today()],
      ]);
    });

    /** Yesterday's and tomorrow's items are never drawn, even if they arrived. */
    it("shows only today's items", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([
          { ...agendaItem("y", "Gisteren-item", "09:00", "10:00"), date: addDays(today(), -1) },
          agendaItem("t", "Vandaag-item", "09:00", "10:00"),
          { ...agendaItem("m", "Morgen-item", "09:00", "10:00"), date: addDays(today(), 1) },
        ]),
      );

      renderDashboard();
      const section = await agendaSection();

      expect(
        await within(section).findByRole("link", { name: "Vandaag-item, 09:00–10:00" }),
      ).toBeInTheDocument();
      expect(within(section).queryByText("Gisteren-item")).not.toBeInTheDocument();
      expect(within(section).queryByText("Morgen-item")).not.toBeInTheDocument();
    });

    it("puts today's items in time order, whatever order they arrive in", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([
          agendaItem("late", "Telefoon", "13:30", "14:00"),
          agendaItem("early", "Vergadering", "09:00", "10:00"),
        ]),
      );

      renderDashboard();
      const section = await agendaSection();
      const items = await within(section).findAllByRole("link", { name: /, \d\d:\d\d–/ });

      expect(items.map((link) => link.getAttribute("aria-label"))).toEqual([
        "Vergadering, 09:00–10:00",
        "Telefoon, 13:30–14:00",
      ]);
    });

    it("draws no week: a single day, without day headings", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([agendaItem("a", "Vergadering", "09:00", "10:00")]),
      );

      renderDashboard();
      const section = await agendaSection();

      await within(section).findByRole("link", { name: "Vergadering, 09:00–10:00" });
      expect(
        within(section).getAllByRole("group").filter((group) => group.hasAttribute("aria-current")),
      ).toHaveLength(1);
      expect(within(section).queryByText("Weekagenda")).not.toBeInTheDocument();
    });

    it("shows today's items in time order, with their times, each linking to the calendar", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([
          agendaItem("a", "Vergadering", "09:00", "10:00"),
          agendaItem("b", "Telefoon", "13:30", "14:00"),
        ]),
      );

      renderDashboard();
      const section = await agendaSection();
      const items = await within(section).findAllByRole("link", { name: /, \d\d:\d\d–/ });

      expect(items.map((link) => link.getAttribute("aria-label"))).toEqual([
        "Vergadering, 09:00–10:00",
        "Telefoon, 13:30–14:00",
      ]);
      expect(items[0]).toHaveAttribute("href", `/calendar?date=${today()}&event=a`);
      expect(within(section).getByText("09:00–10:00")).toBeInTheDocument();
    });

    it("stands overlapping items side by side", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([
          agendaItem("a", "Vergadering", "10:00", "11:00"),
          agendaItem("b", "Telefoon", "10:30", "12:00"),
        ]),
      );

      renderDashboard();
      const section = await agendaSection();
      const first = (
        await within(section).findByRole("link", { name: "Vergadering, 10:00–11:00" })
      ).parentElement as HTMLElement;
      const second = within(section).getByRole("link", {
        name: "Telefoon, 10:30–12:00",
      }).parentElement as HTMLElement;

      expect([first.style.left, first.style.width]).toEqual(["0%", "50%"]);
      expect([second.style.left, second.style.width]).toEqual(["50%", "50%"]);
    });

    it("offers nothing to create: the Dashboard only shows", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([agendaItem("a", "Vergadering", "09:00", "10:00")]),
      );

      renderDashboard();
      const section = await agendaSection();

      await within(section).findByRole("link", { name: "Vergadering, 09:00–10:00" });
      expect(
        within(section).queryByRole("button", { name: /Nieuw agenda-item/ }),
      ).not.toBeInTheDocument();
    });

    it("says so when there is nothing today", async () => {
      renderDashboard();
      const section = await agendaSection();

      expect(
        await within(section).findByText("Geen agenda-items vandaag."),
      ).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: /Bekijk agenda/ })).toHaveAttribute(
        "href",
        "/calendar",
      );
    });

    it("shows a change made in the calendar on the next visit", async () => {
      calendarRangeMock.mockResolvedValue(
        agendaDay([agendaItem("a", "Vergadering", "09:00", "10:00")]),
      );
      const first = renderDashboard();

      await screen.findByRole("link", { name: "Vergadering, 09:00–10:00" });
      first.unmount();

      calendarRangeMock.mockResolvedValue(
        agendaDay([agendaItem("a", "Klantbezoek", "09:30", "10:00")]),
      );
      renderDashboard();

      expect(
        await screen.findByRole("link", { name: "Klantbezoek, 09:30–10:00" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Vergadering")).not.toBeInTheDocument();
    });
  });

  /**
   * ── THE MAINTENANCE SECTION ─────────────────────────────────────────────────
   * The backend chooses, orders and limits the list and labels every record;
   * the widget renders exactly that. So these tests feed backend answers and
   * assert that nothing is re-sorted, re-labelled or added.
   * ────────────────────────────────────────────────────────────────────────────
   */
  describe("the maintenance section", () => {
    async function section(): Promise<HTMLElement> {
      return (await screen.findByText("Onderhoudswaarschuwingen")).closest(
        "section",
      ) as HTMLElement;
    }

    /** The rows that open a record's details, in the order they are shown. */
    async function rows(): Promise<HTMLElement[]> {
      const widget = await section();

      await waitFor(() => {
        expect(within(widget).queryByRole("status")).not.toBeInTheDocument();
      });

      return within(widget)
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href")?.startsWith("/maintenance/"));
    }

    function item(
      id: string,
      plate: string,
      maintenanceDate: string,
      urgency: Maintenance["urgency"],
    ): Maintenance {
      return buildWarning({
        id,
        maintenanceDate,
        urgency,
        vehicle: { id: `v-${id}`, licensePlate: plate, displayColor: "#2563eb", isActive: true },
      });
    }

    const LATE_4 = item("late-4", "2 GAS 189", "2026-09-10", { level: "OVERDUE", daysOverdue: 4 });
    const LATE_2 = item("late-2", "2 GAS 723", "2026-09-12", { level: "OVERDUE", daysOverdue: 2 });
    const LATE_1 = item("late-1", "2 GAS 724", "2026-09-13", { level: "OVERDUE", daysOverdue: 1 });
    const TODAY = item("today", "2 GAS 725", "2026-09-14", { level: "TODAY", daysOverdue: 0 });
    const SOON = item("soon", "2 GAS 727", "2026-09-16", { level: "UPCOMING", daysOverdue: 0 });
    const LATER = item("later", "2 GAS 728", "2026-09-20", { level: "UPCOMING", daysOverdue: 0 });

    it("asks the backend for its top five, and nothing per row", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4, TODAY, SOON]));

      renderDashboard();
      await rows();

      expect(attentionMock).toHaveBeenCalledTimes(1);
      expect(listMaintenanceMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ dueOnly: true }),
        expect.anything(),
      );
    });

    it("shows nothing but a notice when nothing is planned", async () => {
      renderDashboard();

      expect(await rows()).toHaveLength(0);
      expect(await within(await section()).findByText("Geen gepland onderhoud")).toBeInTheDocument();
    });

    it("shows one late record as TE LAAT with its days", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4]));

      renderDashboard();
      const [row] = await rows();

      expect(row.textContent).toContain("TE LAAT — 4 dagen");
      expect(row.textContent).toContain("2 GAS 189");
      expect(row.textContent).toContain("10/09/2026");
      expect(row.textContent).toContain("Onderhoud");
    });

    it("says 1 dag, not 1 dagen", async () => {
      attentionMock.mockResolvedValue(attention([LATE_1]));

      renderDashboard();
      const [row] = await rows();

      expect(row.textContent).toContain("TE LAAT — 1 dag");
      expect(row.textContent).not.toContain("1 dagen");
    });

    it("shows several late records in the backend's order", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4, LATE_2, LATE_1]));

      renderDashboard();

      expect((await rows()).map((row) => row.getAttribute("href"))).toEqual([
        "/maintenance/late-4",
        "/maintenance/late-2",
        "/maintenance/late-1",
      ]);
    });

    it("shows today's maintenance as VANDAAG", async () => {
      attentionMock.mockResolvedValue(attention([TODAY]));

      renderDashboard();
      const [row] = await rows();

      expect(row.textContent).toContain("VANDAAG");
      expect(row.textContent).not.toContain("TE LAAT");
    });

    it("shows late, today and upcoming together, in that order", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4, LATE_2, TODAY, SOON, LATER]));

      renderDashboard();
      const shown = await rows();

      expect(
        shown.map(
          (row) => row.textContent?.match(/TE LAAT — \d+ dagen?|VANDAAG|GEPLAND/)?.[0],
        ),
      ).toEqual([
        "TE LAAT — 4 dagen",
        "TE LAAT — 2 dagen",
        "VANDAAG",
        "GEPLAND",
        "GEPLAND",
      ]);
    });

    /** Exactly five: the limit is the backend's, and the widget shows them all. */
    it("shows all five items the backend sends", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4, LATE_2, TODAY, SOON, LATER]));

      renderDashboard();

      expect(await rows()).toHaveLength(5);
    });

    it("never re-sorts what the backend sent", async () => {
      attentionMock.mockResolvedValue(attention([LATER, TODAY, LATE_4]));

      renderDashboard();

      expect((await rows()).map((row) => row.getAttribute("href"))).toEqual([
        "/maintenance/later",
        "/maintenance/today",
        "/maintenance/late-4",
      ]);
    });

    it("links every item to the record's details", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4]));

      renderDashboard();
      const [row] = await rows();

      expect(row).toHaveAttribute("href", "/maintenance/late-4");
    });

    it("makes TE LAAT the heaviest warning", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4, TODAY, SOON]));

      renderDashboard();
      const [late, today, soon] = await rows();

      expect(late.className).toContain("border-danger");
      expect(today.className).toContain("border-warning");
      expect(soon.className).not.toMatch(/border-(danger|warning)/);
    });

    it("reports a failed request", async () => {
      attentionMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderDashboard();
      const widget = await section();

      expect(
        await within(widget).findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
    });

    it("links to the full maintenance list", async () => {
      renderDashboard();
      const widget = await section();

      expect(
        within(widget).getByRole("link", { name: /Bekijk onderhoud/ }),
      ).toHaveAttribute("href", "/maintenance");
    });

    /** The kilometre notice is gone from the Dashboard, everywhere. */
    it("shows no kilometre notice anywhere", async () => {
      attentionMock.mockResolvedValue(attention([LATE_4]));

      renderDashboard();
      await rows();

      expect(document.body.textContent).not.toMatch(/Kilometerstand-waarschuwingen|huidige kilometerstand/);
    });
  });

  describe("in Turkish", () => {
    it("translates the dashboard", async () => {
      window.localStorage.setItem("tms.language", "tr");

      renderDashboard();

      expect(
        await screen.findByRole("heading", { name: "TRANO Panel" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Toplam sefer")).toBeInTheDocument();
      expect(screen.getByText("Sefer durumu")).toBeInTheDocument();
    });
  });
});

/**
 * The manual PDF upload.
 *
 * The API layer is the boundary under test: what the widget sends, and what it
 * shows for each answer. The backend reports per file, and these tests hold the
 * widget to that — one refused document must never hide a successful one, and a
 * failed request must never look like an import.
 */
describe("Dashboard PDF upload", () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    uploadMock.mockReset();
    listMaintenanceMock.mockReset();
    listMaintenanceMock.mockResolvedValue(maintenancePage([]));
    attentionMock.mockReset();
    attentionMock.mockResolvedValue(attention());
    driverStatisticsMock.mockResolvedValue(driverStatistics());
    calendarRangeMock.mockReset();
    calendarRangeMock.mockResolvedValue(agendaDay());
    window.localStorage.clear();
    respondWithCounts({ total: 0, today: 0, week: 0, open: 0, closed: 0, recent: [] });
  });

  function pdf(name = "order.pdf") {
    return new File(["%PDF-1.7"], name, { type: "application/pdf" });
  }

  function importedResult(filename: string, bookingNumber: string) {
    return {
      filename,
      ok: true,
      kind: "TRANSPORT_ORDER" as const,
      combination: false,
      trips: [buildTrip({ id: `trip-${bookingNumber}`, bookingNumber })],
    };
  }

  /** What the backend returns for an uploaded Cost Confirmation. */
  function costConfirmationResult(filename: string) {
    return {
      filename,
      ok: true,
      kind: "COST_CONFIRMATION" as const,
      combination: false,
      trips: [],
      costConfirmations: [
        {
          ccNumber: "4156173",
          bookingNumber: "ANRDUB2794719",
          tripId: "trip-cc",
          amount: "68.75",
          currency: "EUR",
          outcome: "RECORDED" as const,
        },
      ],
    };
  }

  async function choose(...selected: File[]): Promise<void> {
    await screen.findByText("PDF importeren");
    await userEvent.upload(screen.getByLabelText("Bestanden kiezen"), selected);
    await screen.findByText(selected[0].name);
  }

  function uploadButton(): HTMLElement {
    return screen.getByRole("button", { name: /^Uploaden/ });
  }

  describe("choosing files", () => {
    it("offers a drop area and a file picker", async () => {
      renderDashboard();

      expect(await screen.findByText("PDF importeren")).toBeInTheDocument();
      expect(screen.getByText("Sleep PDF-bestanden hierheen")).toBeInTheDocument();
      expect(screen.getByLabelText("Bestanden kiezen")).toBeInTheDocument();
    });

    it("accepts PDFs only, and several at once", async () => {
      renderDashboard();
      await screen.findByText("PDF importeren");

      const input = screen.getByLabelText("Bestanden kiezen");

      expect(input).toHaveAttribute("accept", expect.stringContaining("pdf"));
      expect(input).toHaveAttribute("multiple");
      expect(
        screen.getByText("Alleen PDF-bestanden worden geaccepteerd"),
      ).toBeInTheDocument();
    });

    it("lists a chosen file with its name and size", async () => {
      renderDashboard();
      await choose(pdf());

      expect(screen.getByText(/KB|MB/)).toBeInTheDocument();
      expect(screen.getByText(/Klaar om te versturen/)).toBeInTheDocument();
    });

    it("queues a dropped PDF", async () => {
      renderDashboard();
      const dropZone = (await screen.findByText("Sleep PDF-bestanden hierheen"))
        .parentElement as HTMLElement;

      fireEvent.drop(dropZone, { dataTransfer: { files: [pdf("dropped.pdf")] } });

      expect(await screen.findByText("dropped.pdf")).toBeInTheDocument();
    });

    /**
     * The picker already refuses non-PDFs through `accept`, so the only way one
     * arrives is a drag-and-drop — which `accept` does not filter.
     */
    it("marks a dropped non-PDF as skipped and never sends it", async () => {
      renderDashboard();
      const dropZone = (await screen.findByText("Sleep PDF-bestanden hierheen"))
        .parentElement as HTMLElement;

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [new File(["x"], "notes.txt", { type: "text/plain" })],
        },
      });

      expect(await screen.findByText(/Geen PDF/)).toBeInTheDocument();
      expect(uploadButton()).toBeDisabled();
    });

    it("removes a file from the list", async () => {
      renderDashboard();
      await choose(pdf());

      await userEvent.click(screen.getByRole("button", { name: "Verwijderen" }));

      await waitFor(() => {
        expect(screen.queryByText("order.pdf")).not.toBeInTheDocument();
      });
    });
  });

  describe("uploading", () => {
    it("sends the selected files to the backend", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      await waitFor(() => {
        expect(uploadMock).toHaveBeenCalledTimes(1);
      });
      expect(uploadMock.mock.calls[0][0]).toHaveLength(1);
      expect((uploadMock.mock.calls[0][0] as File[])[0].name).toBe("order.pdf");
    });

    it("shows that the upload is running, and blocks a second one", async () => {
      let release: (value: { results: [] }) => void = () => {};
      uploadMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("order.pdf")).closest(
        "li",
      ) as HTMLElement;

      await waitFor(() => {
        expect(row.textContent).toContain("Bezig met uploaden");
      });
      expect(
        screen.getByRole("button", { name: /Bezig met uploaden/ }),
      ).toBeDisabled();

      release({ results: [] });

      // A file the backend did not report on is offered again, never assumed
      // imported.
      await waitFor(() => {
        expect(uploadButton()).toBeEnabled();
      });
    });

    it("reports a successful import with its booking number", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/Rit geïmporteerd/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "ANRDUB2602247" }),
      ).toHaveAttribute("href", "/trips/trip-ANRDUB2602247");
    });

    /*
     * ── A COST CONFIRMATION IS NOT AN IMPORT ────────────────────────────────
     * It attaches a confirmed amount to a Trip that already exists and creates
     * none. Reporting it as "Rit geïmporteerd" — or as an import of zero Trips
     * — would tell the operator the opposite of what happened.
     */
    it("reports an uploaded Cost Confirmation as processed", async () => {
      uploadMock.mockResolvedValue({
        results: [costConfirmationResult("confirmation.pdf")],
      });

      renderDashboard();
      await choose(pdf("confirmation.pdf"));
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/Cost Confirmation verwerkt/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Rit geïmporteerd/)).not.toBeInTheDocument();
    });

    it("shows the confirmation's number, booking and amount", async () => {
      uploadMock.mockResolvedValue({
        results: [costConfirmationResult("confirmation.pdf")],
      });

      renderDashboard();
      await choose(pdf("confirmation.pdf"));
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("confirmation.pdf")).closest(
        "li",
      ) as HTMLElement;

      expect(row.textContent).toContain("CC4156173");
      expect(row.textContent).toContain("EUR 68.75");
      expect(
        within(row).getByRole("link", { name: "ANRDUB2794719" }),
      ).toHaveAttribute("href", "/trips/trip-cc");
    });

    /** The same confirmation again changed nothing, and says so. */
    it("marks a confirmation that was already recorded", async () => {
      const result = costConfirmationResult("confirmation.pdf");

      uploadMock.mockResolvedValue({
        results: [
          {
            ...result,
            costConfirmations: [
              { ...result.costConfirmations[0], outcome: "ALREADY_RECORDED" as const },
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf("confirmation.pdf"));
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("confirmation.pdf")).closest(
        "li",
      ) as HTMLElement;

      expect(row.textContent).toContain("al eerder verwerkt");
    });

    /** A refused confirmation shows the backend's own reason, as orders do. */
    it("shows the backend's reason when a confirmation is refused", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "confirmation.pdf",
            ok: false,
            kind: "COST_CONFIRMATION" as const,
            code: "IMPORT_COST_CONFIRMATION_REFUSED",
            message:
              'Cost confirmation "4156173" was not recorded: No Trip holds booking number ANRDUB2794719.',
          },
        ],
      });

      renderDashboard();
      await choose(pdf("confirmation.pdf"));
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/No Trip holds booking number/),
      ).toBeInTheDocument();
    });

    /*
     * A cancelled order creates no Trip. The row must say what happened rather
     * than report an import that did not occur.
     */
    it("reports a cancelled order as cancelled, not imported", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "cancelled.pdf",
            ok: true,
            kind: "TRANSPORT_ORDER" as const,
            combination: false,
            trips: [],
            cancellations: [
              { bookingNumber: "ANRBEL2772352", outcome: "CANCELLED" as const },
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/Geannuleerde order — rit geannuleerd/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Rit geïmporteerd/)).not.toBeInTheDocument();
    });

    it("says so when a cancellation matched no Trip", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "cancelled.pdf",
            ok: true,
            kind: "TRANSPORT_ORDER" as const,
            combination: false,
            trips: [],
            cancellations: [
              {
                bookingNumber: "ANRBEL2772352",
                outcome: "NO_MATCHING_TRIP" as const,
              },
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/geen bijbehorende rit/),
      ).toBeInTheDocument();
    });

    it("reports a Combination as one file that created two Trips", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: true,
            kind: "TRANSPORT_ORDER" as const,
            combination: true,
            trips: [
              buildTrip({ id: "trip-a", bookingNumber: "DUBANR2598395" }),
              buildTrip({ id: "trip-b", bookingNumber: "ANRBEL2603249" }),
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("order.pdf")).closest(
        "li",
      ) as HTMLElement;

      expect(row.textContent).toContain("Combinatie geïmporteerd");
      expect(row.textContent).toContain("2 ritten aangemaakt");
      expect(within(row).getAllByRole("link")).toHaveLength(2);
    });

    it("shows the backend's reason when a file is refused", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: false,
            kind: "TRANSPORT_ORDER" as const,
            code: "IMPORT_UNREADABLE_PDF",
            message: '"order.pdf" could not be parsed: no text layer.',
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(await screen.findByText(/Import mislukt/)).toBeInTheDocument();
      expect(screen.getByText(/no text layer/)).toBeInTheDocument();
    });

    /** The code identifies a failure; it is not what an operator should read. */
    it("does not put the error code in front of the operator", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: false,
            kind: "TRANSPORT_ORDER" as const,
            code: "IMPORT_UNREADABLE_PDF",
            message: "Dit document kon niet gelezen worden.",
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      await screen.findByText(/Import mislukt/);

      expect(document.body.textContent).not.toContain("IMPORT_UNREADABLE_PDF");
    });

    /** The whole point of per-file results. */
    it("shows a success and a failure in the same batch", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "broken.pdf",
            ok: false,
            kind: "TRANSPORT_ORDER" as const,
            code: "IMPORT_UNREADABLE_PDF",
            message: "Onleesbaar document.",
          },
          importedResult("good.pdf", "ANRDUB2602247"),
        ],
      });

      renderDashboard();
      await choose(pdf("broken.pdf"), pdf("good.pdf"));
      await userEvent.click(uploadButton());

      const failed = (await screen.findByText("broken.pdf")).closest(
        "li",
      ) as HTMLElement;
      const imported = screen.getByText("good.pdf").closest("li") as HTMLElement;

      expect(failed.textContent).toContain("Import mislukt");
      expect(imported.textContent).toContain("Rit geïmporteerd");
    });
  });

  describe("after a batch", () => {
    it("uploads a new file without resending the finished ones", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());
      await screen.findByText(/Rit geïmporteerd/);

      uploadMock.mockResolvedValue({
        results: [importedResult("second.pdf", "ANRBEL2603249")],
      });

      await userEvent.upload(
        screen.getByLabelText("Bestanden kiezen"),
        pdf("second.pdf"),
      );
      await userEvent.click(uploadButton());

      await waitFor(() => {
        expect(uploadMock).toHaveBeenCalledTimes(2);
      });
      expect(uploadMock.mock.calls[1][0]).toHaveLength(1);
      expect((uploadMock.mock.calls[1][0] as File[])[0].name).toBe("second.pdf");
    });

    it("clears the list on request", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());
      await screen.findByText(/Rit geïmporteerd/);

      await userEvent.click(screen.getByRole("button", { name: "Lijst wissen" }));

      await waitFor(() => {
        expect(screen.queryByText("order.pdf")).not.toBeInTheDocument();
      });
    });
  });

  describe("when the request itself fails", () => {
    /** Nothing was imported, so nothing may look imported. */
    it("reports the failure and offers the same files again", async () => {
      uploadMock.mockRejectedValue(
        new ApiError("PAYLOAD_TOO_LARGE", "Het bestand is te groot.", 413),
      );

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Uploaden is mislukt",
      );
      expect(screen.getByText(/te groot/)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/geïmporteerd/i);

      const row = screen.getByText("order.pdf").closest("li") as HTMLElement;

      expect(row.textContent).toContain("Klaar om te versturen");
      expect(uploadButton()).toBeEnabled();
    });
  });

  describe("presentation", () => {
    it("translates the whole widget", async () => {
      window.localStorage.setItem("tms.language", "tr");
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await screen.findByText("PDF içe aktar");
      await userEvent.upload(
        screen.getByLabelText("Dosya seç"),
        pdf(),
      );
      await userEvent.click(screen.getByRole("button", { name: /^Yükle/ }));

      expect(
        await screen.findByText(/Sefer içe aktarıldı/),
      ).toBeInTheDocument();
    });

    /** Colours come from the theme tokens, so both themes are already covered. */
    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      window.localStorage.setItem("tms.theme", theme);

      renderDashboard();
      await choose(pdf());

      const widget = screen.getByText("PDF importeren").closest(
        "section",
      ) as HTMLElement;

      expect(widget.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(widget.querySelector("[style]")).toBeNull();
    });
  });

  /** Parsing belongs to the server; the browser only holds file handles. */
  it("never reads the file contents", async () => {
    const readAsText = jest.spyOn(FileReader.prototype, "readAsText");
    const readAsArrayBuffer = jest.spyOn(
      FileReader.prototype,
      "readAsArrayBuffer",
    );
    uploadMock.mockResolvedValue({
      results: [importedResult("order.pdf", "ANRDUB2602247")],
    });

    renderDashboard();
    await choose(pdf());
    await userEvent.click(uploadButton());
    await screen.findByText(/Rit geïmporteerd/);

    expect(readAsText).not.toHaveBeenCalled();
    expect(readAsArrayBuffer).not.toHaveBeenCalled();

    readAsText.mockRestore();
    readAsArrayBuffer.mockRestore();
  });
});

