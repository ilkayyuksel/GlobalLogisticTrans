import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import VehiclesPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { Paginated, Vehicle } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The fleet list.
 *
 * Searching and filtering are asserted through the REQUEST, because that is
 * where they happen: a filter that only narrowed the loaded page would look
 * right and be wrong past the first page.
 */

function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "vehicle-1",
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: "Main tractor unit",
    brand: "Volvo",
    model: "FH16",
    year: 2021,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function buildPage(
  items: Vehicle[],
  meta: Partial<Paginated<Vehicle>["meta"]> = {},
): Paginated<Vehicle> {
  return {
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1, ...meta },
  };
}

function respondWith(page: Paginated<Vehicle>): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [, options] = args as [string, { method?: string } | undefined];

    // A mutation answers with a Vehicle; a read answers with the page.
    return Promise.resolve(
      options?.method && options.method !== "GET" ? buildVehicle() : page,
    );
  });
}

function listCalls() {
  return requestMock.mock.calls
    .filter(([path, options]) => {
      const method = (options as { method?: string } | undefined)?.method;

      return path === "/api/v1/vehicles" && (!method || method === "GET");
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

function renderVehicles() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <VehiclesPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe("Vehicles page", () => {
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

  describe("the list", () => {
    it("shows the fleet the backend returned", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();

      const row = (await screen.findByText("1-ABC-123")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("Volvo")).toBeInTheDocument();
      expect(within(row).getByText("FH16")).toBeInTheDocument();
      expect(within(row).getByText("2021")).toBeInTheDocument();
      expect(within(row).getByText("Main tractor unit")).toBeInTheDocument();
      expect(within(row).getByText("Actief")).toBeInTheDocument();
    });

    it("names every column", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");

      expect(
        screen.getAllByRole("columnheader").map((header) => header.textContent),
      ).toEqual([
        "Nummerplaat",
        "Omschrijving",
        "Merk",
        "Model",
        "Bouwjaar",
        "Status",
        "Acties",
      ]);
    });

    it("marks the fields a vehicle does not have", async () => {
      respondWith(
        buildPage([
          buildVehicle({ brand: null, model: null, year: null, description: null }),
        ]),
      );

      renderVehicles();
      const row = (await screen.findByText("1-ABC-123")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getAllByText("—")).toHaveLength(4);
    });

    it("links each plate to its detail page", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();

      expect(
        await screen.findByRole("link", { name: "1-ABC-123" }),
      ).toHaveAttribute("href", "/vehicles/vehicle-1");
    });

    it("shows a loading state first", () => {
      requestMock.mockReturnValue(new Promise(() => undefined));

      renderVehicles();

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("reports a failed request with a retry", async () => {
      requestMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderVehicles();

      expect(
        await screen.findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
    });

    it("says when the fleet is empty", async () => {
      respondWith(buildPage([]));

      renderVehicles();

      expect(
        await screen.findByText("Nog geen voertuigen"),
      ).toBeInTheDocument();
    });

    it("says when nothing matches the filters", async () => {
      respondWith(buildPage([]));

      renderVehicles();
      await userEvent.type(screen.getByLabelText("Zoeken"), "zzz");

      expect(
        await screen.findByText("Geen voertuigen voor deze filters"),
      ).toBeInTheDocument();
    });
  });

  describe("searching and filtering", () => {
    it("sends the search term to the backend", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.type(screen.getByLabelText("Zoeken"), "volvo");

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({
          search: "volvo",
        });
      });
    });

    /** One request for a typed word, not one per keystroke. */
    it("waits for the typing to stop", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      const before = listCalls().length;

      await userEvent.type(screen.getByLabelText("Zoeken"), "volvo");
      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1].search).toBe("volvo");
      });

      expect(listCalls().length - before).toBeLessThan("volvo".length);
    });

    it.each([
      ["Actief", true],
      ["Inactief", false],
    ])("filters on %s", async (label, expected) => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
          "radio",
          { name: label },
        ),
      );

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1]).toMatchObject({
          isActive: expected,
        });
      });
    });

    it("asks for every status again with Alle", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      const group = screen.getByRole("radiogroup", { name: "Status" });

      await userEvent.click(within(group).getByRole("radio", { name: "Actief" }));
      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1].isActive).toBe(true);
      });

      await userEvent.click(within(group).getByRole("radio", { name: "Alle" }));

      await waitFor(() => {
        expect(listCalls()[listCalls().length - 1].isActive).toBeUndefined();
      });
    });

    /** There is no vehicle type in the model, so there is no type filter. */
    it("offers no type filter", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");

      expect(screen.queryByLabelText(/type/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("columnheader", { name: "Type" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("creating", () => {
    it("sends exactly the fields the backend accepts", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw voertuig" }),
      );

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("Nummerplaat"),
        "9-NEW-999",
      );
      // A native colour input, so its value is set rather than typed.
      fireEvent.change(within(dialog).getByLabelText("Planningskleur"), {
        target: { value: "#16A34A" },
      });
      await userEvent.type(within(dialog).getByLabelText("Merk"), "Scania");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][1]).toEqual({
          method: "POST",
          body: {
            licensePlate: "9-NEW-999",
            // Canonicalised to lowercase, as the backend stores it.
            displayColor: "#16a34a",
            brand: "Scania",
            model: null,
          },
        });
      });
      expect(
        await screen.findByText("Voertuig aangemaakt"),
      ).toBeInTheDocument();
    });

    /** The model has no such column; sending one would be a 400. */
    it("offers no type field", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw voertuig" }),
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).queryByLabelText(/type/i)).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/actief/i)).not.toBeInTheDocument();
    });

    /**
     * Bouwjaar, Omschrijving and Notities were never used in planning, and
     * every optional field is a tax on the person filling the form in daily.
     * They are not asked for and not sent, so an existing vehicle that has
     * them keeps them — a PATCH that omits a field leaves it untouched.
     */
    it("asks only for what identifies a truck in the planning", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw voertuig" }),
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Nummerplaat")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Merk")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Model")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Planningskleur")).toBeInTheDocument();

      expect(within(dialog).queryByLabelText("Bouwjaar")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByLabelText("Omschrijving"),
      ).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText("Notities")).not.toBeInTheDocument();
    });

    describe("the planning colour", () => {
      async function openForm(): Promise<HTMLElement> {
        respondWith(buildPage([buildVehicle()]));

        renderVehicles();
        await screen.findByRole("table");
        await userEvent.click(
          screen.getByRole("button", { name: "+ Nieuw voertuig" }),
        );

        return screen.findByRole("dialog");
      }

      /** A colour, chosen as a colour — not typed as a hex code. */
      it("is picked visually rather than typed", async () => {
        const dialog = await openForm();

        expect(within(dialog).getByLabelText("Planningskleur")).toHaveAttribute(
          "type",
          "color",
        );
      });

      it("offers a palette that fills the picker in one click", async () => {
        const dialog = await openForm();

        await userEvent.click(
          within(dialog).getByRole("button", { name: "#dc2626" }),
        );

        expect(within(dialog).getByLabelText("Planningskleur")).toHaveValue(
          "#dc2626",
        );
      });

      /**
       * A fleet of twenty trucks needs twenty colours that are tellable apart.
       * The palette is one shared list — `lib/fleet-colors.ts` — so this counts
       * what the form actually renders rather than trusting the constant.
       */
      it("offers enough colours for a fleet of twenty", async () => {
        const dialog = await openForm();

        const swatches = within(dialog)
          .getAllByRole("button")
          .filter((button) => /^#[0-9a-f]{6}$/.test(button.getAttribute("aria-label") ?? ""));

        expect(swatches.length).toBeGreaterThanOrEqual(20);
        // Every swatch distinct: two trucks a shade apart help nobody.
        expect(
          new Set(swatches.map((button) => button.getAttribute("aria-label"))).size,
        ).toBe(swatches.length);
      });

      it("keeps the native picker beside the swatches", async () => {
        const dialog = await openForm();

        expect(within(dialog).getByLabelText("Planningskleur")).toHaveAttribute(
          "type",
          "color",
        );
        expect(
          within(dialog).getByRole("button", { name: "#7c3aed" }),
        ).toBeInTheDocument();
      });

      it("marks the palette colour currently in use", async () => {
        const dialog = await openForm();

        await userEvent.click(
          within(dialog).getByRole("button", { name: "#dc2626" }),
        );

        expect(
          within(dialog).getByRole("button", { name: "#dc2626" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      it("sends what was picked", async () => {
        const dialog = await openForm();

        await userEvent.type(
          within(dialog).getByLabelText("Nummerplaat"),
          "9-NEW-999",
        );
        await userEvent.click(
          within(dialog).getByRole("button", { name: "#059669" }),
        );
        await userEvent.click(
          within(dialog).getByRole("button", { name: "Opslaan" }),
        );

        await waitFor(() => {
          expect(mutationCalls()[0][1]).toMatchObject({
            body: { displayColor: "#059669" },
          });
        });
      });
    });

    it("keeps the dialog open and shows the backend's validation detail", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw voertuig" }),
      );

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("Nummerplaat"),
        "1-ABC-123",
      );

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Validation failed", 409, [
          "licensePlate is already used by an active vehicle",
        ]),
      );

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      expect(
        await within(dialog).findByText(/already used by an active vehicle/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("refetches after a successful create", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      const before = listCalls().length;

      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuw voertuig" }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("Nummerplaat"),
        "9-NEW-999",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(listCalls().length).toBeGreaterThan(before);
      });
    });
  });

  describe("editing", () => {
    it("opens with the current values and PATCHes", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Nummerplaat")).toHaveValue(
        "1-ABC-123",
      );
      expect(within(dialog).getByLabelText("Merk")).toHaveValue("Volvo");

      await userEvent.clear(within(dialog).getByLabelText("Merk"));
      await userEvent.type(within(dialog).getByLabelText("Merk"), "Scania");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe("/api/v1/vehicles/vehicle-1");
      });
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "PATCH",
        body: { brand: "Scania" },
      });
    });

    /** Emptying a field means "clear it", which the backend spells null. */
    it("clears an emptied field with null", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");
      await userEvent.clear(within(dialog).getByLabelText("Merk"));
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(
          (mutationCalls()[0][1] as { body: { brand: unknown } }).body.brand,
        ).toBeNull();
      });
    });

    it("closes without sending anything when cancelled", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Annuleren",
        }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(mutationCalls()).toHaveLength(0);
    });
  });

  describe("activation", () => {
    /** Deactivation is the only removal this domain has, and it is reversible. */
    it("deactivates through the deactivation sub-resource, after confirming", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/vehicles/vehicle-1/deactivation",
        );
      });
      expect(mutationCalls()[0][1]).toMatchObject({ method: "PATCH" });
      expect(
        await screen.findByText("Voertuig gedeactiveerd"),
      ).toBeInTheDocument();
    });

    it("sends nothing when the confirmation is declined", async () => {
      confirmSpy.mockReturnValue(false);
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(mutationCalls()).toHaveLength(0);
    });

    it("activates an inactive vehicle without a confirmation", async () => {
      respondWith(buildPage([buildVehicle({ isActive: false })]));

      renderVehicles();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Activeren" }));

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/vehicles/vehicle-1/activation",
        );
      });
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    /** An inactive Vehicle stays listed: history still refers to it. */
    it("keeps an inactive vehicle visible and marked", async () => {
      respondWith(buildPage([buildVehicle({ isActive: false })]));

      renderVehicles();
      const row = (await screen.findByText("1-ABC-123")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("Inactief")).toBeInTheDocument();
    });

    /** The backend has no DELETE, so neither has this page. */
    it("never offers a delete", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");

      expect(
        screen.queryByRole("button", { name: /verwijder/i }),
      ).not.toBeInTheDocument();
      expect(
        mutationCalls().some(
          ([, options]) =>
            (options as { method?: string } | undefined)?.method === "DELETE",
        ),
      ).toBe(false);
    });

    it("reports a refusal in the backend's words", async () => {
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      await screen.findByRole("table");

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Vehicle is booked on an open trip.", 409),
      );

      await userEvent.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(
        await screen.findByText(/Vehicle is booked on an open trip/),
      ).toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("translates the page", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();

      expect(
        await screen.findByRole("heading", { name: "Araçlar", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Ara")).toBeInTheDocument();
      // "Aktif" is both a filter and a status badge; the row's is the one here.
      const row = screen.getByText("1-ABC-123").closest("tr") as HTMLElement;
      expect(within(row).getByText("Aktif")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "+ Yeni araç" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith(buildPage([buildVehicle()]));

      renderVehicles();
      const table = await screen.findByRole("table");
      // The vehicle's own colour is data; everything else is a token.
      const withoutVehicleColor = table.innerHTML.split("#2563eb").join("");

      expect(withoutVehicleColor).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(screen.getByText("1-ABC-123")).toBeInTheDocument();
    });
  });
});
