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
import { getPricingSnapshot, reprocessTripPricing } from "@/lib/api/pricing";
import { getTrip } from "@/lib/api/trips";
import type {
  PricingSnapshot,
  Trip,
  TripCustomProperty,
  TripPricingItem,
} from "@/lib/api/types";

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
    status: "CLOSED",
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
    internalNotes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildItem(overrides: Partial<TripPricingItem> = {}): TripPricingItem {
  return {
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
    ...overrides,
  };
}

function buildSnapshot(items: TripPricingItem[], totalPrice = "482.35"): PricingSnapshot {
  return {
    pricing: {
      id: "pricing-1",
      tripId: "trip-1",
      totalPrice,
      currency: "EUR",
      calculatedAt: "2026-08-12T09:30:00.000Z",
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "2026.1",
      calculationStatus: "CALCULATED",
      notes: null,
      createdAt: "2026-08-12T09:30:00.000Z",
      updatedAt: "2026-08-12T09:30:00.000Z",
    },
    items,
  };
}

function buildCustomProperty(): TripCustomProperty {
  return {
    id: "assignment-1",
    tripId: "trip-1",
    customPropertyId: "property-1",
    customProperty: {
      id: "property-1",
      name: "ADR surcharge",
      description: "Dangerous goods handling",
      pricingComponentId: "component-9",
      defaultPrice: "35.00",
      isActive: true,
    },
    assignedAt: "2026-08-01T00:00:00.000Z",
  };
}

/**
 * The value shown under a labelled field.
 *
 * Looking the value up through its label keeps assertions unambiguous: a date
 * can legitimately appear under both "Datum" and "Original planning
 * date", and a bare text query cannot tell those apart.
 */
function fieldValue(label: string): string {
  const term = screen.getByText(label);
  const value = term.nextElementSibling;

  if (!value) {
    throw new Error(`Field "${label}" has no value element.`);
  }

  return value.textContent ?? "";
}

