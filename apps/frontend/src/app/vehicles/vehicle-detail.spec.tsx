import { render, screen, within } from "@testing-library/react";

import VehicleDetailPage from "./[vehicleId]/page";
import { ApiError, request } from "@/lib/api/client";
import type { Vehicle } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: () => ({ vehicleId: "vehicle-1" }),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const VEHICLE: Vehicle = {
  id: "vehicle-1",
  licensePlate: "1-ABC-123",
  displayColor: "#2563eb",
  description: "Main tractor unit",
  brand: "Volvo",
  model: "FH16",
  year: 2021,
  notes: "Winter tyres fitted",
  isActive: true,
};

const ASSIGNMENT = {
  id: "assignment-1",
  vehicleId: "vehicle-1",
  driverId: "driver-1",
  validFrom: "2026-01-01",
  validTo: null,
  isOpenEnded: true,
  notes: null,
};

const DRIVER = {
  id: "driver-1",
  name: "Piet Janssens",
  licenceNumber: null,
  phoneNumber: null,
  email: null,
  isActive: true,
};

const SUMMARY = {
  vehicleId: "vehicle-1",
  maintenanceCount: 3,
  totalCost: "3250.75",
  latestMaintenance: {
    id: "maintenance-1",
    maintenanceDate: "2026-06-01",
    description: "Grote beurt",
  },
  latestMileage: 245_000,
  nextMaintenanceDate: "2027-02-14",
  nextMaintenanceMileage: 275_000,
  isDueByDate: false,
};

const EMPTY_SUMMARY = {
  vehicleId: "vehicle-1",
  maintenanceCount: 0,
  totalCost: "0.00",
  latestMaintenance: null,
  latestMileage: null,
  nextMaintenanceDate: null,
  nextMaintenanceMileage: null,
  isDueByDate: false,
};

/**
 * One Vehicle in full.
 *
 * The maintenance panel is what most of these tests are about: every figure in
 * it is the backend's, and the two mileages it shows mean different things —
 * one was recorded at the last service, the other is the plan for the next.
 */
function respondWith(
  overrides: { assignment?: unknown; summary?: unknown; vehicle?: unknown } = {},
): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path] = args as [string];

    if (path.startsWith("/api/v1/vehicle-assignments/current/")) {
      return Promise.resolve(
        overrides.assignment === undefined ? ASSIGNMENT : overrides.assignment,
      );
    }

    if (path.startsWith("/api/v1/drivers/")) {
      return Promise.resolve(DRIVER);
    }

    if (path.startsWith("/api/v1/maintenance/summary/")) {
      return Promise.resolve(
        overrides.summary === undefined ? SUMMARY : overrides.summary,
      );
    }

    return Promise.resolve(
      overrides.vehicle === undefined ? VEHICLE : overrides.vehicle,
    );
  });
}

