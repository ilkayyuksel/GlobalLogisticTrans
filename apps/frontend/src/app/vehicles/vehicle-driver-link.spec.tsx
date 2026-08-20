import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import VehiclesPage from "./page";
import { request } from "@/lib/api/client";
import type { Driver, Paginated, Vehicle } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Linking a driver to a truck from the fleet page.
 *
 * ── WHAT THIS MUST NEVER BECOME ─────────────────────────────────────────────
 * A driver column on the Vehicle. Choosing somebody here creates a
 * VEHICLE ASSIGNMENT — dated, historical, and the thing that gives a Trip its
 * effective driver — through the same endpoint the vehicle page uses. It must
 * never write `Trip.driverId`, which is a per-trip OVERRIDE and means something
 * else entirely, and it must never invent a second way to link the two.
 * ────────────────────────────────────────────────────────────────────────────
 */

const VEHICLE_ID = "vehicle-created";
const DRIVER_ID = "driver-1";

function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: null,
    brand: null,
    model: null,
    year: null,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function buildDriver(): Driver {
  return {
    id: DRIVER_ID,
    name: "Piet Janssens",
    licenceNumber: null,
    phoneNumber: null,
    email: null,
    emergencyContact: null,
    notes: null,
    isActive: true,
  };
}

function page<TItem>(items: TItem[]): Paginated<TItem> {
  return {
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  };
}

function respondNormally(): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];
    const method = options?.method ?? "GET";

    if (path === "/api/v1/drivers") {
      return Promise.resolve(page([buildDriver()])) as Promise<never>;
    }

    if (path === "/api/v1/vehicle-assignments" && method === "POST") {
      return Promise.resolve({ id: "assignment-1" }) as Promise<never>;
    }

    if (method !== "GET") {
      return Promise.resolve(buildVehicle()) as Promise<never>;
    }

    return Promise.resolve(page([])) as Promise<never>;
  });
}

function mutationCalls() {
  return requestMock.mock.calls.filter(
    ([, options]) =>
      ((options as { method?: string } | undefined)?.method ?? "GET") !== "GET",
  ) as [string, { method: string; body?: Record<string, unknown> }][];
}

function renderVehicles() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <VehiclesPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

async function openCreateFormAndName(user: ReturnType<typeof userEvent.setup>) {
  renderVehicles();
  await screen.findByRole("button", { name: "+ Nieuw voertuig" });

  await user.click(screen.getByRole("button", { name: "+ Nieuw voertuig" }));
  await user.type(screen.getByLabelText("Nummerplaat"), "1-ABC-123");
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  respondNormally();
});

describe("linking a driver while creating a vehicle", () => {
  it("offers the active drivers, fetched once for the page", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    expect(screen.getByLabelText("Chauffeur")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Piet Janssens" }),
    ).toBeInTheDocument();

    const driverCalls = requestMock.mock.calls.filter(
      ([path]) => path === "/api/v1/drivers",
    );

    expect(driverCalls).toHaveLength(1);
    expect(
      (driverCalls[0][1] as { query: Record<string, unknown> }).query,
    ).toMatchObject({ isActive: true });
  });

  it("says what choosing a driver actually does", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    // Not "the vehicle's driver": an assignment, starting today.
    expect(
      screen.getByText(/Maakt een voertuigtoewijzing vanaf vandaag/),
    ).toBeInTheDocument();
  });

  it("creates the vehicle, then the assignment for it", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    await user.selectOptions(screen.getByLabelText("Chauffeur"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(mutationCalls()).toHaveLength(2));

    const [vehicleCall, assignmentCall] = mutationCalls();

    expect(vehicleCall[0]).toBe("/api/v1/vehicles");
    expect(assignmentCall[0]).toBe("/api/v1/vehicle-assignments");
    expect(assignmentCall[1].body).toMatchObject({
      vehicleId: VEHICLE_ID,
      driverId: DRIVER_ID,
    });
    // Dated, because an assignment is a period rather than a property.
    expect(assignmentCall[1].body?.validFrom).toEqual(expect.any(String));
  });

  /**
   * The regression this guards: a driver chosen on a Vehicle must not become a
   * Trip override. They are different facts — one is a standing arrangement,
   * the other overrules it for a single Trip.
   */
  it("never writes a driver onto the vehicle or onto a trip", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    await user.selectOptions(screen.getByLabelText("Chauffeur"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(mutationCalls()).toHaveLength(2));

    const [vehicleCall] = mutationCalls();

    expect(vehicleCall[1].body).not.toHaveProperty("driverId");
    expect(
      requestMock.mock.calls.some(([path]) => path.startsWith("/api/v1/trips")),
    ).toBe(false);
  });

  it("creates no assignment when no driver is chosen", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    await user.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(mutationCalls()).toHaveLength(1));
    expect(mutationCalls()[0][0]).toBe("/api/v1/vehicles");
  });

  /**
   * The truck exists and is correct; only the link is missing. Reporting a
   * plain failure would send the operator looking for a vehicle that is there.
   */
  it("reports a failed link without pretending the vehicle failed", async () => {
    const user = userEvent.setup();
    await openCreateFormAndName(user);

    requestMock.mockImplementation((...args: unknown[]) => {
      const [path, options] = args as [string, { method?: string } | undefined];
      const method = options?.method ?? "GET";

      if (path === "/api/v1/vehicle-assignments" && method === "POST") {
        return Promise.reject(new Error("Driver is already assigned"));
      }

      if (path === "/api/v1/drivers") {
        return Promise.resolve(page([buildDriver()])) as Promise<never>;
      }

      if (method !== "GET") {
        return Promise.resolve(buildVehicle()) as Promise<never>;
      }

      return Promise.resolve(page([])) as Promise<never>;
    });

    await user.selectOptions(screen.getByLabelText("Chauffeur"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Opslaan" }));

    expect(
      await screen.findByText(/de chauffeur kon niet worden gekoppeld/),
    ).toBeInTheDocument();
  });

  /**
   * Changing who drives an existing truck ends one assignment and starts
   * another. That is a dated decision with history behind it, and the vehicle
   * page owns it — a second control here would be a second mechanism.
   */
  it("does not offer the driver as an editable field on an existing vehicle", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const [path] = args as [string];

      if (path === "/api/v1/drivers") {
        return Promise.resolve(page([buildDriver()])) as Promise<never>;
      }

      return Promise.resolve(page([buildVehicle()])) as Promise<never>;
    });

    const user = userEvent.setup();
    renderVehicles();
    await screen.findByText("1-ABC-123");

    await user.click(screen.getByRole("button", { name: "Bewerken" }));

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByText(/wijzig je op de voertuigpagina/),
    ).toBeInTheDocument();
  });
});
