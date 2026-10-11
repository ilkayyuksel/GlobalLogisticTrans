import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redirect } from "next/navigation";

import DriversPage from "../drivers/page";
import FleetPage from "./page";
import { request } from "@/lib/api/client";
import type { Driver, Vehicle } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  redirect: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Vehicles & drivers: the links, the drivers and the vehicles on one page, and
 * the old Chauffeurs address still arriving there.
 */

const TRUCK = {
  id: "vehicle-a",
  licensePlate: "1-AAA-111",
  displayColor: "#336699",
  description: null,
  brand: null,
  model: null,
  year: null,
  notes: null,
  isActive: true,
  currentDriver: null,
} as Vehicle;

const PIET: Driver = {
  id: "driver-piet",
  name: "Piet Janssens",
  licenceNumber: null,
  phoneNumber: null,
  email: null,
  emergencyContact: null,
  notes: null,
  isActive: true,
  currentVehicle: null,
};

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path] = args as [string];
    const answers: Record<string, unknown> = {
      "/api/v1/vehicles": page([TRUCK]),
      "/api/v1/drivers": page([PIET]),
      "/api/v1/vehicle-assignments": page([]),
      "/api/v1/vehicle-assignments/links": {
        outcome: "LINKED",
        assignment: {
          id: "assignment-new",
          vehicleId: TRUCK.id,
          driverId: PIET.id,
          validFrom: "2026-10-11",
          validTo: null,
          isOpenEnded: true,
          notes: null,
        },
        endedAssignments: [],
      },
    };

    return Promise.resolve(answers[path]) as Promise<never>;
  });
});

function renderPage() {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <FleetPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function readsOf(path: string): number {
  return requestMock.mock.calls.filter(
    ([called, options]) => called === path && !(options as { method?: string })?.method,
  ).length;
}

describe("the fleet page", () => {
  it("16. holds the links, the drivers and the vehicles", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Wagens & chauffeurs", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Actieve koppelingen", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chauffeurs", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Voertuigen", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nieuwe chauffeur/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nieuw voertuig/ })).toBeInTheDocument();
  });

  it("17. offers deactivation, never a hard delete, for drivers and vehicles", async () => {
    renderPage();
    await screen.findByRole("cell", { name: "Piet Janssens" });

    expect(screen.queryByRole("button", { name: /verwijder/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Deactiveren" }).length).toBeGreaterThanOrEqual(2);
  });

  it("refreshes the driver and vehicle lists after a link", async () => {
    const user = userEvent.setup();
    renderPage();
    const links = await screen.findByRole("region", { name: "Actieve koppelingen" });
    await within(links).findByRole("link", { name: "1-AAA-111" });
    const vehicleReads = readsOf("/api/v1/vehicles");
    const driverReads = readsOf("/api/v1/drivers");

    await user.selectOptions(within(links).getByRole("combobox"), PIET.id);
    await user.click(within(links).getByRole("button", { name: "Koppelen" }));

    await waitFor(() => expect(readsOf("/api/v1/vehicles")).toBeGreaterThan(vehicleReads));
    expect(readsOf("/api/v1/drivers")).toBeGreaterThan(driverReads);
  });
});

describe("18. the old Chauffeurs address", () => {
  it("arrives at the drivers on the fleet page", () => {
    DriversPage();

    expect(redirect).toHaveBeenCalledWith("/vehicles#chauffeurs");
  });
});
