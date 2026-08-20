import { render, screen, within } from "@testing-library/react";

import { DriverStatisticsWidget } from "./driver-statistics";
import { request } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Trips per driver, on the Dashboard.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * That the browser does none of the work. Every count and every window comes
 * from one backend call: no request per driver, no Trip list tallied here, and
 * no assignment resolved on this side. A widget that counted for itself would
 * quietly disagree with the Ritten list it summarises.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PERIOD = {
  today: "2026-08-20",
  weekStart: "2026-08-17",
  weekEnd: "2026-08-23",
  monthStart: "2026-08-01",
  monthEnd: "2026-08-31",
};

const DRIVERS = [
  {
    driverId: "driver-1",
    driverName: "Piet Janssens",
    isActive: true,
    today: 2,
    week: 8,
    month: 31,
  },
  {
    driverId: "driver-2",
    driverName: "Ahmet Yilmaz",
    isActive: true,
    today: 1,
    week: 5,
    month: 19,
  },
];

function respondWith(drivers: unknown[] = DRIVERS): void {
  requestMock.mockResolvedValue({ period: PERIOD, drivers } as never);
}

function renderWidget() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <DriverStatisticsWidget />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** The row a driver's name sits in. */
async function rowFor(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);

  return cell.closest("tr") as HTMLElement;
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  respondWith();
});

describe("the driver statistics widget", () => {
  it("shows each driver's counts for today, this week and this month", async () => {
    renderWidget();

    const piet = within(await rowFor("Piet Janssens"));

    expect(piet.getByText("2")).toBeInTheDocument();
    expect(piet.getByText("8")).toBeInTheDocument();
    expect(piet.getByText("31")).toBeInTheDocument();
  });

  /** The whole point of the endpoint: one bounded request for every driver. */
  it("makes exactly one request, whatever the number of drivers", async () => {
    renderWidget();
    await screen.findByText("Piet Janssens");

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toBe("/api/v1/driver-statistics");
  });

  it("never asks for a driver or a trip list of its own", async () => {
    renderWidget();
    await screen.findByText("Piet Janssens");

    const paths = requestMock.mock.calls.map(([path]) => path);

    expect(paths.some((path) => path.startsWith("/api/v1/drivers/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/api/v1/trips"))).toBe(false);
    expect(
      paths.some((path) => path.startsWith("/api/v1/vehicle-assignments")),
    ).toBe(false);
  });

  it("keeps the backend's order rather than sorting again", async () => {
    renderWidget();
    await screen.findByText("Piet Janssens");

    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.firstElementChild?.textContent?.trim());

    expect(names).toEqual(["Piet Janssens", "Ahmet Yilmaz"]);
  });

  it("shows a zero as a zero", async () => {
    respondWith([
      {
        driverId: "driver-3",
        driverName: "Marc Vermeulen",
        isActive: true,
        today: 0,
        week: 0,
        month: 4,
      },
    ]);

    renderWidget();

    const row = within(await rowFor("Marc Vermeulen"));

    expect(row.getAllByText("0")).toHaveLength(2);
  });

  /** An inactive driver only appears with work behind them; say which. */
  it("marks an inactive driver", async () => {
    respondWith([
      {
        driverId: "driver-4",
        driverName: "Jan Peeters",
        isActive: false,
        today: 0,
        week: 0,
        month: 3,
      },
    ]);

    renderWidget();

    const row = within(await rowFor("Jan Peeters"));

    expect(row.getByText("Inactief")).toBeInTheDocument();
  });

  it("says so when there are no drivers yet", async () => {
    respondWith([]);
    renderWidget();

    expect(await screen.findByText("Nog geen chauffeurs")).toBeInTheDocument();
  });

  it("reports a failed read instead of showing an empty table", async () => {
    requestMock.mockRejectedValue(new Error("Service unavailable"));
    renderWidget();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("links to the drivers page", async () => {
    renderWidget();
    await screen.findByText("Piet Janssens");

    expect(
      screen.getByRole("link", { name: "Beheer chauffeurs" }),
    ).toHaveAttribute("href", "/drivers");
  });

  describe("presentation", () => {
    it("translates the widget", async () => {
      window.localStorage.setItem("tms.language", "tr");
      renderWidget();

      expect(await screen.findByText("Şoförler")).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Bugün" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Bu hafta" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Bu ay" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      renderWidget();

      const table = await screen.findByRole("table");

      expect(table.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(screen.getByText("Piet Janssens")).toBeInTheDocument();
    });
  });
});
