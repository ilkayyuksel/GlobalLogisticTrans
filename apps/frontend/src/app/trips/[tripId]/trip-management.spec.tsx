import { render as renderBare, screen, waitFor } from "@testing-library/react";
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
import { getPricingSnapshot, reprocessTripPricing } from "@/lib/api/pricing";
import {
  changeTripStatus,
  deleteTrip,
  getTrip,
  restoreTrip,
  updateTrip,
} from "@/lib/api/trips";
import type { PricingSnapshot, Trip, TripPricingItem } from "@/lib/api/types";

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
const changeStatusMock = changeTripStatus as jest.MockedFunction<
  typeof changeTripStatus
>;
const deleteTripMock = deleteTrip as jest.MockedFunction<typeof deleteTrip>;
const restoreTripMock = restoreTrip as jest.MockedFunction<typeof restoreTrip>;
const getPricingSnapshotMock = getPricingSnapshot as jest.MockedFunction<
  typeof getPricingSnapshot
>;
const reprocessMock = reprocessTripPricing as jest.MockedFunction<
  typeof reprocessTripPricing
>;
const getVehicleMock = getVehicle as jest.MockedFunction<typeof getVehicle>;

const listActiveVehiclesMock = listActiveVehicles as jest.MockedFunction<
  typeof listActiveVehicles
>;
const listActiveDriversMock = listActiveDrivers as jest.MockedFunction<
  typeof listActiveDrivers
>;

/** Two active records, enough for the pickers to have something to offer. */
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
      phoneNumber: null,
      email: null,
      isActive: true,
    },
    {
      id: "driver-2",
      name: "Ahmet Yilmaz",
      licenceNumber: null,
      phoneNumber: null,
      email: null,
      isActive: true,
    },
  ],
  meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
};

