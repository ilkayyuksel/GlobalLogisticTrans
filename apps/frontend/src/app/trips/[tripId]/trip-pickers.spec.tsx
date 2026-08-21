import { render as renderBare, screen, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import userEvent from "@testing-library/user-event";

import TripDetailPage from "./page";
import { ApiError } from "@/lib/api/client";
import {
  getVehicle,
  listActiveDrivers,
  listActiveVehicles,
  listTripCustomProperties,
} from "@/lib/api/fleet";
import { getPricingSnapshot } from "@/lib/api/pricing";
import {
  getTrip,
  listTripDocuments,
  updateTrip,
} from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/trips");
jest.mock("@/lib/api/pricing");
jest.mock("@/lib/api/fleet");
jest.mock("next/navigation", () => ({
  useParams: () => ({ tripId: "trip-1" }),
}));

/**
 * The page reads its text from the language context, so every render needs the
 * provider. Wrapped here rather than at each call site: there are dozens, and a
 * spec that forgot one would fail with a context error rather than with what it
 * was actually testing.
 */
function render(ui: React.ReactElement) {
  return renderBare(<LanguageProvider>{ui}</LanguageProvider>);
}

const getTripMock = getTrip as jest.MockedFunction<typeof getTrip>;
const updateTripMock = updateTrip as jest.MockedFunction<typeof updateTrip>;
const getVehicleMock = getVehicle as jest.MockedFunction<typeof getVehicle>;
const getPricingSnapshotMock = getPricingSnapshot as jest.MockedFunction<
  typeof getPricingSnapshot
>;
const listCustomPropertiesMock =
  listTripCustomProperties as jest.MockedFunction<
    typeof listTripCustomProperties
  >;
const listActiveVehiclesMock = listActiveVehicles as jest.MockedFunction<
  typeof listActiveVehicles
>;
const listActiveDriversMock = listActiveDrivers as jest.MockedFunction<
  typeof listActiveDrivers
>;

/**
 * The vehicle and driver pickers.
 *
 * The driver picker sets the OVERRIDE column. What the operator then sees is
 * `effectiveDriver`, which the BACKEND resolves — so every test that checks the
 * displayed driver reads it from a refetched Trip, never from the selection.
 */

const ACTIVE_VEHICLES = {
  items: [
    {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      description: null,
      brand: "Volvo",
      model: "FH16",
      year: 2022,
      notes: null,
      isActive: true,
    },
    {
      id: "vehicle-2",
      licensePlate: "2-XYZ-789",
      displayColor: "#16a34a",
      description: null,
      brand: null,
      model: null,
      year: null,
      notes: null,
      isActive: true,
    },
  ],
  meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
};

const ACTIVE_DRIVERS = {
  items: [
    {
      id: "driver-1",
      name: "Jan Peeters",
      licenceNumber: null,
      emergencyContact: null,
      notes: null,
      phoneNumber: null,
      email: null,
      isActive: true,
    },
    {
      id: "driver-2",
      name: "Ahmet Yilmaz",
      licenceNumber: null,
      emergencyContact: null,
      notes: null,
      phoneNumber: null,
      email: null,
      isActive: true,
    },
  ],
  meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
};

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    customProperties: [],
    direction: null,
    vehicle: null,
    effectiveDriver: null,
    latestUpdate: null,
    costConfirmation: null,
    status: "OPEN",
    bookingNumber: "BK-2026-1001",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Antwerp",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: "2026-08-13",
    planningDate: "2026-08-13",
    startTime: "08:00:00",
    endTime: "12:00:00",
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

async function openEditor() {
  render(<TripDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Details bewerken" }));
  await waitFor(() => expect(listActiveVehiclesMock).toHaveBeenCalled());
}

function vehiclePicker(): HTMLSelectElement {
  return screen.getByLabelText("Nummerplaat") as HTMLSelectElement;
}

describe("The vehicle picker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The document history is its own component with its own tests; here it
    // only has to answer so the rest of the page can render.
    (
      listTripDocuments as jest.MockedFunction<typeof listTripDocuments>
    ).mockResolvedValue([]);
    getTripMock.mockResolvedValue(buildTrip());
    getPricingSnapshotMock.mockResolvedValue(null);
    listCustomPropertiesMock.mockResolvedValue([]);
    getVehicleMock.mockReset();
    listActiveVehiclesMock.mockResolvedValue(ACTIVE_VEHICLES);
    listActiveDriversMock.mockResolvedValue(ACTIVE_DRIVERS);
    updateTripMock.mockResolvedValue(buildTrip());
  });

  describe("the vehicle picker", () => {
    it("offers the active vehicles", async () => {
      await openEditor();

      expect(
        within(vehiclePicker()).getByRole("option", {
          name: "1-ABC-123 · Volvo FH16",
        }),
      ).toBeInTheDocument();
      expect(
        within(vehiclePicker()).getByRole("option", { name: "2-XYZ-789" }),
      ).toBeInTheDocument();
    });

    /** The backend refuses an inactive vehicle, so offering one would mislead. */
    it("asks the backend for active vehicles only", async () => {
      await openEditor();

      expect(listActiveVehiclesMock).toHaveBeenCalled();
    });

    it("does not accept a typed identifier", async () => {
      await openEditor();

      expect(vehiclePicker().tagName).toBe("SELECT");
    });

    it("preselects the trip's current vehicle", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          vehicleId: "vehicle-2",
          vehicle: {
            id: "vehicle-2",
            licensePlate: "2-XYZ-789",
            displayColor: "#16a34a",
            isActive: true,
          },
        }),
      );

      await openEditor();

      expect(vehiclePicker().value).toBe("vehicle-2");
    });

    it("offers an explicit way to leave the trip without a vehicle", async () => {
      await openEditor();

      expect(
        within(vehiclePicker()).getByRole("option", { name: "Geen voertuig" }),
      ).toBeInTheDocument();
    });

    it("sends the chosen vehicle", async () => {
      await openEditor();

      await userEvent.selectOptions(vehiclePicker(), "vehicle-1");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(updateTripMock).toHaveBeenCalledWith(
          "trip-1",
          expect.objectContaining({ vehicleId: "vehicle-1" }),
        );
      });
    });

    /** Null is how the backend documents "unassign". */
    it("sends null when the vehicle is cleared", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          vehicleId: "vehicle-1",
          vehicle: {
            id: "vehicle-1",
            licensePlate: "1-ABC-123",
            displayColor: "#2563eb",
            isActive: true,
          },
        }),
      );

      await openEditor();

      await userEvent.selectOptions(vehiclePicker(), "");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(updateTripMock).toHaveBeenCalledWith(
          "trip-1",
          expect.objectContaining({ vehicleId: null }),
        );
      });
    });

    /**
     * A vehicle deactivated after assignment is absent from the active list.
     * Dropping it would silently unassign the truck on the next save.
     */
    it("keeps a since-deactivated vehicle selected", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          vehicleId: "retired-vehicle",
          vehicle: {
            id: "retired-vehicle",
            licensePlate: "9-OLD-999",
            displayColor: "#94a3b8",
            isActive: false,
          },
        }),
      );

      await openEditor();

      expect(vehiclePicker().value).toBe("retired-vehicle");
      expect(
        within(vehiclePicker()).getByRole("option", {
          name: /9-OLD-999 \(inactief\)/,
        }),
      ).toBeInTheDocument();
    });

    it("shows the backend's refusal", async () => {
      updateTripMock.mockRejectedValue(
        new ApiError("CONFLICT", "Vehicle is already booked for that interval.", 409),
      );

      await openEditor();
      await userEvent.selectOptions(vehiclePicker(), "vehicle-1");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Vehicle is already booked for that interval.",
      );
    });
  });

  /**
   * The driver is no longer chosen here.
   *
   * A Trip is planned onto a truck, and who drives that truck is decided once —
   * as a Driver assignment with a validity period. A per-Trip override was a
   * second manual mechanism: it let the same truck carry two different drivers
   * on one day with nothing to say which was true.
   *
   * The backend column still exists, so these tests pin down the two things
   * that follow: the form does not offer it, and it does not clear it either.
   */
  describe("the driver", () => {
    it("offers no driver picker", async () => {
      await openEditor();

      expect(screen.queryByLabelText(/Chauffeur/i)).not.toBeInTheDocument();
    });

    it("does not fetch the driver list at all", async () => {
      await openEditor();

      expect(listActiveDriversMock).not.toHaveBeenCalled();
    });

    /**
     * Omitting a field leaves it untouched. A Trip that still carries an
     * override from before this change keeps it, rather than losing it to an
     * unrelated edit of the notes.
     */
    it("never writes the override, in either direction", async () => {
      getTripMock.mockResolvedValue(buildTrip({ driverId: "driver-2" }));

      await openEditor();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(updateTripMock).toHaveBeenCalled();
      });
      expect(updateTripMock.mock.calls[0][1]).not.toHaveProperty("driverId");
    });

    /** Whatever the backend resolved is what the page shows afterwards. */
    it("shows the driver the backend resolved from the assignment", async () => {
      getTripMock
        .mockResolvedValueOnce(buildTrip())
        .mockResolvedValue(
          buildTrip({
            effectiveDriver: {
              id: "driver-1",
              name: "Jan Peeters",
              isActive: true,
              source: "VEHICLE_ASSIGNMENT",
            },
            latestUpdate: null,
            costConfirmation: null,
          }),
        );

      await openEditor();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(await screen.findByText("Jan Peeters")).toBeInTheDocument();
      expect(screen.getByText("Via voertuigtoewijzing")).toBeInTheDocument();
    });

    it("refetches the trip rather than trusting what was saved", async () => {
      await openEditor();
      const callsBefore = getTripMock.mock.calls.length;

      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(getTripMock.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });
  });

  describe("loading the options", () => {
    it("asks for the vehicles once, not once per record", async () => {
      await openEditor();

      expect(listActiveVehiclesMock).toHaveBeenCalledTimes(1);
    });

    it("does not load them until the form is opened", async () => {
      render(<TripDetailPage />);
      await screen.findByText("Rit BK-2026-1001");

      expect(listActiveVehiclesMock).not.toHaveBeenCalled();
    });
  });
});
