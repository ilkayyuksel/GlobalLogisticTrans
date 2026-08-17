import { render, screen, within } from "@testing-library/react";

import Page from "./page";
import { request } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

function buildVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "vehicle-1",
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: null,
    brand: "Volvo",
    model: "FH16",
    year: 2021,
    notes: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function respondWith(vehicles: ReturnType<typeof buildVehicle>[]): void {
  requestMock.mockResolvedValue({
    items: vehicles,
    meta: {
      page: 1,
      pageSize: 200,
      totalItems: vehicles.length,
      totalPages: 1,
    },
  } as never);
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <Page />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/**
 * Settings → Nummerplaten.
 *
 * The point of these tests is what the page must NOT become. A plate is the
 * identifying field of a Vehicle, and a second place to create or edit one
 * would mean two lists of trucks that can disagree — so the page reads
 * Vehicles and sends every change there.
 */
describe("Settings — number plates", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  it("lists the plates the planning uses, from the Vehicles endpoint", async () => {
    respondWith([buildVehicle(), buildVehicle({ id: "vehicle-2", licensePlate: "2-XYZ-987" })]);

    renderPage();

    expect(await screen.findByText("1-ABC-123")).toBeInTheDocument();
    expect(screen.getByText("2-XYZ-987")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/vehicles",
      expect.anything(),
    );
  });

  it("opens the Vehicle behind a plate", async () => {
    respondWith([buildVehicle()]);

    renderPage();

    expect(await screen.findByRole("link", { name: "1-ABC-123" })).toHaveAttribute(
      "href",
      "/vehicles/vehicle-1",
    );
  });

  it("says where a plate is actually managed", async () => {
    respondWith([buildVehicle()]);

    renderPage();

    expect(
      await screen.findByRole("link", { name: /Beheer nummerplaten/ }),
    ).toHaveAttribute("href", "/vehicles");
  });

  /** The whole reason this page is read-only. */
  it("offers no way to create or edit a plate here", async () => {
    respondWith([buildVehicle()]);

    renderPage();
    await screen.findByText("1-ABC-123");

    expect(screen.queryByRole("button", { name: /Nieuw/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bewerken/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("marks a plate whose Vehicle is no longer active", async () => {
    respondWith([buildVehicle({ isActive: false })]);

    renderPage();

    const row = (await screen.findByText("1-ABC-123")).closest(
      "li",
    ) as HTMLElement;

    expect(within(row).getByText("Inactief")).toBeInTheDocument();
  });

  it("translates the explanation", async () => {
    window.localStorage.setItem("tms.language", "tr");
    respondWith([buildVehicle()]);

    renderPage();

    expect(
      await screen.findByRole("link", { name: /Plakaları Araçlar/ }),
    ).toBeInTheDocument();
  });
});
