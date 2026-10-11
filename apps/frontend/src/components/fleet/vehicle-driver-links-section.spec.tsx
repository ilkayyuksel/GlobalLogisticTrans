import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VehicleDriverLinksSection } from "./vehicle-driver-links-section";
import { request } from "@/lib/api/client";
import type { Driver, Vehicle, VehicleAssignment } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Section A: today's driver per truck, and linking or ending from the row.
 *
 * Which link is in effect, what a new link ends and which Trips keep their
 * driver are all the backend's; these tests pin what the page SENDS and what
 * it SHOWS from the answers.
 */

function vehicle(id: string, plate: string, currentDriver: Vehicle["currentDriver"] = null): Vehicle {
  return {
    id,
    licensePlate: plate,
    displayColor: "#336699",
    description: null,
    brand: null,
    model: null,
    year: null,
    notes: null,
    isActive: true,
    currentDriver,
  } as Vehicle;
}

function driver(id: string, name: string, currentVehicle: Driver["currentVehicle"] = null): Driver {
  return {
    id,
    name,
    licenceNumber: null,
    phoneNumber: null,
    email: null,
    emergencyContact: null,
    notes: null,
    isActive: true,
    currentVehicle,
  };
}

const PIET = driver("driver-piet", "Piet Janssens", {
  id: "vehicle-a",
  licensePlate: "1-AAA-111",
  displayColor: "#336699",
  isActive: true,
});
const AHMET = driver("driver-ahmet", "Ahmet Yilmaz");

const ACTIVE_LINK: VehicleAssignment = {
  id: "assignment-a",
  vehicleId: "vehicle-a",
  driverId: PIET.id,
  validFrom: "2026-08-01",
  validTo: null,
  isOpenEnded: true,
  notes: null,
};

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 200, totalItems: items.length, totalPages: 1 },
});

let linkOutcome: "LINKED" | "ALREADY_LINKED" = "LINKED";

function respond(): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];
    const answers: Record<string, unknown> = {
      "/api/v1/vehicles": page([
        vehicle("vehicle-a", "1-AAA-111", { id: PIET.id, name: PIET.name, isActive: true }),
        vehicle("vehicle-b", "1-BBB-222"),
      ]),
      "/api/v1/vehicle-assignments": page([ACTIVE_LINK]),
      "/api/v1/drivers": page([PIET, AHMET]),
      "/api/v1/vehicle-assignments/links": {
        outcome: linkOutcome,
        assignment: { ...ACTIVE_LINK, id: "assignment-new" },
        endedAssignments: linkOutcome === "LINKED" ? [ACTIVE_LINK] : [],
      },
      "/api/v1/vehicle-assignments/assignment-a/closure": { ...ACTIVE_LINK, validTo: "2026-08-24" },
    };

    if (!(path in answers) || (options?.method === "POST") !== path.endsWith("/links")) {
      return Promise.reject(new Error(`unexpected request ${path}`)) as Promise<never>;
    }

    return Promise.resolve(answers[path]) as Promise<never>;
  });
}

function renderSection(onChanged = jest.fn()) {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <VehicleDriverLinksSection version={0} onChanged={onChanged} />
      </LanguageProvider>
    </ThemeProvider>,
  );
  return onChanged;
}

function rowOf(plate: string): HTMLElement {
  return screen.getByRole("link", { name: plate }).closest("tr") as HTMLElement;
}

function callsTo(path: string) {
  return requestMock.mock.calls.filter(([called]) => called === path);
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  linkOutcome = "LINKED";
  respond();
});

describe("VehicleDriverLinksSection", () => {
  it("15. shows one row per truck with today's driver, and a truck with none", async () => {
    renderSection();

    await screen.findByRole("link", { name: "1-AAA-111" });

    expect(within(rowOf("1-AAA-111")).getByText("Piet Janssens")).toBeInTheDocument();
    expect(within(rowOf("1-AAA-111")).getByText("Actief sinds 01/08/2026")).toBeInTheDocument();
    expect(within(rowOf("1-BBB-222")).getByText("Geen chauffeur")).toBeInTheDocument();
    expect(within(rowOf("1-BBB-222")).getByText("Geen actieve toewijzing")).toBeInTheDocument();
  });

  it("asks the backend for the links in effect today, not the newest rows", async () => {
    renderSection();
    await screen.findByRole("link", { name: "1-AAA-111" });

    expect(callsTo("/api/v1/vehicle-assignments")[0][1]).toMatchObject({
      query: { activeOnly: true },
    });
  });

  it("offers only the NEW driver, saying where a driver drives now", async () => {
    renderSection();
    await screen.findByRole("link", { name: "1-AAA-111" });

    const onA = within(rowOf("1-AAA-111")).getByRole("combobox", {
      name: "Nieuwe chauffeur voor 1-AAA-111",
    });
    const onB = within(rowOf("1-BBB-222")).getByRole("combobox");

    // The current driver is information, not a choice.
    expect(within(onA).queryByRole("option", { name: /Piet/ })).not.toBeInTheDocument();
    expect(within(onB).getByRole("option", { name: "Piet Janssens (nu op 1-AAA-111)" })).toBeInTheDocument();
  });

  it("1-5. links with only the two ids, reports what was ended, and refreshes", async () => {
    const user = userEvent.setup();
    const onChanged = renderSection();
    await screen.findByRole("link", { name: "1-BBB-222" });

    await user.selectOptions(within(rowOf("1-BBB-222")).getByRole("combobox"), PIET.id);
    await user.click(within(rowOf("1-BBB-222")).getByRole("button", { name: "Koppelen" }));

    expect(callsTo("/api/v1/vehicle-assignments/links")[0][1]).toEqual(
      expect.objectContaining({ method: "POST", body: { vehicleId: "vehicle-b", driverId: PIET.id } }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Chauffeur gekoppeld — 1 vorige toewijzing(en) beëindigd",
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("6. says so when the driver is already linked", async () => {
    linkOutcome = "ALREADY_LINKED";
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole("link", { name: "1-BBB-222" });

    await user.selectOptions(within(rowOf("1-BBB-222")).getByRole("combobox"), AHMET.id);
    await user.click(within(rowOf("1-BBB-222")).getByRole("button", { name: "Koppelen" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deze chauffeur is al aan deze wagen gekoppeld; er is niets gewijzigd.",
    );
  });

  it("does not link before a driver is chosen", async () => {
    renderSection();
    await screen.findByRole("link", { name: "1-BBB-222" });

    expect(within(rowOf("1-BBB-222")).getByRole("button", { name: "Koppelen" })).toBeDisabled();
  });

  it("7. ends an assignment without asking for a date, after confirming", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const onChanged = renderSection();
    await screen.findByRole("link", { name: "1-AAA-111" });

    await user.click(within(rowOf("1-AAA-111")).getByRole("button", { name: "Toewijzing beëindigen" }));

    const [, options] = callsTo("/api/v1/vehicle-assignments/assignment-a/closure")[0];
    expect(options).toEqual(expect.objectContaining({ method: "PATCH" }));
    expect(options).not.toHaveProperty("body");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(within(rowOf("1-BBB-222")).queryByRole("button", { name: "Toewijzing beëindigen" })).toBeNull();
  });

  it("sends nothing when the confirmation is declined", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole("link", { name: "1-AAA-111" });

    await user.click(within(rowOf("1-AAA-111")).getByRole("button", { name: "Toewijzing beëindigen" }));

    expect(callsTo("/api/v1/vehicle-assignments/assignment-a/closure")).toHaveLength(0);
  });
});