function renderDetail() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <VehicleDetailPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe("Vehicle detail", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("shows everything the Vehicle stores", async () => {
    respondWith();

    renderDetail();

    expect(
      await screen.findByRole("heading", { name: /1-ABC-123/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Volvo")).toBeInTheDocument();
    expect(screen.getByText("FH16")).toBeInTheDocument();
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.getByText("Main tractor unit")).toBeInTheDocument();
    expect(screen.getByText("Winter tyres fitted")).toBeInTheDocument();
    expect(screen.getByText("#2563eb")).toBeInTheDocument();
  });

  it("marks an inactive vehicle without hiding it", async () => {
    respondWith({ assignment: null, vehicle: { ...VEHICLE, isActive: false } });

    renderDetail();

    const summary = (
      await screen.findByRole("heading", { name: /1-ABC-123/ })
    ).closest("section") as HTMLElement;

    expect(within(summary).getByText("Inactief")).toBeInTheDocument();
    expect(within(summary).getByText("Volvo")).toBeInTheDocument();
  });

  /** Which assignment applies is the backend's answer, asked once. */
  it("shows the driver currently assigned", async () => {
    respondWith();

    renderDetail();

    expect(await screen.findByText("Piet Janssens")).toBeInTheDocument();
    expect(screen.getByText("01/01/2026")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/vehicle-assignments/current/vehicle/vehicle-1",
      expect.anything(),
    );
  });

  it("says so when no driver is assigned", async () => {
    respondWith({ assignment: null });

    renderDetail();

    expect(await screen.findByText("Geen toewijzing")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/drivers/"),
      expect.anything(),
    );
  });

  it("reports a vehicle that does not exist", async () => {
    requestMock.mockRejectedValue(
      new ApiError("NOT_FOUND", "Vehicle does not exist.", 404),
    );

    renderDetail();

    expect(
      await screen.findByText("Dit voertuig bestaat niet"),
    ).toBeInTheDocument();
  });

  it("shows a loading state first", () => {
    requestMock.mockReturnValue(new Promise(() => undefined));

    renderDetail();

    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  describe("the maintenance panel", () => {
    async function maintenancePanel(): Promise<HTMLElement> {
      return (await screen.findByText("Aantal onderhoudsbeurten")).closest(
        "section",
      ) as HTMLElement;
    }

    /** Counted and summed by the database, never added here. */
    it("shows the backend's count and total", async () => {
      respondWith();

      renderDetail();
      const panel = await maintenancePanel();

      expect(within(panel).getByText("3")).toBeInTheDocument();
      expect(within(panel).getByText("3250.75")).toBeInTheDocument();
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/maintenance/summary/vehicle/vehicle-1",
        expect.anything(),
      );
    });

    it("shows the latest maintenance", async () => {
      respondWith();

      renderDetail();
      const panel = await maintenancePanel();

      expect(
        within(panel).getByText("01/06/2026 · Grote beurt"),
      ).toBeInTheDocument();
    });

    /**
     * The two mileages mean different things and the panel must not blur them:
     * one was recorded at the last service, the other is the plan.
     */
    it("separates the latest recorded mileage from the next planned one", async () => {
      respondWith();

      renderDetail();
      const panel = await maintenancePanel();

      expect(
        within(panel).getByText("Laatste kilometerstand"),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText(/niet de huidige kilometerstand/),
      ).toBeInTheDocument();
      expect(within(panel).getByText(/245/)).toBeInTheDocument();
      expect(within(panel).getByText(/275/)).toBeInTheDocument();
    });

    it("warns when the planned date has arrived", async () => {
      respondWith({ summary: { ...SUMMARY, isDueByDate: true } });

      renderDetail();
      const panel = await maintenancePanel();

      expect(within(panel).getByText("Onderhoud verlopen")).toBeInTheDocument();
    });

    /** A planned mileage alone can never produce a warning. */
    it("does not warn on mileage alone", async () => {
      respondWith({
        summary: {
          ...SUMMARY,
          isDueByDate: false,
          latestMileage: 300_000,
          nextMaintenanceMileage: 275_000,
          nextMaintenanceDate: null,
        },
      });

      renderDetail();
      const panel = await maintenancePanel();

      expect(
        within(panel).queryByText("Onderhoud verlopen"),
      ).not.toBeInTheDocument();
    });

    it("says so when the vehicle has no maintenance yet", async () => {
      respondWith({ summary: EMPTY_SUMMARY });

      renderDetail();
      const panel = await maintenancePanel();

      expect(
        within(panel).getByText("Nog geen onderhoud geregistreerd"),
      ).toBeInTheDocument();
      expect(within(panel).getByText("0.00")).toBeInTheDocument();
    });

    it("links to the full maintenance history", async () => {
      respondWith();

      renderDetail();
      const panel = await maintenancePanel();

      expect(
        within(panel).getByRole("link", { name: "Onderhoud bekijken" }),
      ).toHaveAttribute("href", "/maintenance");
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith();

      renderDetail();

      expect(await screen.findByText("Şoför ataması")).toBeInTheDocument();
      expect(screen.getByText("Bakım sayısı")).toBeInTheDocument();
      expect(screen.getByText("Son kilometre")).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith();

      const { container } = renderDetail();
      await screen.findByRole("heading", { name: /1-ABC-123/ });

      // The vehicle's own colour is data, and is also shown as text.
      const withoutVehicleColor = container.innerHTML.split("#2563eb").join("");

      expect(withoutVehicleColor).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
  });
});
