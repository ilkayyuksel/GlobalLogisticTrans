import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-14",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const VEHICLE: Vehicle = {
  id: "vehicle-1",
  licensePlate: "1-ABC-123",
  displayColor: "#2563eb",
  description: null,
  brand: "Volvo",
  model: "FH16",
  year: 2021,
  notes: null,
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

const DRIVERS = [
  {
    id: "driver-1",
    name: "Piet Janssens",
    licenceNumber: null,
    emergencyContact: null,
    notes: null,
    phoneNumber: null,
    email: null,
    isActive: true,
  },
  {
    id: "driver-2",
    name: "Ayşe Yılmaz",
    licenceNumber: null,
    emergencyContact: null,
    notes: null,
    phoneNumber: null,
    email: null,
    isActive: true,
  },
];

const SUMMARY = {
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
 * Assigning a driver to a vehicle.
 *
 * Every assertion is about the REQUEST and about what is offered: the backend
 * owns which assignment is in effect and refuses a driver or start-date change
 * on an existing one, so the form must not pretend otherwise.
 */
function respondWith(overrides: { assignment?: unknown } = {}): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];

    if (options?.method && options.method !== "GET") {
      return Promise.resolve(ASSIGNMENT);
    }

    if (path.startsWith("/api/v1/vehicle-assignments/current/")) {
      return Promise.resolve(
        overrides.assignment === undefined ? ASSIGNMENT : overrides.assignment,
      );
    }

    if (path === "/api/v1/drivers") {
      return Promise.resolve({
        items: DRIVERS,
        meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
      });
    }

    if (path.startsWith("/api/v1/drivers/")) {
      return Promise.resolve(DRIVERS[0]);
    }

    if (path.startsWith("/api/v1/maintenance/summary/")) {
      return Promise.resolve(SUMMARY);
    }

    return Promise.resolve(VEHICLE);
  });
}

