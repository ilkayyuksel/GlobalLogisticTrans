import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MaintenancePage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { Maintenance } from "@/lib/api/maintenance";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { MAINTENANCE_TYPES } from "@/lib/maintenance/maintenance-types";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-14",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const VEHICLE = {
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

function buildMaintenance(overrides: Partial<Maintenance> = {}): Maintenance {
  return {
    id: "maintenance-1",
    vehicleId: "vehicle-1",
    vehicle: {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      isActive: true,
    },
    status: "COMPLETED",
    maintenanceType: "Onderhoud",
    maintenanceDate: "2026-06-01",
    description: "Grote beurt",
    mileage: 245_000,
    cost: "1250.50",
    workshop: "Garage Peeters",
    nextMaintenanceDate: "2027-02-14",
    nextMaintenanceMileage: 275_000,
    notes: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: Maintenance[], totalPages = 1) {
  return {
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages },
  };
}

function respondWith(records: Maintenance[], totalPages = 1): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];

    if (path === "/api/v1/vehicles") {
      return Promise.resolve({
        items: [VEHICLE],
        meta: { page: 1, pageSize: 200, totalItems: 1, totalPages: 1 },
      });
    }

    if (options?.method && options.method !== "GET") {
      return Promise.resolve(buildMaintenance());
    }

    return Promise.resolve(page(records, totalPages));
  });
}

function listCalls() {
  return requestMock.mock.calls
    .filter(([path, options]) => {
      const method = (options as { method?: string } | undefined)?.method;

      return path === "/api/v1/maintenance" && (!method || method === "GET");
    })
    .map(
      ([, options]) =>
        (options as { query?: Record<string, unknown> })?.query ?? {},
    );
}

function mutationCalls() {
  return requestMock.mock.calls.filter(
    ([, options]) =>
      ((options as { method?: string } | undefined)?.method ?? "GET") !== "GET",
  );
}

function renderMaintenance() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <MaintenancePage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/**
 * The maintenance history.
 *
 * Two rules run through these tests: the mileage fields are values the
 * Administrator TYPED — nothing derives them and nothing treats them as a
 * current odometer — and there is no way to delete a record, because
 * maintenance is history.
 */
