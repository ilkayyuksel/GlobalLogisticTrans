import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  listCalls,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Inline editing, the pickers and the Custom Properties.
 *
 * The assertions are about what was SENT and what happened afterwards. Two
 * rules run through all of them: an empty field is sent as null rather than as
 * an empty string, because that is what the backend documents as "clear this";
 * and nothing on screen changes until the authoritative data has been refetched.
 */
describe("Ritten editing", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showTrip(overrides = {}) {
    respondWith(requestMock, {
      trips: buildPage([buildTrip(overrides)]),
      availableCustomProperties: [
        { id: "prop-1", name: "Wachttijd", isActive: true },
        { id: "prop-2", name: "ADR toeslag", isActive: true },
      ],
    });

    renderRitten();

    return (await screen.findByRole("table")) as HTMLTableElement;
  }

  /** Opens a cell's editor by its accessible name. */
  async function openCell(label: string): Promise<void> {
    await userEvent.click(await screen.findByRole("button", { name: label }));
  }

  function patchCalls() {
    return mutationCalls(requestMock).filter(
      ([path, options]) =>
        options?.method === "PATCH" && path === "/api/v1/trips/trip-1",
    );
  }

  describe("a text cell", () => {
    it("opens for editing with the current value", async () => {
      await showTrip();
      await openCell("Containernummer");

      expect(screen.getByLabelText("Containernummer")).toHaveValue(
        "MSKU1234567",
      );
    });

    it("saves what was typed", async () => {
      await showTrip();
      await openCell("Containernummer");

      const input = screen.getByLabelText("Containernummer");
      await userEvent.clear(input);
      await userEvent.type(input, "TCLU7654321");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({
          containerNumber: "TCLU7654321",
        });
      });
    });

    it("closes without sending anything when cancelled", async () => {
      await showTrip();
      await openCell("Containernummer");

      await userEvent.type(
        screen.getByLabelText("Containernummer"),
        "SOMETHING",
      );
      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      // The editor is gone; the cell is a button showing the stored value again.
      expect(
        screen.queryByRole("textbox", { name: "Containernummer" }),
      ).not.toBeInTheDocument();
      expect(patchCalls()).toHaveLength(0);
    });

    /** The backend spells "no value" as null; "" would be a different thing. */
    it("sends null when the field is emptied", async () => {
      await showTrip();
      await openCell("Containernummer");

      await userEvent.clear(screen.getByLabelText("Containernummer"));
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({ containerNumber: null });
      });
    });

    it("refetches the list rather than painting the new value itself", async () => {
      await showTrip();
      const before = listCalls(requestMock).length;

      await openCell("Containernummer");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(before);
      });
    });
  });

  describe("when the backend refuses", () => {
    function refuseWith(error: unknown) {
      const original = requestMock.getMockImplementation();

      requestMock.mockImplementation((...args: unknown[]) => {
        const [path, options] = args as [string, { method?: string }];

        if (options?.method === "PATCH" && path.startsWith("/api/v1/trips/")) {
          return Promise.reject(error);
        }

        return original
          ? (original as (...called: unknown[]) => Promise<unknown>)(...args)
          : Promise.resolve({});
      });
    }

    it("keeps the editor open and shows the message", async () => {
      await showTrip();
      refuseWith(
        new ApiError("BAD_REQUEST", "Validation failed", 400, [
          "containerNumber must be shorter than or equal to 100 characters",
        ]),
      );

      await openCell("Containernummer");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(await screen.findByText("Validation failed")).toBeInTheDocument();
      expect(screen.getByLabelText("Containernummer")).toBeInTheDocument();
    });

    /** The field-level detail is the useful half of a validation failure. */
    it("shows the backend's field-level details", async () => {
      await showTrip();
      refuseWith(
        new ApiError("BAD_REQUEST", "Validation failed", 400, [
          "containerNumber must be shorter than or equal to 100 characters",
        ]),
      );

      await openCell("Containernummer");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(
        await screen.findByText(/must be shorter than or equal to 100/),
      ).toBeInTheDocument();
    });

    it("reports the failure on the page as well", async () => {
      await showTrip();
      refuseWith(new ApiError("CONFLICT", "Trip is closed.", 409));

      await openCell("Containernummer");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(await screen.findByText(/Actie mislukt/)).toBeInTheDocument();
    });
  });

  describe("the planning date", () => {
    it("saves a new date", async () => {
      await showTrip();
      await openCell("Planningsdatum");

      const input = screen.getByLabelText("Planningsdatum");
      await userEvent.clear(input);
      await userEvent.type(input, "2026-08-20");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({
          planningDate: "2026-08-20",
        });
      });
    });

    /** There is no null for a planning date, so an emptied box is a mistake. */
    it("refuses to send an empty date", async () => {
      await showTrip();
      await openCell("Planningsdatum");

      await userEvent.clear(screen.getByLabelText("Planningsdatum"));
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(
        await screen.findByText("Dit veld is verplicht."),
      ).toBeInTheDocument();
      expect(patchCalls()).toHaveLength(0);
    });
  });

  /**
   * Hours and minutes on screen; ONE integer in the database. The conversion is
   * shared with the Trip detail page, so these tests are about the editor and
   * about what reaches the backend.
   */
  describe("waiting time", () => {
    async function openWaitingTime(): Promise<void> {
      await userEvent.click(
        await screen.findByRole("button", { name: "Wachttijd in minuten" }),
      );
    }

    it("shows a compact reading rather than raw minutes", async () => {
      await showTrip({ waitingTimeMinutes: 90 });

      expect(
        await screen.findByRole("button", { name: "Wachttijd in minuten" }),
      ).toHaveTextContent("1 u 30 min");
    });

    it("opens with the stored value split into hours and minutes", async () => {
      await showTrip({ waitingTimeMinutes: 135 });
      await openWaitingTime();

      expect(screen.getByLabelText("uur")).toHaveValue(2);
      expect(screen.getByLabelText("min")).toHaveValue(15);
    });

    it("saves hours and minutes as total minutes", async () => {
      await showTrip({ waitingTimeMinutes: null });
      await openWaitingTime();

      await userEvent.clear(screen.getByLabelText("uur"));
      await userEvent.type(screen.getByLabelText("uur"), "1");
      await userEvent.clear(screen.getByLabelText("min"));
      await userEvent.type(screen.getByLabelText("min"), "30");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({ waitingTimeMinutes: 90 });
      });
    });

    it("sends null when both fields are emptied", async () => {
      await showTrip({ waitingTimeMinutes: 45 });
      await openWaitingTime();

      await userEvent.clear(screen.getByLabelText("uur"));
      await userEvent.clear(screen.getByLabelText("min"));
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({ waitingTimeMinutes: null });
      });
    });

    /** Refused rather than silently rewritten as 2 u 30 min. */
    it("refuses 90 minutes instead of normalising it", async () => {
      await showTrip({ waitingTimeMinutes: 60 });
      await openWaitingTime();

      await userEvent.clear(screen.getByLabelText("min"));
      await userEvent.type(screen.getByLabelText("min"), "90");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(
        await screen.findByText("Minuten moeten tussen 0 en 59 liggen."),
      ).toBeInTheDocument();
      expect(patchCalls()).toHaveLength(0);
    });

    it("refuses a fractional hour", async () => {
      await showTrip({ waitingTimeMinutes: 60 });
      await openWaitingTime();

      await userEvent.clear(screen.getByLabelText("uur"));
      await userEvent.type(screen.getByLabelText("uur"), "1.5");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(
        await screen.findByText("Uren moeten een heel getal zijn."),
      ).toBeInTheDocument();
      expect(patchCalls()).toHaveLength(0);
    });

    it("cancels without sending anything", async () => {
      await showTrip({ waitingTimeMinutes: 60 });
      await openWaitingTime();

      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      expect(screen.queryByLabelText("uur")).not.toBeInTheDocument();
      expect(patchCalls()).toHaveLength(0);
    });

    it("refetches after a successful save", async () => {
      await showTrip({ waitingTimeMinutes: 60 });
      const before = listCalls(requestMock).length;

      await openWaitingTime();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(listCalls(requestMock).length).toBeGreaterThan(before);
      });
    });

    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip({ waitingTimeMinutes: 90 });

      await userEvent.click(
        await screen.findByRole("button", { name: "Bekleme süresi (dakika)" }),
      );

      expect(screen.getByLabelText("saat")).toHaveValue(1);
      expect(screen.getByLabelText("dk")).toHaveValue(30);
    });
  });

  describe("the vehicle picker", () => {
    it("offers the active vehicles", async () => {
      await showTrip();
      await openCell("Voertuig");

      expect(
        within(screen.getByLabelText("Voertuig")).getByRole("option", {
          name: "1-ABC-123",
        }),
      ).toBeInTheDocument();
    });

    it("assigns the chosen vehicle", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ vehicleId: null, vehicle: null })]),
        vehicles: [
          { id: "vehicle-1", licensePlate: "1-ABC-123" },
          { id: "vehicle-2", licensePlate: "2-DEF-456" },
        ],
      });
      renderRitten();
      await screen.findByRole("table");

      await openCell("Voertuig");
      await userEvent.selectOptions(
        screen.getByLabelText("Voertuig"),
        "vehicle-2",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({ vehicleId: "vehicle-2" });
      });
    });

    it("clears the assignment with null", async () => {
      await showTrip();
      await openCell("Voertuig");

      await userEvent.selectOptions(screen.getByLabelText("Voertuig"), "");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toEqual({ vehicleId: null });
      });
    });

    /**
     * A vehicle deactivated after it was assigned is absent from the active
     * list. Dropping it would silently unassign the truck on the next save.
     */
    it("keeps an inactive current vehicle in the list, marked", async () => {
      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({
            vehicleId: "vehicle-old",
            vehicle: {
              id: "vehicle-old",
              licensePlate: "9-OLD-999",
              displayColor: "#2563eb",
              isActive: false,
            },
          }),
        ]),
        vehicles: [{ id: "vehicle-1", licensePlate: "1-ABC-123" }],
      });
      renderRitten();
      await screen.findByRole("table");

      await openCell("Voertuig");

      expect(
        within(screen.getByLabelText("Voertuig")).getByRole("option", {
          name: "9-OLD-999 (inactief)",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("the driver", () => {
    /**
     * The driver belongs to the vehicle, not to the Trip.
     *
     * There is no per-Trip driver picker any more: who drives is decided once,
     * as a Driver assignment on the vehicle with a validity period. The row
     * therefore only reports what the backend resolved from that assignment for
     * this Trip's planning date.
     */
    it("shows the effective driver without offering to change it", async () => {
      await showTrip({
        effectiveDriver: {
          id: "driver-2",
          name: "Ayşe Yılmaz",
          isActive: true,
          source: "VEHICLE_ASSIGNMENT",
        },
      });

      expect(screen.getByText("Ayşe Yılmaz")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Chauffeur/ }),
      ).not.toBeInTheDocument();
    });

    it("never asks the backend for the driver list", async () => {
      await showTrip();

      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).startsWith("/api/v1/drivers"),
        ),
      ).toHaveLength(0);
    });
  });

  describe("fields without a column", () => {
    async function openDetails(): Promise<void> {
      await userEvent.click(
        await screen.findByRole("button", { name: /Acties ANRDUB2602247/ }),
      );
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Details bewerken" }),
      );
    }

    it("edits distance, execution time and notes together", async () => {
      await showTrip();
      await openDetails();

      await userEvent.type(screen.getByLabelText("Afstand in km"), "132.5");
      await userEvent.type(
        screen.getByLabelText("Interne notities"),
        "Chauffeur gebeld",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(patchCalls()[0][1]?.body).toMatchObject({
          distanceKm: 132.5,
          internalNotes: "Chauffeur gebeld",
          executionDatetime: null,
        });
      });
    });

    /** Both are parser-controlled, and the backend refuses them. */
    it("never offers the start or end time", async () => {
      await showTrip();
      await openDetails();

      const dialog = screen.getByRole("dialog");

      expect(within(dialog).queryByLabelText(/Begin/)).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/Eind/)).not.toBeInTheDocument();
    });
  });

  describe("custom properties", () => {
    async function openCustom(): Promise<HTMLElement> {
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Custom waarden beheren ANRDUB2602247",
        }),
      );

      return screen.findByRole("dialog");
    }

    it("lists what is assigned and what can be added", async () => {
      await showTrip();
      respondWith(requestMock, {
        trips: buildPage([buildTrip()]),
        assignedCustomProperties: [
          {
            id: "assignment-1",
            tripId: "trip-1",
            customPropertyId: "prop-1",
            customProperty: { id: "prop-1", name: "Wachttijd", isActive: true },
          },
        ],
        availableCustomProperties: [
          { id: "prop-1", name: "Wachttijd", isActive: true },
          { id: "prop-2", name: "ADR toeslag", isActive: true },
        ],
      });

      const dialog = await openCustom();

      expect(await within(dialog).findByText("Wachttijd")).toBeInTheDocument();
      // Already assigned, so it is not offered again.
      expect(
        within(dialog).getByRole("button", { name: "+ ADR toeslag" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "+ Wachttijd" }),
      ).not.toBeInTheDocument();
    });

    it("assigns a property through the existing endpoint", async () => {
      await showTrip();
      const dialog = await openCustom();

      await userEvent.click(
        await within(dialog).findByRole("button", { name: "+ ADR toeslag" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trip-custom-properties",
          expect.objectContaining({
            method: "POST",
            body: { tripId: "trip-1", customPropertyId: "prop-2" },
          }),
        );
      });
    });

    it("allows several properties, one request each", async () => {
      await showTrip();
      const dialog = await openCustom();

      await userEvent.click(
        await within(dialog).findByRole("button", { name: "+ Wachttijd" }),
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "+ ADR toeslag" }),
      );

      await waitFor(() => {
        expect(
          mutationCalls(requestMock).filter(
            ([path, options]) =>
              path === "/api/v1/trip-custom-properties" &&
              options?.method === "POST",
          ),
        ).toHaveLength(2);
      });
    });

    it("removes an assignment by its own id", async () => {
      await showTrip();
      respondWith(requestMock, {
        trips: buildPage([buildTrip()]),
        assignedCustomProperties: [
          {
            id: "assignment-1",
            tripId: "trip-1",
            customPropertyId: "prop-1",
            customProperty: { id: "prop-1", name: "Wachttijd", isActive: true },
          },
        ],
      });

      const dialog = await openCustom();
      await userEvent.click(
        await within(dialog).findByRole("button", { name: "Verwijderen" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trip-custom-properties/assignment-1",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    /** It is still on the Trip and still in its pricing history. */
    it("keeps an assigned property that has since been deactivated, marked", async () => {
      await showTrip();
      respondWith(requestMock, {
        trips: buildPage([buildTrip()]),
        assignedCustomProperties: [
          {
            id: "assignment-9",
            tripId: "trip-1",
            customPropertyId: "prop-9",
            customProperty: {
              id: "prop-9",
              name: "Oude toeslag",
              isActive: false,
            },
          },
        ],
        availableCustomProperties: [],
      });

      const dialog = await openCustom();

      expect(
        await within(dialog).findByText("Oude toeslag"),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("inactief")).toBeInTheDocument();
    });

    it("reports a failed assignment without closing the dialog", async () => {
      await showTrip();
      const dialog = await openCustom();

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Deze waarde is al toegewezen.", 409),
      );

      await userEvent.click(
        await within(dialog).findByRole("button", { name: "+ Wachttijd" }),
      );

      expect(
        await within(dialog).findByText("Deze waarde is al toegewezen."),
      ).toBeInTheDocument();
    });
  });

  describe("in Turkish", () => {
    it("translates the editors", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip();

      await userEvent.click(
        await screen.findByRole("button", { name: "Konteyner numarası" }),
      );

      expect(
        screen.getByRole("button", { name: "Kaydet" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Vazgeç" })).toBeInTheDocument();
    });
  });
});