describe("TripDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTripMock.mockResolvedValue(buildTrip());
    getPricingSnapshotMock.mockResolvedValue(null);
    listCustomPropertiesMock.mockResolvedValue([]);
    getVehicleMock.mockReset();
    listActiveVehiclesMock.mockResolvedValue(ACTIVE_VEHICLES);
    listActiveDriversMock.mockResolvedValue(ACTIVE_DRIVERS);
  });

  describe("while loading", () => {
    it("shows a loading state", () => {
      getTripMock.mockReturnValue(new Promise(() => undefined));

      render(<TripDetailPage />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("the trip itself", () => {
    it("shows the identifying and routing fields", async () => {
      render(<TripDetailPage />);

      expect(await screen.findByText("Rit ANRDUB2602247")).toBeInTheDocument();
      expect(fieldValue("Terminal")).toBe("PSA Antwerp");
      expect(fieldValue("Bestemming stad")).toBe("Dourges");
      expect(fieldValue("Bestemming land")).toBe("France");
      expect(fieldValue("Cntr type")).toBe("45PH");
      expect(fieldValue("Container")).toBe("PVDU 301326/0");
      expect(screen.getByText("CLOSED")).toBeInTheDocument();
    });

    it("shows the planning date and the planned interval", async () => {
      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Datum")).toBe("22/05/2025");
      expect(fieldValue("Gepland uur")).toBe("10:00 – 16:00");
    });

    /**
     * The import date is immutable and the planning date can be moved, so the
     * two are shown separately even when they still agree.
     */
    it("distinguishes the planning date from the original one", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({ planningDate: "2025-06-02", originalPlanningDate: "2025-05-22" }),
      );

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Datum")).toBe("02/06/2025");
      expect(fieldValue("Oorspronkelijke datum")).toBe("22/05/2025");
    });

    it("shows an absent value as absent rather than inventing one", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({ terminal: null, startTime: null, endTime: null }),
      );

      render(<TripDetailPage />);

      expect((await screen.findAllByText("Niet ingevuld")).length).toBeGreaterThan(0);
    });

    it("fetches no vehicle for a trip that has none", async () => {
      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(getVehicleMock).not.toHaveBeenCalled();
    });

    it("shows the full vehicle when the trip references one", async () => {
      getTripMock.mockResolvedValue(buildTrip({ vehicleId: "vehicle-1" }));
      getVehicleMock.mockResolvedValue({
        id: "vehicle-1",
        licensePlate: "1-ABC-123",
        displayColor: "#2563EB",
        description: null,
        brand: "Volvo",
        model: "FH16",
        year: 2022,
        notes: null,
        isActive: true,
      });

      render(<TripDetailPage />);

      expect(await screen.findByText("1-ABC-123 · Volvo FH16")).toBeInTheDocument();
    });
  });

  /**
   * The driver comes from the Trip response, already resolved by the backend
   * from the Trip's own planning date. Nothing here fetches an assignment, and
   * no test mocks a resolution rule.
   */
  describe("the effective driver", () => {
    it("shows a driver resolved from the vehicle assignment", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          effectiveDriver: {
            id: "driver-1",
            name: "Piet Janssens",
            isActive: true,
            source: "VEHICLE_ASSIGNMENT",
          },
        }),
      );

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Chauffeur")).toContain("Piet Janssens");
      expect(fieldValue("Chauffeur")).toContain("Via voertuigtoewijzing");
    });

    it("shows a driver chosen specifically for this trip as an override", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          driverId: "driver-2",
          effectiveDriver: {
            id: "driver-2",
            name: "Ahmet Yilmaz",
            isActive: true,
            source: "OVERRIDE",
          },
        }),
      );

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Chauffeur")).toContain("Ahmet Yilmaz");
      expect(fieldValue("Chauffeur")).toContain("Apart gekozen voor deze rit");
      expect(fieldValue("Chauffeur")).not.toContain("Via voertuigtoewijzing");
    });

    it("states plainly when there is no effective driver", async () => {
      getTripMock.mockResolvedValue(buildTrip({ effectiveDriver: null }));

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Chauffeur")).toContain("Geen chauffeur");
    });

    /** Deactivation does not rewrite who drove; it is shown, not hidden. */
    it("marks an inactive driver while still naming them", async () => {
      getTripMock.mockResolvedValue(
        buildTrip({
          effectiveDriver: {
            id: "driver-3",
            name: "Retired Driver",
            isActive: false,
            source: "VEHICLE_ASSIGNMENT",
          },
        }),
      );

      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(fieldValue("Chauffeur")).toContain("Retired Driver");
      expect(fieldValue("Chauffeur")).toContain("Inactief");
    });

    /** The old wording promised a lookup the page can no longer need. */
    it("no longer defers the driver to the vehicle's assignment", async () => {
      render(<TripDetailPage />);

      await screen.findByText("Rit ANRDUB2602247");

      expect(screen.queryByText(/follows the vehicle/i)).not.toBeInTheDocument();
    });
  });

  describe("custom properties", () => {
    it("lists the assigned properties", async () => {
      listCustomPropertiesMock.mockResolvedValue([buildCustomProperty()]);

      render(<TripDetailPage />);

      expect(await screen.findByText("ADR surcharge")).toBeInTheDocument();
      expect(screen.getByText("Dangerous goods handling")).toBeInTheDocument();
    });

    it("explains an empty list", async () => {
      render(<TripDetailPage />);

      expect(await screen.findByText("Geen custom waarden")).toBeInTheDocument();
    });
  });

  describe("pricing display", () => {
    it("shows each line and the stored total exactly as received", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot(
          [
            buildItem(),
            buildItem({
              id: "item-2",
              description: "Fuel surcharge",
              amount: "57.25",
              calculationOrder: 2,
            }),
            buildItem({
              id: "item-3",
              description: "Wachttijd",
              amount: "25.10",
              calculationOrder: 3,
            }),
          ],
          "482.35",
        ),
      );

      render(<TripDetailPage />);

      expect(await screen.findByText("400.00 EUR")).toBeInTheDocument();
      expect(screen.getByText("57.25 EUR")).toBeInTheDocument();
      expect(screen.getByText("25.10 EUR")).toBeInTheDocument();
      expect(screen.getByText("482.35 EUR")).toBeInTheDocument();
    });

    it("displays lines in calculationOrder even when received out of order", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot([
          buildItem({ id: "c", description: "Third", calculationOrder: 3 }),
          buildItem({ id: "a", description: "First", calculationOrder: 1 }),
          buildItem({ id: "b", description: "Second", calculationOrder: 2 }),
        ]),
      );

      render(<TripDetailPage />);

      await screen.findByText("First");

      // Scoped to the body: the footer holds the total, which is not a line.
      const table = screen.getByRole("table", { name: /prijsopbouw/i });
      const body = table.querySelector("tbody");

      if (!body) {
        throw new Error("The pricing breakdown has no table body.");
      }

      const descriptions = within(body)
        .getAllByRole("row")
        .map((row) => within(row).getAllByRole("cell")[1].textContent);

      expect(descriptions).toEqual(["First", "Second", "Third"]);
    });

    /**
     * The stored total is authoritative. Showing a locally summed figure would
     * hide a real backend problem behind a number that merely looks right.
     */
    it("shows the stored total, never the sum of the lines", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot(
          [
            buildItem({ amount: "100.00", calculationOrder: 1 }),
            buildItem({ id: "item-2", amount: "100.00", calculationOrder: 2 }),
          ],
          // Deliberately not 200.00.
          "999.99",
        ),
      );

      render(<TripDetailPage />);

      expect(await screen.findByText("999.99 EUR")).toBeInTheDocument();
      expect(screen.queryByText("200.00 EUR")).not.toBeInTheDocument();
    });

    it("shows a negative amount exactly as sent", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot([buildItem({ description: "Discount", amount: "-15.00" })]),
      );

      render(<TripDetailPage />);

      expect(await screen.findByText("-15.00 EUR")).toBeInTheDocument();
    });

    it("shows the engine and rule versions of the snapshot", async () => {
      getPricingSnapshotMock.mockResolvedValue(buildSnapshot([buildItem()]));

      render(<TripDetailPage />);

      expect(await screen.findByText("Engine 1.0.0")).toBeInTheDocument();
      expect(screen.getByText("Regels 2026.1")).toBeInTheDocument();
    });

    /**
     * A CLOSED Trip with no snapshot means automatic pricing did not produce
     * one. That is recoverable and must be explained, not shown as an empty
     * table.
     */
    it("explains that a closed, unpriced trip needs attention", async () => {
      render(<TripDetailPage />);

      expect(await screen.findByText("Prijs vraagt aandacht")).toBeInTheDocument();
      expect(
        screen.getByText(/er is geen prijs bewaard/i),
      ).toBeInTheDocument();
    });

    it("does not suggest reopening a closed, unpriced trip", async () => {
      render(<TripDetailPage />);

      await screen.findByText("Prijs vraagt aandacht");

      expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
      expect(screen.getByText(/rit blijft afgewerkt/i)).toBeInTheDocument();
    });

    it("says pricing comes later for a trip that is not closed yet", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "OPEN" }));

      render(<TripDetailPage />);

      expect(await screen.findByText("Nog geen prijs")).toBeInTheDocument();
    });
  });

  describe("the reprocess action", () => {
    it("is offered for a CLOSED trip", async () => {
      render(<TripDetailPage />);

      expect(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      ).toBeEnabled();
    });

    /** The backend refuses to price anything else, so offering it would mislead. */
    it("is disabled for a trip that is not CLOSED", async () => {
      getTripMock.mockResolvedValue(buildTrip({ status: "OPEN" }));

      render(<TripDetailPage />);

      expect(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      ).toBeDisabled();
    });

    /**
     * The page refetches rather than trusting the mutation's own response, so
     * what appears is what the backend now holds.
     */
    it("shows the pricing the backend holds after reprocessing", async () => {
      getPricingSnapshotMock
        .mockResolvedValueOnce(
          buildSnapshot([buildItem({ amount: "400.00" })], "400.00"),
        )
        .mockResolvedValue(
          buildSnapshot(
            [buildItem({ description: "Base price", amount: "410.00" })],
            "410.00",
          ),
        );
      reprocessMock.mockResolvedValue(
        buildSnapshot([buildItem({ amount: "410.00" })], "410.00"),
      );

      render(<TripDetailPage />);

      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      // The single line and the total both become 410.00, so both must update.
      await waitFor(() => {
        expect(screen.getAllByText("410.00 EUR")).toHaveLength(2);
      });
      expect(screen.queryByText("400.00 EUR")).not.toBeInTheDocument();
    });

    it("refetches the trip after reprocessing instead of trusting the response", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot([buildItem()], "482.35"),
      );

      render(<TripDetailPage />);

      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      await waitFor(() => {
        expect(getTripMock.mock.calls.length).toBeGreaterThan(1);
      });
    });

    it("reports a refusal without losing the existing snapshot", async () => {
      getPricingSnapshotMock.mockResolvedValue(
        buildSnapshot([buildItem()], "482.35"),
      );
      reprocessMock.mockRejectedValue(
        new ApiError(
          "CONFLICT",
          "No active route cost for this terminal and destination.",
          409,
        ),
      );

      render(<TripDetailPage />);

      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      expect(
        await screen.findByText(
          "No active route cost for this terminal and destination.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("482.35 EUR")).toBeInTheDocument();
    });

    it("asks the backend to reprocess this trip", async () => {
      render(<TripDetailPage />);

      await userEvent.click(
        await screen.findByRole("button", { name: /prijs opnieuw berekenen/i }),
      );

      await waitFor(() => {
        expect(reprocessMock).toHaveBeenCalledWith("trip-1");
      });
    });
  });

  describe("when the trip cannot be loaded", () => {
    it("treats a missing trip as a page state, not an error", async () => {
      getTripMock.mockRejectedValue(
        new ApiError("NOT_FOUND", "No Trip with that id.", 404),
      );

      render(<TripDetailPage />);

      expect(await screen.findByText("Rit niet gevonden")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the backend's message for any other failure", async () => {
      getTripMock.mockRejectedValue(
        new ApiError("INTERNAL_ERROR", "The database is unavailable.", 500),
      );

      render(<TripDetailPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The database is unavailable.",
      );
    });
  });
});
