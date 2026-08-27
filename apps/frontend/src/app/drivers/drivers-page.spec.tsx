import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DriversPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { Driver, Paginated } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The drivers list.
 *
 * Searching and filtering are asserted through the REQUEST, because that is
 * where they happen: a filter that only narrowed the loaded page would look
 * right and be wrong past the first page.
 *
 * Which truck someone drives is deliberately absent from these tests, because
 * it is absent from this page: that is a VehicleAssignment, and it lives on the
 * vehicle where its date range makes sense.
 */

function buildDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: "driver-1",
    name: "Piet Janssens",
    licenceNumber: "B-1234567",
    phoneNumber: "+32 470 11 22 33",
    email: "piet@example.com",
    emergencyContact: null,
    notes: null,
    isActive: true,
    currentVehicle: null,
    ...overrides,
  };
}

function buildPage(
  items: Driver[],
  meta: Partial<Paginated<Driver>["meta"]> = {},
): Paginated<Driver> {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
      ...meta,
    },
  };
}

function respondWith(page: Paginated<Driver>): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [, options] = args as [string, { method?: string } | undefined];

    // A mutation answers with a Driver; a read answers with the page.
    return Promise.resolve(
      options?.method && options.method !== "GET" ? buildDriver() : page,
    ) as Promise<never>;
  });
}

function listCalls() {
  return requestMock.mock.calls
    .filter(([path, options]) => {
      const method = (options as { method?: string } | undefined)?.method;

      return path === "/api/v1/drivers" && (!method || method === "GET");
    })
    .map(
      ([, options]) =>
        (options as { query?: Record<string, unknown> })?.query ?? {},
    );
}

function mutationCalls() {
  return requestMock.mock.calls.filter(([, options]) => {
    const method = (options as { method?: string } | undefined)?.method;

    return method !== undefined && method !== "GET";
  });
}

function renderDrivers() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <DriversPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  respondWith(buildPage([buildDriver()]));
});