const listCustomPropertiesMock =
  listTripCustomProperties as jest.MockedFunction<
    typeof listTripCustomProperties
  >;

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
    status: "OPEN",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "PVDU 301326/0",
    containerType: "45PH",
    terminal: "PSA Antwerp",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: "2025-05-22",
    planningDate: "2025-05-22",
    startTime: "10:00",
    endTime: "16:00",
    executionDatetime: null,
    waitingTimeMinutes: 45,
    distanceKm: "198.00",
    internalNotes: "Customer confirmed by phone.",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildSnapshot(): PricingSnapshot {
  const item: TripPricingItem = {
    id: "item-1",
    tripPricingId: "pricing-1",
    pricingComponentId: "component-1",
    pricingComponentCode: "BASE_PRICE",
    customPropertyId: null,
    description: "Base price",
    amount: "400.00",
    currency: "EUR",
    calculationOrder: 1,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  return {
    pricing: {
      id: "pricing-1",
      tripId: "trip-1",
      totalPrice: "400.00",
      currency: "EUR",
      calculatedAt: "2026-08-12T09:30:00.000Z",
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "2026.1",
      calculationStatus: "CALCULATED",
      notes: null,
      createdAt: "2026-08-12T09:30:00.000Z",
      updatedAt: "2026-08-12T09:30:00.000Z",
    },
    items: [item],
  };
}

/** Every confirmation is accepted unless a test says otherwise. */
function acceptConfirmations() {
  return jest.spyOn(window, "confirm").mockReturnValue(true);
}

describe("Trip management", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getTripMock.mockResolvedValue(buildTrip());
    getPricingSnapshotMock.mockResolvedValue(null);
    listCustomPropertiesMock.mockResolvedValue([]);
    getVehicleMock.mockReset();
    listActiveVehiclesMock.mockResolvedValue(ACTIVE_VEHICLES);
    listActiveDriversMock.mockResolvedValue(ACTIVE_DRIVERS);
    confirmSpy = acceptConfirmations();
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  describe("which transitions are offered", () => {
    it("offers close and cancel for an OPEN trip", async () => {
      render(<TripDetailPage />);

      expect(
        await screen.findByRole("button", { name: "Afwerken" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Annuleren" }),
      ).toBeInTheDocument();
    });

    /** CLOSED is terminal: a pricing snapshot exists from that point on. */
    it("offers no status change for a CLOSED trip", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(screen.queryByRole("button", { name: "Afwerken" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Annuleren" })).not.toBeInTheDocument();
    });

    it("offers reopening for a CANCELLED trip", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "CANCELLED" }));

      render(<TripDetailPage />);

      expect(
        await screen.findByRole("button", { name: "Heropenen" }),
      ).toBeInTheDocument();
    });

    it("offers only restoration for a DELETED trip", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "DELETED" }));

      render(<TripDetailPage />);

      expect(
        await screen.findByRole("button", { name: "Herstellen" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Details bewerken" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Verwijderen" })).not.toBeInTheDocument();
    });
  });

  describe("changing status", () => {
    it("sends the target status the backend expects", async () => {
      changeStatusMock.mockResolvedValue(buildTrip({ status: "CANCELLED" }));

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Annuleren" }),
      );

      await waitFor(() => {
        expect(changeStatusMock).toHaveBeenCalledWith("trip-1", "CANCELLED");
      });
    });

    it("asks for confirmation before closing, and stops if declined", async () => {
      confirmSpy.mockReturnValue(false);

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Afwerken" }),
      );

      expect(confirmSpy).toHaveBeenCalled();
      expect(changeStatusMock).not.toHaveBeenCalled();
    });

    it("refetches the trip after a successful change", async () => {
      changeStatusMock.mockResolvedValue(buildTrip({ status: "CANCELLED" }));

      render(<TripDetailPage />);
      await screen.findByText("Rit ANRDUB2602247");
      const callsBefore = getTripMock.mock.calls.length;

      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      await waitFor(() => {
        expect(getTripMock.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });

    it("shows the backend's message when a transition is rejected", async () => {
      changeStatusMock.mockRejectedValue(
        new ApiError(
          "CONFLICT",
          "A Trip cannot move from CLOSED to OPEN. Allowed from CLOSED: no further transitions.",
          409,
        ),
      );

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Annuleren" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /cannot move from CLOSED to OPEN/i,
      );
    });

    it("leaves the trip unchanged on screen when the backend refuses", async () => {
      changeStatusMock.mockRejectedValue(
        new ApiError("CONFLICT", "Not allowed.", 409),
      );

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Annuleren" }),
      );

      await screen.findByRole("alert");

      expect(screen.getByText("OPEN")).toBeInTheDocument();
    });
  });

  describe("closing a trip and its automatic pricing", () => {
    /**
     * Closing succeeds and pricing succeeds. The page must show pricing it read
     * back from the backend, not pricing it assumed.
     */
    it("shows pricing that the refetch found", async () => {
      changeStatusMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getTripMock
        .mockResolvedValueOnce(buildTrip())
        .mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getPricingSnapshotMock
        .mockResolvedValueOnce(null)
        .mockResolvedValue(buildSnapshot());

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Afwerken" }),
      );

      // The single line and the total are both 400.00, so both must appear.
      expect(await screen.findAllByText("400.00 EUR")).toHaveLength(2);
      expect(screen.queryByText("Prijs vraagt aandacht")).not.toBeInTheDocument();
    });

    /**
     * The critical case: the status call succeeded but pricing did not produce
     * a snapshot. The Trip must still read CLOSED, and the page must say
     * pricing needs attention rather than implying success.
     */
    it("shows CLOSED with a recoverable pricing state when pricing did not happen", async () => {
      changeStatusMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getTripMock
        .mockResolvedValueOnce(buildTrip())
        .mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getPricingSnapshotMock.mockResolvedValue(null);

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Afwerken" }),
      );

      expect(await screen.findByText("Prijs vraagt aandacht")).toBeInTheDocument();
      expect(screen.getByText("CLOSED")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /prijs opnieuw berekenen/i }),
      ).toBeEnabled();
    });

    it("does not claim pricing succeeded just because the status changed", async () => {
      changeStatusMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getTripMock
        .mockResolvedValueOnce(buildTrip())
        .mockResolvedValue(buildTrip({ status: "CLOSED" }));
      getPricingSnapshotMock.mockResolvedValue(null);

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Afwerken" }),
      );

      await screen.findByText("Prijs vraagt aandacht");

      // The success notice reports what actually happened — the status change —
      // and points at the pricing panel rather than asserting a price exists.
      const notice = screen.getByText(/rit afgewerkt/i);
      expect(notice).toHaveTextContent(/prijsvenster/i);
      expect(notice).not.toHaveTextContent(/prijs berekend|prijs volledig/i);
    });
  });

  describe("delete and restore", () => {
    it("uses the deletion sub-resource, never an HTTP DELETE", async () => {
      deleteTripMock.mockResolvedValue(buildTrip({ status: "DELETED" }));

      render(<TripDetailPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Verwijderen" }));

      await waitFor(() => {
        expect(deleteTripMock).toHaveBeenCalledWith("trip-1");
      });
    });

    it("asks for confirmation before deleting", async () => {
      confirmSpy.mockReturnValue(false);

      render(<TripDetailPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Verwijderen" }));

      expect(deleteTripMock).not.toHaveBeenCalled();
    });

    it("does not offer deletion for a CLOSED trip", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));

      render(<TripDetailPage />);
      await screen.findByText("Rit ANRDUB2602247");

      expect(screen.queryByRole("button", { name: "Verwijderen" })).not.toBeInTheDocument();
    });

    it("restores a deleted trip", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "DELETED" }));
      restoreTripMock.mockResolvedValue(buildTrip({ status: "OPEN" }));

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Herstellen" }),
      );

      await waitFor(() => {
        expect(restoreTripMock).toHaveBeenCalledWith("trip-1");
      });
    });

    it("explains that a deleted trip is read-only", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "DELETED" }));

      render(<TripDetailPage />);

      expect(await screen.findByText(/deze rit is verwijderd/i)).toBeInTheDocument();
    });

    it("reports a refused restoration in the backend's words", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "DELETED" }));
      restoreTripMock.mockRejectedValue(
        new ApiError(
          "CONFLICT",
          "Another Trip has taken this booking number.",
          409,
        ),
      );

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "Herstellen" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Another Trip has taken this booking number.",
      );
    });
  });

  describe("editing", () => {
    async function openEditor() {
      render(<TripDetailPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Details bewerken" }));
    }

    it("offers exactly the manually editable fields", async () => {
      await openEditor();

      expect(screen.getByLabelText("Datum")).toBeInTheDocument();
      expect(screen.getByLabelText("Container")).toBeInTheDocument();
      // Waiting time is entered as hours and minutes; the column stays minutes.
      expect(screen.getByLabelText("uur")).toBeInTheDocument();
      expect(screen.getByLabelText("min")).toBeInTheDocument();
      expect(screen.getByLabelText("Afstand (km)")).toBeInTheDocument();
      expect(screen.getByLabelText("Uitgevoerd op")).toBeInTheDocument();
      expect(screen.getByLabelText("Interne notities")).toBeInTheDocument();
    });

    /**
     * The backend validates with forbidNonWhitelisted, so offering any of these
     * would produce a guaranteed 400 — and would imply the system supports
     * something it deliberately does not.
     */
    it.each([
      "Booking number",
      "Status",
      "Terminal",
      "Cntr type",
      "Bestemming stad",
      "Bestemming land",
      "Oorspronkelijke datum",
      "Start time",
      "End time",
    ])("does not offer %s as editable", async (label) => {
      await openEditor();

      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    });

    it("pre-fills the current values", async () => {
      await openEditor();

      expect(screen.getByLabelText("Datum")).toHaveValue("2025-05-22");
      expect(screen.getByLabelText("Container")).toHaveValue(
        "PVDU 301326/0",
      );
      expect(screen.getByLabelText("uur")).toHaveValue(0);
      expect(screen.getByLabelText("min")).toHaveValue(45);
    });

    it("saves the edited values", async () => {
      updateTripMock.mockResolvedValue(buildTrip({ internalNotes: "Updated." }));

      await openEditor();

      const notes = screen.getByLabelText("Interne notities");
      await userEvent.clear(notes);
      await userEvent.type(notes, "Updated.");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(updateTripMock).toHaveBeenCalledWith(
          "trip-1",
          expect.objectContaining({ internalNotes: "Updated." }),
        );
      });
    });

    /** Null is how the backend documents "clear this value". */
    it("sends null for a field the user emptied", async () => {
      updateTripMock.mockResolvedValue(buildTrip({ containerNumber: null }));

      await openEditor();

      await userEvent.clear(screen.getByLabelText("Container"));
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(updateTripMock).toHaveBeenCalledWith(
          "trip-1",
          expect.objectContaining({ containerNumber: null }),
        );
      });
    });

    it("never sends an immutable field", async () => {
      updateTripMock.mockResolvedValue(buildTrip());

      await openEditor();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(updateTripMock).toHaveBeenCalled());

      const [, payload] = updateTripMock.mock.calls[0];

      // Exactly the fields UpdateTripDto accepts — no booking number, status,
      // terminal, destination or times, all of which the backend rejects.
      expect(Object.keys(payload).sort()).toEqual([
        "containerNumber",
        "distanceKm",
        "executionDatetime",
        "internalNotes",
        "planningDate",
        "vehicleId",
        "waitingTimeMinutes",
      ]);
    });

    it("shows the backend's field-level validation errors", async () => {
      updateTripMock.mockRejectedValue(
        new ApiError("VALIDATION_ERROR", "Validation failed.", 400, [
          "waitingTimeMinutes must not be greater than 10080",
        ]),
      );

      await openEditor();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      expect(
        await screen.findByText(
          "waitingTimeMinutes must not be greater than 10080",
        ),
      ).toBeInTheDocument();
    });

    it("keeps the form open when saving fails", async () => {
      updateTripMock.mockRejectedValue(
        new ApiError("VALIDATION_ERROR", "Validation failed.", 400),
      );

      await openEditor();
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await screen.findByRole("alert");

      expect(screen.getByLabelText("Interne notities")).toBeInTheDocument();
    });

    it("closes the form and refetches after a successful save", async () => {
      updateTripMock.mockResolvedValue(buildTrip());

      await openEditor();
      const callsBefore = getTripMock.mock.calls.length;
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(screen.queryByLabelText("Interne notities")).not.toBeInTheDocument();
      });
      expect(getTripMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it("discards changes on cancel without calling the backend", async () => {
      await openEditor();

      await userEvent.click(screen.getByRole("button", { name: "Wijzigingen verwerpen" }));

      expect(updateTripMock).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Interne notities")).not.toBeInTheDocument();
    });
  });

  describe("reprocessing pricing", () => {
    beforeEach(() => {
      getTripMock.mockResolvedValue(buildTrip({ status: "CLOSED" }));
    });

    it("asks the backend to reprocess and then refetches", async () => {
      reprocessMock.mockResolvedValue(buildSnapshot());

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      await waitFor(() => expect(reprocessMock).toHaveBeenCalledWith("trip-1"));
      await waitFor(() =>
        expect(getPricingSnapshotMock.mock.calls.length).toBeGreaterThan(1),
      );
    });

    it("reports the backend's refusal without inventing a message", async () => {
      reprocessMock.mockRejectedValue(
        new ApiError(
          "CONFLICT",
          "No active RouteCost for PSA Antwerp to Dourges.",
          409,
        ),
      );

      render(<TripDetailPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No active RouteCost for PSA Antwerp to Dourges.",
      );
    });
  });
});