function mutationCalls() {
  return requestMock.mock.calls.filter(
    ([, options]) =>
      ((options as { method?: string } | undefined)?.method ?? "GET") !== "GET",
  );
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

describe("Vehicle assignment", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  describe("what the panel shows", () => {
    it("shows the driver and both dates", async () => {
      respondWith({
        assignment: { ...ASSIGNMENT, validTo: "2026-12-31", isOpenEnded: false },
      });

      renderDetail();
      const panel = (await screen.findByText("Şoför ataması", {
        exact: false,
      }).catch(() => screen.findByText("Chauffeurtoewijzing"))) as HTMLElement;

      const section = panel.closest("section") as HTMLElement;

      expect(within(section).getByText("Piet Janssens")).toBeInTheDocument();
      expect(within(section).getByText("01/01/2026")).toBeInTheDocument();
      expect(within(section).getByText("31/12/2026")).toBeInTheDocument();
    });

    it("marks an open-ended assignment as such", async () => {
      respondWith();

      renderDetail();

      expect(await screen.findByText("Open einde")).toBeInTheDocument();
    });

    it("says so when nothing is assigned", async () => {
      respondWith({ assignment: null });

      renderDetail();

      expect(await screen.findByText("Geen toewijzing")).toBeInTheDocument();
    });

    /** The rule is the backend's, and the panel says so rather than restating it. */
    it("credits the backend with resolving the assignment", async () => {
      respondWith();

      renderDetail();

      expect(
        await screen.findByText(/backend bepaalt welke toewijzing geldt/),
      ).toBeInTheDocument();
    });
  });

  describe("linking a driver", () => {
    async function openLink(): Promise<HTMLElement> {
      await userEvent.click(
        await screen.findByRole("button", { name: "Chauffeur koppelen" }),
      );

      return screen.findByRole("dialog");
    }

    it("sends exactly what the backend accepts", async () => {
      respondWith({ assignment: null });

      renderDetail();
      const dialog = await openLink();

      await userEvent.selectOptions(
        await within(dialog).findByLabelText("Chauffeur"),
        "driver-2",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe("/api/v1/vehicle-assignments");
      });
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "POST",
        body: {
          vehicleId: "vehicle-1",
          driverId: "driver-2",
          validFrom: "2026-08-14",
          validTo: null,
          notes: null,
        },
      });
      expect(await screen.findByText("Chauffeur gekoppeld")).toBeInTheDocument();
    });

    it("offers only active drivers", async () => {
      respondWith({ assignment: null });

      renderDetail();
      const dialog = await openLink();
      const select = await within(dialog).findByLabelText("Chauffeur");

      expect(
        within(select).getByRole("option", { name: "Ayşe Yılmaz" }),
      ).toBeInTheDocument();
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/drivers",
        expect.objectContaining({
          query: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it("sends an end date when one is given", async () => {
      respondWith({ assignment: null });

      renderDetail();
      const dialog = await openLink();

      await userEvent.selectOptions(
        await within(dialog).findByLabelText("Chauffeur"),
        "driver-1",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Geldig tot"),
        "2026-12-31",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(
          (mutationCalls()[0][1] as { body: { validTo: unknown } }).body.validTo,
        ).toBe("2026-12-31");
      });
    });

    it("refetches the assignment afterwards", async () => {
      respondWith({ assignment: null });

      renderDetail();
      const before = requestMock.mock.calls.filter(([path]) =>
        String(path).includes("/vehicle-assignments/current/"),
      ).length;

      const dialog = await openLink();
      await userEvent.selectOptions(
        await within(dialog).findByLabelText("Chauffeur"),
        "driver-1",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(
          requestMock.mock.calls.filter(([path]) =>
            String(path).includes("/vehicle-assignments/current/"),
          ).length,
        ).toBeGreaterThan(before);
      });
    });

    it("keeps the dialog open and reports a refusal", async () => {
      respondWith({ assignment: null });

      renderDetail();
      const dialog = await openLink();

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          "The driver already has an open-ended assignment.",
          409,
        ),
      );

      await userEvent.selectOptions(
        await within(dialog).findByLabelText("Chauffeur"),
        "driver-1",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      expect(
        await within(dialog).findByText(/already has an open-ended assignment/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("editing an assignment", () => {
    async function openEdit(): Promise<HTMLElement> {
      await userEvent.click(
        await screen.findByRole("button", { name: "Toewijzing bewerken" }),
      );

      return screen.findByRole("dialog");
    }

    /** The backend refuses both; offering them would guarantee a rejection. */
    it("does not allow the driver or the start date to change", async () => {
      respondWith();

      renderDetail();
      const dialog = await openEdit();

      expect(await within(dialog).findByLabelText("Chauffeur")).toBeDisabled();
      expect(within(dialog).getByLabelText("Geldig vanaf")).toBeDisabled();
      expect(within(dialog).getByLabelText("Geldig tot")).toBeEnabled();
    });

    it("sends only the end date and the notes", async () => {
      respondWith();

      renderDetail();
      const dialog = await openEdit();

      await userEvent.type(
        within(dialog).getByLabelText("Geldig tot"),
        "2026-10-31",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/vehicle-assignments/assignment-1",
        );
      });
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "PATCH",
        body: { validTo: "2026-10-31", notes: null },
      });
      expect(
        (mutationCalls()[0][1] as { body: Record<string, unknown> }).body,
      ).not.toHaveProperty("driverId");
    });
  });

  describe("ending an assignment", () => {
    it("closes it through its own sub-resource, after confirming", async () => {
      respondWith();

      renderDetail();
      await userEvent.click(
        await screen.findByRole("button", { name: "Toewijzing beëindigen" }),
      );

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/vehicle-assignments/assignment-1/closure",
        );
      });
      expect(
        await screen.findByText("Toewijzing beëindigd"),
      ).toBeInTheDocument();
    });

    it("sends nothing when the confirmation is declined", async () => {
      confirmSpy.mockReturnValue(false);
      respondWith();

      renderDetail();
      await userEvent.click(
        await screen.findByRole("button", { name: "Toewijzing beëindigen" }),
      );

      expect(mutationCalls()).toHaveLength(0);
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith();

      renderDetail();

      expect(await screen.findByText("Şoför ataması")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Şoför ata" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Açık uçlu")).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith();

      renderDetail();
      const panel = (await screen.findByText("Chauffeurtoewijzing")).closest(
        "section",
      ) as HTMLElement;

      expect(panel.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(within(panel).getByText("Piet Janssens")).toBeInTheDocument();
    });
  });
});