describe("DriversPage", () => {
  describe("the list", () => {
    it("shows the drivers the backend returned", async () => {
      renderDrivers();

      expect(await screen.findByText("Piet Janssens")).toBeInTheDocument();
      expect(screen.getByText("B-1234567")).toBeInTheDocument();
      expect(screen.getByText("piet@example.com")).toBeInTheDocument();
    });

    it("asks the backend to page, rather than loading everything", async () => {
      renderDrivers();
      await screen.findByText("Piet Janssens");

      expect(listCalls()[0]).toMatchObject({ page: 1, pageSize: 25 });
    });

    it("shows an inactive driver as inactive rather than hiding them", async () => {
      respondWith(buildPage([buildDriver({ isActive: false })]));
      renderDrivers();

      const row = (await screen.findByText("Piet Janssens")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("Inactief")).toBeInTheDocument();
    });

    it("says so when there is nobody yet", async () => {
      respondWith(buildPage([]));
      renderDrivers();

      expect(await screen.findByText("Nog geen chauffeurs")).toBeInTheDocument();
    });
  });

  describe("searching and filtering", () => {
    it("sends the search term to the backend", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.type(screen.getByLabelText("Zoeken"), "janssens");

      await waitFor(() =>
        expect(
          listCalls().some((query) => query.search === "janssens"),
        ).toBe(true),
      );
    });

    it("sends the active filter to the backend", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("radio", { name: "Actief" }));

      await waitFor(() =>
        expect(listCalls().some((query) => query.isActive === true)).toBe(true),
      );
    });
  });

  describe("creating and editing", () => {
    it("creates a driver through the create endpoint", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "+ Nieuwe chauffeur" }));
      await user.type(screen.getByLabelText("Naam"), "Ahmet Yilmaz");
      await user.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(mutationCalls()).toHaveLength(1));

      const [path, options] = mutationCalls()[0] as [
        string,
        { method: string; body: Record<string, unknown> },
      ];

      expect(path).toBe("/api/v1/drivers");
      expect(options.method).toBe("POST");
      expect(options.body).toMatchObject({ name: "Ahmet Yilmaz" });
    });

    /** Empty is "no value", which the backend spells null — never "". */
    it("sends an untouched optional field as null", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "+ Nieuwe chauffeur" }));
      await user.type(screen.getByLabelText("Naam"), "Ahmet Yilmaz");
      await user.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(mutationCalls()).toHaveLength(1));

      const [, options] = mutationCalls()[0] as [
        string,
        { body: Record<string, unknown> },
      ];

      expect(options.body.phoneNumber).toBeNull();
      expect(options.body.notes).toBeNull();
    });

    it("edits an existing driver through PATCH on its own id", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Bewerken" }));

      const name = screen.getByLabelText("Naam");
      await user.clear(name);
      await user.type(name, "Piet Janssen");
      await user.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(mutationCalls()).toHaveLength(1));

      const [path, options] = mutationCalls()[0] as [
        string,
        { method: string },
      ];

      expect(path).toBe("/api/v1/drivers/driver-1");
      expect(options.method).toBe("PATCH");
    });

    it("opens the edit form with the driver's stored values", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Bewerken" }));

      expect(screen.getByLabelText("Naam")).toHaveValue("Piet Janssens");
      expect(screen.getByLabelText("Rijbewijsnummer")).toHaveValue("B-1234567");
    });

    /**
     * A refused licence number is something to correct in the form, not to
     * retype from an empty one.
     */
    it("keeps the form open and shows why the backend refused", async () => {
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "+ Nieuwe chauffeur" }));
      await user.type(screen.getByLabelText("Naam"), "Ahmet Yilmaz");

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          "Licence number already used by an active driver",
          409,
        ),
      );

      await user.click(screen.getByRole("button", { name: "Opslaan" }));

      // Reported inside the form, where the value that caused it still is.
      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByText(/Licence number already used/),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Naam")).toHaveValue("Ahmet Yilmaz");
    });
  });

  describe("activation", () => {
    it("deactivates through the activation sub-resource, after confirming", async () => {
      const confirm = jest
        .spyOn(window, "confirm")
        .mockReturnValue(true);
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Deactiveren" }));

      await waitFor(() => expect(mutationCalls()).toHaveLength(1));
      expect(mutationCalls()[0][0]).toBe(
        "/api/v1/drivers/driver-1/deactivation",
      );

      confirm.mockRestore();
    });

    it("does nothing when the confirmation is declined", async () => {
      const confirm = jest
        .spyOn(window, "confirm")
        .mockReturnValue(false);
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(mutationCalls()).toHaveLength(0);

      confirm.mockRestore();
    });

    /** Putting somebody back in the planning can simply be undone. */
    it("activates without asking", async () => {
      respondWith(buildPage([buildDriver({ isActive: false })]));
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Activeren" }));

      await waitFor(() => expect(mutationCalls()).toHaveLength(1));
      expect(mutationCalls()[0][0]).toBe("/api/v1/drivers/driver-1/activation");
    });

    it("never deletes: no request uses DELETE", async () => {
      const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
      const user = userEvent.setup();
      renderDrivers();
      await screen.findByText("Piet Janssens");

      await user.click(screen.getByRole("button", { name: "Deactiveren" }));
      await waitFor(() => expect(mutationCalls()).toHaveLength(1));

      expect(
        requestMock.mock.calls.some(
          ([, options]) =>
            (options as { method?: string } | undefined)?.method === "DELETE",
        ),
      ).toBe(false);

      confirm.mockRestore();
    });
  });

  describe("presentation", () => {
    it("translates the page", async () => {
      window.localStorage.setItem("tms.language", "tr");
      renderDrivers();

      expect(
        await screen.findByRole("heading", { name: "Şoförler", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Ara")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "+ Yeni şoför" }),
      ).toBeInTheDocument();

      // "Etkin" is both a filter and a status badge; the row's is the one here.
      const row = screen.getByText("Piet Janssens").closest("tr") as HTMLElement;
      expect(within(row).getByText("Etkin")).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      renderDrivers();

      const table = await screen.findByRole("table");

      // No literal colour anywhere: both themes come from the same tokens.
      expect(table.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(screen.getByText("Piet Janssens")).toBeInTheDocument();
    });
  });

  /**
   * ── THE VOERTUIG COLUMN ───────────────────────────────────────────────────
   * The mirror of the Chauffeur column on Voertuigen, and the same source:
   * `currentVehicle`, which the backend resolves from VehicleAssignment. The
   * driver's last Trip is never consulted — a Trip says what somebody drove on
   * a day, not what they are assigned to now.
   */
  describe("the current vehicle", () => {
    const TRUCK = {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      isActive: true,
    };

    function vehicleCell(name: string): HTMLElement {
      const row = screen.getByText(name).closest("tr") as HTMLElement;

      // Second column: name, then vehicle.
      return row.querySelectorAll("td")[1] as HTMLElement;
    }

    it("names the vehicle the driver is assigned to today", async () => {
      respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
      renderDrivers();

      await screen.findByText("Piet Janssens");

      expect(vehicleCell("Piet Janssens")).toHaveTextContent("1-ABC-123");
    });

    it("shows the empty marker for a driver with no vehicle", async () => {
      respondWith(buildPage([buildDriver({ currentVehicle: null })]));
      renderDrivers();

      await screen.findByText("Piet Janssens");

      expect(vehicleCell("Piet Janssens")).toHaveTextContent("—");
    });

    it("gives each driver their own vehicle", async () => {
      respondWith(
        buildPage([
          buildDriver({ id: "d1", name: "Piet Janssens", currentVehicle: TRUCK }),
          buildDriver({
            id: "d2",
            name: "Mehmet Yilmaz",
            currentVehicle: { ...TRUCK, id: "v2", licensePlate: "1-XYZ-456" },
          }),
          buildDriver({ id: "d3", name: "Ali Demir", currentVehicle: null }),
        ]),
      );
      renderDrivers();

      await screen.findByText("Ali Demir");

      expect(vehicleCell("Piet Janssens")).toHaveTextContent("1-ABC-123");
      expect(vehicleCell("Mehmet Yilmaz")).toHaveTextContent("1-XYZ-456");
      expect(vehicleCell("Ali Demir")).toHaveTextContent("—");
    });

    /** A reassignment changes the backend's answer, not a browser computation. */
    it("follows the backend when the assignment changes", async () => {
      respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
      const view = renderDrivers();

      await screen.findByText("Piet Janssens");
      expect(vehicleCell("Piet Janssens")).toHaveTextContent("1-ABC-123");

      view.unmount();
      respondWith(
        buildPage([
          buildDriver({
            currentVehicle: { ...TRUCK, id: "v2", licensePlate: "1-XYZ-456" },
          }),
        ]),
      );
      renderDrivers();

      await screen.findByText("Piet Janssens");
      expect(vehicleCell("Piet Janssens")).toHaveTextContent("1-XYZ-456");
      expect(vehicleCell("Piet Janssens")).not.toHaveTextContent("1-ABC-123");
    });

    it("links the plate to the vehicle it names", async () => {
      respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
      renderDrivers();

      await screen.findByText("Piet Janssens");

      expect(screen.getByRole("link", { name: "1-ABC-123" })).toHaveAttribute(
        "href",
        "/vehicles/vehicle-1",
      );
    });

    /** The column must not cost a request per row. */
    it("loads the whole page in one request", async () => {
      respondWith(
        buildPage([
          buildDriver({ id: "d1", name: "Piet Janssens", currentVehicle: TRUCK }),
          buildDriver({ id: "d2", name: "Mehmet Yilmaz", currentVehicle: TRUCK }),
          buildDriver({ id: "d3", name: "Ali Demir", currentVehicle: TRUCK }),
        ]),
      );
      renderDrivers();

      await screen.findByText("Ali Demir");

      expect(listCalls()).toHaveLength(1);
    });

    describe("presentation", () => {
      it("heads the column in Dutch", async () => {
        respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
        renderDrivers();

        await screen.findByText("Piet Janssens");

        expect(
          screen.getByRole("columnheader", { name: "Voertuig" }),
        ).toBeInTheDocument();
      });

      it("heads the column in Turkish", async () => {
        window.localStorage.setItem("tms.language", "tr");
        respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
        renderDrivers();

        await screen.findByText("Piet Janssens");

        expect(
          screen.getByRole("columnheader", { name: "Araç" }),
        ).toBeInTheDocument();
      });

      it.each(["light", "dark"] as const)(
        "uses theme tokens in %s mode",
        async (theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
          respondWith(buildPage([buildDriver({ currentVehicle: TRUCK })]));
          renderDrivers();

          await screen.findByText("Piet Janssens");

          const link = screen.getByRole("link", { name: "1-ABC-123" });

          expect(link.className).toMatch(/text-(primary|muted)/);
          expect(link.className).not.toMatch(/#[0-9a-f]{3,6}/i);
        },
      );
    });
  });
});