describe("Maintenance page", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("the list", () => {
    it("names every column", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");

      expect(
        screen.getAllByRole("columnheader").map((header) => header.textContent),
      ).toEqual([
        "Datum",
        "Voertuig",
        "Type",
        "Status",
        "Omschrijving",
        "Garage",
        "Km",
        "Kost",
        "Volgend onderhoud",
        "Acties",
      ]);
    });

    it("shows what the backend returned", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      const row = (await screen.findByText("Grote beurt")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("01/06/2026")).toBeInTheDocument();
      expect(within(row).getByText("1-ABC-123")).toBeInTheDocument();
      expect(within(row).getByText("Onderhoud")).toBeInTheDocument();
      expect(within(row).getByText("Voltooid")).toBeInTheDocument();
      expect(within(row).getByText("Garage Peeters")).toBeInTheDocument();
      // The cost is displayed exactly as the backend formatted it.
      expect(within(row).getByText("1250.50")).toBeInTheDocument();
    });

    it("shows the mileage the Administrator entered", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      const row = (await screen.findByText("Grote beurt")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText(/245/)).toBeInTheDocument();
    });

    it("shows the next maintenance date and mileage together", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      const row = (await screen.findByText("Grote beurt")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("14/02/2027")).toBeInTheDocument();
      expect(within(row).getByText(/275/)).toBeInTheDocument();
    });

    it("shows only the date when no next mileage was entered", async () => {
      respondWith([buildMaintenance({ nextMaintenanceMileage: null })]);

      renderMaintenance();
      const row = (await screen.findByText("Grote beurt")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("14/02/2027")).toBeInTheDocument();
      expect(within(row).queryByText(/275/)).not.toBeInTheDocument();
    });

    it("marks the fields a record does not have", async () => {
      respondWith([
        buildMaintenance({
          maintenanceType: null,
          workshop: null,
          mileage: null,
          cost: null,
          nextMaintenanceDate: null,
          nextMaintenanceMileage: null,
        }),
      ]);

      renderMaintenance();
      const row = (await screen.findByText("Grote beurt")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getAllByText("—")).toHaveLength(5);
    });

    it.each([
      ["PLANNED", "Gepland"],
      ["IN_PROGRESS", "In uitvoering"],
      ["COMPLETED", "Voltooid"],
      ["CANCELLED", "Geannuleerd"],
    ] as const)("shows %s as %s", async (status, label) => {
      respondWith([buildMaintenance({ status })]);

      renderMaintenance();
      const table = await screen.findByRole("table");

      expect(within(table).getByText(label)).toBeInTheDocument();
    });

    it("shows a loading state first", () => {
      requestMock.mockReturnValue(new Promise(() => undefined));

      renderMaintenance();

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("reports a failed request", async () => {
      requestMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderMaintenance();

      expect(
        await screen.findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
    });

    it("says when there is no maintenance yet", async () => {
      respondWith([]);

      renderMaintenance();

      expect(await screen.findByText("Nog geen onderhoud")).toBeInTheDocument();
    });

    it("pages through the history server-side", async () => {
      respondWith([buildMaintenance()], 3);

      renderMaintenance();
      await screen.findByRole("table");

      const pagination = screen.getByRole("navigation", { name: "Pagina" });
      await userEvent.click(
        within(pagination).getByRole("button", { name: "Volgende" }),
      );

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({ page: 2 });
      });
    });

    /** Maintenance is history: nothing may remove a record. */
    it("offers no delete", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");

      expect(
        screen.queryByRole("button", { name: /verwijder/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("filters", () => {
    it("sends the search term to the backend", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.type(screen.getByLabelText("Zoeken"), "banden");

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({
          search: "banden",
        });
      });
    });

    it("filters by vehicle", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.selectOptions(
        await screen.findByLabelText("Voertuig"),
        "vehicle-1",
      );

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({
          vehicleId: "vehicle-1",
        });
      });
    });

    it("filters by status", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.selectOptions(screen.getByLabelText("Status"), "PLANNED");

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({
          status: "PLANNED",
        });
      });
    });
  });

  describe("creating", () => {
    async function openForm(): Promise<HTMLElement> {
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw onderhoud" }),
      );

      return screen.findByRole("dialog");
    }

    /**
     * The type became a fixed list so that "Banden", "banden" and
     * "Bandenwissel" stop being three different things. The list lives in the
     * UI: there is no master table and no endpoint behind it.
     */
    describe("the type", () => {
      it("offers the fixed list rather than a text box", async () => {
        respondWith([buildMaintenance()]);

        renderMaintenance();
        await screen.findByRole("table");
        const picker = within(await openForm()).getByLabelText("Type");

        expect(picker.tagName).toBe("SELECT");
        expect(
          within(picker).getByRole("option", { name: "Olie vervangen" }),
        ).toBeInTheDocument();
        expect(
          within(picker).getByRole("option", { name: "Overige" }),
        ).toBeInTheDocument();
        expect(within(picker).getAllByRole("option")).toHaveLength(
          MAINTENANCE_TYPES.length + 1,
        );
      });

      it("translates the labels while storing one value", async () => {
        window.localStorage.setItem("tms.language", "tr");
        respondWith([buildMaintenance()]);

        renderMaintenance();
        await screen.findByRole("table");
        await userEvent.click(
          screen.getByRole("button", { name: "+ Yeni bakım" }),
        );
        const dialog = await screen.findByRole("dialog");

        expect(
          within(within(dialog).getByLabelText("Tip")).getByRole("option", {
            name: "Lastikler",
          }),
        ).toBeInTheDocument();
      });

      /**
       * Records predating the list hold free text. Nothing was migrated, so the
       * stored value stays selectable — editing the mileage of an old record
       * must not silently rewrite what someone actually wrote.
       */
      it("keeps free text stored before the list existed", async () => {
        respondWith([buildMaintenance({ maintenanceType: "Grote beurt" })]);

        renderMaintenance();
        await screen.findByRole("table");

        await userEvent.click(
          screen.getByRole("button", { name: /Bewerken/ }),
        );
        const dialog = await screen.findByRole("dialog");

        expect(within(dialog).getByLabelText("Type")).toHaveValue(
          "Grote beurt",
        );
        expect(
          within(within(dialog).getByLabelText("Type")).getByRole("option", {
            name: "Grote beurt",
          }),
        ).toBeInTheDocument();
      });

      it("shows a listed type by its label in the list", async () => {
        respondWith([buildMaintenance({ maintenanceType: "TIRES" })]);

        renderMaintenance();

        expect(await screen.findByText("Banden")).toBeInTheDocument();
      });

      it("shows free text exactly as it was stored", async () => {
        respondWith([buildMaintenance({ maintenanceType: "Bandenwissel" })]);

        renderMaintenance();

        expect(await screen.findByText("Bandenwissel")).toBeInTheDocument();
      });
    });

    it("sends exactly what the backend accepts", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      const dialog = await openForm();

      await userEvent.selectOptions(
        within(dialog).getByLabelText("Voertuig"),
        "vehicle-1",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Omschrijving"),
        "Banden vervangen",
      );
      await userEvent.selectOptions(
        within(dialog).getByLabelText("Type"),
        "TIRES",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Kilometerstand (km)"),
        "245000",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Volgend onderhoud (km)"),
        "275000",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][1]).toMatchObject({
          method: "POST",
          body: {
            vehicleId: "vehicle-1",
            status: "PLANNED",
            // The code is stored, never the label — a record entered in
            // Turkish and read in Dutch must be the same record.
            maintenanceType: "TIRES",
            description: "Banden vervangen",
            mileage: 245000,
            nextMaintenanceMileage: 275000,
            cost: null,
            workshop: null,
            nextMaintenanceDate: null,
            notes: null,
          },
        });
      });
      expect(
        await screen.findByText("Onderhoud toegevoegd"),
      ).toBeInTheDocument();
    });

    /** Both mileages are optional; an empty field means "not recorded". */
    it("sends null for an empty mileage", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      const dialog = await openForm();

      await userEvent.selectOptions(
        within(dialog).getByLabelText("Voertuig"),
        "vehicle-1",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Omschrijving"),
        "Keuring",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(
          (mutationCalls()[0][1] as { body: { mileage: unknown } }).body.mileage,
        ).toBeNull();
      });
    });

    it("says the mileage is the one recorded at this service", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      const dialog = await openForm();

      expect(
        within(dialog).getByText(/op het moment van dit onderhoud/),
      ).toBeInTheDocument();
    });

    it("keeps the form open and shows the backend's detail", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      const dialog = await openForm();

      requestMock.mockRejectedValueOnce(
        new ApiError("BAD_REQUEST", "Validation failed", 400, [
          "mileage must be an integer number",
        ]),
      );

      await userEvent.selectOptions(
        within(dialog).getByLabelText("Voertuig"),
        "vehicle-1",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Omschrijving"),
        "Test",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      expect(
        await within(dialog).findByText(/must be an integer number/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("refetches after a successful create", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      const before = listCalls().length;
      const dialog = await openForm();

      await userEvent.selectOptions(
        within(dialog).getByLabelText("Voertuig"),
        "vehicle-1",
      );
      await userEvent.type(within(dialog).getByLabelText("Omschrijving"), "X");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(listCalls().length).toBeGreaterThan(before);
      });
    });
  });

  describe("editing", () => {
    it("opens with the record's values and PATCHes", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Kilometerstand (km)")).toHaveValue(
        245000,
      );
      expect(
        within(dialog).getByLabelText("Volgend onderhoud (km)"),
      ).toHaveValue(275000);

      await userEvent.clear(
        within(dialog).getByLabelText("Kilometerstand (km)"),
      );
      await userEvent.type(
        within(dialog).getByLabelText("Kilometerstand (km)"),
        "250000",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe("/api/v1/maintenance/maintenance-1");
      });
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "PATCH",
        body: { mileage: 250000 },
      });
    });

    /** A maintenance record is never reassigned to another asset. */
    it("does not send the vehicle in an update", async () => {
      respondWith([buildMaintenance()]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Voertuig")).toBeDisabled();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()).toHaveLength(1);
      });
      expect(
        (mutationCalls()[0][1] as { body: Record<string, unknown> }).body,
      ).not.toHaveProperty("vehicleId");
    });

    /** Cancelling is how a maintenance is undone; nothing is deleted. */
    it("cancels a maintenance through its status", async () => {
      respondWith([buildMaintenance({ status: "PLANNED" })]);

      renderMaintenance();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");
      await userEvent.selectOptions(
        within(dialog).getByLabelText("Status"),
        "CANCELLED",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][1]).toMatchObject({
          method: "PATCH",
          body: { status: "CANCELLED" },
        });
      });
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith([buildMaintenance()]);

      renderMaintenance();

      expect(
        await screen.findByRole("heading", { name: "Bakım", level: 1 }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Sonraki bakım" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: "Servis" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "+ Yeni bakım" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith([buildMaintenance()]);

      renderMaintenance();
      const table = await screen.findByRole("table");
      // The vehicle's own colour is data; everything else is a token.
      const withoutVehicleColor = table.innerHTML.split("#2563eb").join("");

      expect(withoutVehicleColor).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(within(table).getByText("Grote beurt")).toBeInTheDocument();
    });
  });
});
