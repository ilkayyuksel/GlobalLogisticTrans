import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardPage from "./page";
import { ApiError } from "@/lib/api/client";
import { uploadTransportOrderPdfs } from "@/lib/api/imports";
import { listMaintenance, type Maintenance } from "@/lib/api/maintenance";
import { type ListTripsParams, listTrips } from "@/lib/api/trips";
import type { Paginated, Trip } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/trips", () => ({
  ...jest.requireActual("@/lib/api/trips"),
  listTrips: jest.fn(),
}));

jest.mock("@/lib/api/imports", () => ({
  ...jest.requireActual("@/lib/api/imports"),
  uploadTransportOrderPdfs: jest.fn(),
}));

jest.mock("@/lib/api/maintenance", () => ({
  ...jest.requireActual("@/lib/api/maintenance"),
  listMaintenance: jest.fn(),
}));

const listTripsMock = listTrips as jest.MockedFunction<typeof listTrips>;
const uploadMock = uploadTransportOrderPdfs as jest.MockedFunction<
  typeof uploadTransportOrderPdfs
>;
const listMaintenanceMock = listMaintenance as jest.MockedFunction<
  typeof listMaintenance
>;

function buildWarning(overrides: Partial<Maintenance> = {}): Maintenance {
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
    maintenanceDate: "2026-01-10",
    description: "Grote beurt",
    mileage: 245000,
    cost: "1250.50",
    workshop: "Garage Peeters",
    nextMaintenanceDate: "2026-08-01",
    nextMaintenanceMileage: 275000,
    notes: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

function maintenancePage(items: Maintenance[]) {
  return {
    items,
    meta: { page: 1, pageSize: 5, totalItems: items.length, totalPages: 1 },
  };
}

/**
 * The Dashboard.
 *
 * The figures are the backend's own counts, so the tests assert that the
 * queries asked for them and that the rendered numbers are exactly what came
 * back. Anything the backend cannot answer must render as unavailable — the
 * tests check that too, because an invented number here would be acted on.
 */

const VEHICLE = {
  id: "vehicle-1",
  licensePlate: "1-ABC-123",
  displayColor: "#2563eb",
  isActive: true,
};

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: VEHICLE.id,
    driverId: null,
    customProperties: [],
    direction: null,
    vehicle: VEHICLE,
    effectiveDriver: {
      id: "driver-1",
      name: "Piet Janssens",
      isActive: true,
      source: "VEHICLE_ASSIGNMENT",
    },
    status: "OPEN",
    bookingNumber: "BK-2026-1001",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: "2026-08-14",
    planningDate: "2026-08-14",
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

function page(items: Trip[], totalItems: number): Paginated<Trip> {
  return {
    items,
    meta: { page: 1, pageSize: 1, totalItems, totalPages: 1 },
  };
}

/**
 * Answers each dashboard query with its own total, so the tests can tell the
 * counts apart the way the backend does.
 */
function respondWithCounts(counts: {
  total: number;
  today: number;
  week: number;
  open: number;
  closed: number;
  recent?: Trip[];
}) {
  listTripsMock.mockImplementation((params: ListTripsParams = {}) => {
    if (params.status === "OPEN") return Promise.resolve(page([], counts.open));
    if (params.status === "CLOSED") return Promise.resolve(page([], counts.closed));
    if (params.planningDate) return Promise.resolve(page([], counts.today));
    if (params.planningDateFrom) return Promise.resolve(page([], counts.week));
    if (params.pageSize && params.pageSize > 1) {
      return Promise.resolve(page(counts.recent ?? [], counts.total));
    }

    return Promise.resolve(page([], counts.total));
  });
}

function renderDashboard() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <DashboardPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/**
 * Waits until the counts have loaded.
 *
 * A specific number is a poor barrier here: the same figure legitimately
 * appears in the statistics and again in the status widget.
 */
async function waitForCounts(): Promise<void> {
  await waitFor(() => {
    expect(
      within(statCard("Totaal ritten")).queryByRole("status"),
    ).not.toBeInTheDocument();
  });
}

/** The card carrying a given label. */
function statCard(label: string): HTMLElement {
  return screen.getByText(label).closest("section") as HTMLElement;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    listMaintenanceMock.mockReset();
    listMaintenanceMock.mockResolvedValue(maintenancePage([]));
    window.localStorage.clear();
    respondWithCounts({ total: 42, today: 3, week: 11, open: 7, closed: 30 });
  });

  describe("the page", () => {
    it("is titled for the product", async () => {
      renderDashboard();

      expect(
        await screen.findByRole("heading", { name: "TRAXO Dashboard" }),
      ).toBeInTheDocument();
    });

    it("shows loading before the counts arrive", () => {
      listTripsMock.mockReturnValue(new Promise(() => undefined));

      renderDashboard();

      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    });
  });

  describe("the statistics", () => {
    it("shows the backend's totals", async () => {
      renderDashboard();

      await waitForCounts();

      expect(within(statCard("Totaal ritten")).getByText("42")).toBeInTheDocument();
      expect(within(statCard("Vandaag")).getByText("3")).toBeInTheDocument();
      expect(within(statCard("Deze week")).getByText("11")).toBeInTheDocument();
    });

    it("asks the backend to count rather than counting rows here", async () => {
      renderDashboard();

      await waitForCounts();

      // Every counting query asks for a single row and reads meta.totalItems.
      const counting = listTripsMock.mock.calls.filter(
        ([params]) => params?.pageSize === 1,
      );

      expect(counting.length).toBeGreaterThanOrEqual(5);
    });

    it("asks for today by exact planning date", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        listTripsMock.mock.calls.some(([p]) => Boolean(p?.planningDate)),
      ).toBe(true);
    });

    it("asks for the week as a date range", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        listTripsMock.mock.calls.some(
          ([p]) => Boolean(p?.planningDateFrom) && Boolean(p?.planningDateTo),
        ),
      ).toBe(true);
    });

    /**
     * No backend aggregation exists for this, and averaging it in the browser
     * would mean downloading every Trip. It must say so rather than show a
     * number.
     */
    it("reports average waiting time as unavailable", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        within(statCard("Gemiddelde wachttijd")).getByText("Nog niet beschikbaar"),
      ).toBeInTheDocument();
    });

    it("never shows zero for a statistic it cannot compute", async () => {
      renderDashboard();

      await waitForCounts();

      expect(
        within(statCard("Gemiddelde wachttijd")).queryByText("0"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the trip status widget", () => {
    it("shows open, closed and total from the backend", async () => {
      renderDashboard();

      const widget = (await screen.findByText("Ritstatus")).closest(
        "section",
      ) as HTMLElement;

      expect(within(widget).getByText("7")).toBeInTheDocument();
      expect(within(widget).getByText("30")).toBeInTheDocument();
      expect(within(widget).getByText("42")).toBeInTheDocument();
    });

    it("links to all trips", async () => {
      renderDashboard();

      expect(
        await screen.findByRole("link", { name: /Bekijk alle ritten/ }),
      ).toHaveAttribute("href", "/trips");
    });

    it("reports a backend failure", async () => {
      listTripsMock.mockRejectedValue(
        new ApiError("INTERNAL_ERROR", "De database is niet bereikbaar.", 500),
      );

      renderDashboard();

      expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    });
  });

  describe("recent trips", () => {
    it("lists the latest trips with their details", async () => {
      respondWithCounts({
        total: 42,
        today: 3,
        week: 11,
        open: 7,
        closed: 30,
        recent: [buildTrip()],
      });

      renderDashboard();

      expect(await screen.findByText("BK-2026-1001")).toBeInTheDocument();
      expect(screen.getByText(/PSA Quay 869/)).toBeInTheDocument();
      expect(screen.getByText(/1-ABC-123/)).toBeInTheDocument();
      expect(screen.getByText(/Piet Janssens/)).toBeInTheDocument();
    });

    it("links each trip to its detail page", async () => {
      respondWithCounts({
        total: 1,
        today: 0,
        week: 0,
        open: 1,
        closed: 0,
        recent: [buildTrip()],
      });

      renderDashboard();

      expect(
        await screen.findByRole("link", { name: "BK-2026-1001" }),
      ).toHaveAttribute("href", "/trips/trip-1");
    });

    /** Vehicle and driver are embedded, so no request may be made per row. */
    it("makes no request per row", async () => {
      respondWithCounts({
        total: 3,
        today: 0,
        week: 0,
        open: 3,
        closed: 0,
        recent: [
          buildTrip({ id: "a" }),
          buildTrip({ id: "b", bookingNumber: "BK-B" }),
          buildTrip({ id: "c", bookingNumber: "BK-C" }),
        ],
      });

      renderDashboard();
      await screen.findByText("BK-C");

      // Five counts plus one list — never one per trip.
      expect(listTripsMock.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it("explains an empty list", async () => {
      respondWithCounts({ total: 0, today: 0, week: 0, open: 0, closed: 0, recent: [] });

      renderDashboard();

      expect(await screen.findByText("Nog geen ritten")).toBeInTheDocument();
    });
  });

  describe("widgets the backend cannot supply yet", () => {
    it("shows Agenda vandaag as unavailable, with its link", async () => {
      renderDashboard();

      const widget = (await screen.findByText("Agenda vandaag")).closest(
        "section",
      ) as HTMLElement;

      expect(
        within(widget).getByText("Nog niet beschikbaar"),
      ).toBeInTheDocument();
      expect(
        within(widget).getByRole("link", { name: /Bekijk agenda/ }),
      ).toHaveAttribute("href", "/calendar");
    });

    it("invents no calendar entries", async () => {
      renderDashboard();

      await screen.findByText("Agenda vandaag");

      expect(screen.queryByText(/afspraak|vergadering/i)).not.toBeInTheDocument();
    });
  });

  describe("the maintenance warnings", () => {
    async function warningsWidget(): Promise<HTMLElement> {
      return (await screen.findByText("Onderhoudswaarschuwingen")).closest(
        "section",
      ) as HTMLElement;
    }

    /** The backend decides what is due; this widget only asks for it. */
    it("asks the backend for maintenance that has fallen due", async () => {
      renderDashboard();
      await warningsWidget();

      expect(listMaintenanceMock).toHaveBeenCalledWith(
        expect.objectContaining({ dueOnly: true }),
        expect.anything(),
      );
    });

    it("names the vehicle, the work and the planned date", async () => {
      listMaintenanceMock.mockResolvedValue(maintenancePage([buildWarning()]));

      renderDashboard();
      const widget = await warningsWidget();

      expect(await within(widget).findByText("1-ABC-123")).toBeInTheDocument();
      // The row states the kind of work and the date it was planned for.
      const row = within(widget).getByText("1-ABC-123").closest("li") as HTMLElement;

      expect(row.textContent).toContain("Onderhoud");
      expect(row.textContent).toContain("01/08/2026");
    });

    /** Every warning here has the same cause: a planned date has arrived. */
    it("gives the reason as an expired date", async () => {
      listMaintenanceMock.mockResolvedValue(maintenancePage([buildWarning()]));

      renderDashboard();
      const widget = await warningsWidget();

      expect(
        await within(widget).findByText("Datum verlopen"),
      ).toBeInTheDocument();
    });

    /**
     * A planned mileage is stored, but nothing knows the vehicle's current
     * odometer — so no warning may ever claim a mileage was reached.
     */
    it("never claims a mileage was reached, and says why", async () => {
      listMaintenanceMock.mockResolvedValue(maintenancePage([buildWarning()]));

      renderDashboard();
      const widget = await warningsWidget();

      expect(
        within(widget).queryByText(/bereikt/),
      ).not.toBeInTheDocument();
      expect(
        within(widget).getByText(/huidige kilometerstand/),
      ).toBeInTheDocument();
    });

    it("says when nothing is due", async () => {
      renderDashboard();
      const widget = await warningsWidget();

      expect(
        await within(widget).findByText("Geen onderhoud verlopen"),
      ).toBeInTheDocument();
    });

    it("reports a failed request", async () => {
      listMaintenanceMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderDashboard();
      const widget = await warningsWidget();

      expect(
        await within(widget).findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
    });

    it("links to the full maintenance list", async () => {
      renderDashboard();
      const widget = await warningsWidget();

      expect(
        within(widget).getByRole("link", { name: /Bekijk onderhoud/ }),
      ).toHaveAttribute("href", "/maintenance");
    });
  });

  describe("in Turkish", () => {
    it("translates the dashboard", async () => {
      window.localStorage.setItem("tms.language", "tr");

      renderDashboard();

      expect(
        await screen.findByRole("heading", { name: "TRAXO Panel" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Toplam sefer")).toBeInTheDocument();
      expect(screen.getByText("Sefer durumu")).toBeInTheDocument();
    });
  });
});

/**
 * The manual PDF upload.
 *
 * The API layer is the boundary under test: what the widget sends, and what it
 * shows for each answer. The backend reports per file, and these tests hold the
 * widget to that — one refused document must never hide a successful one, and a
 * failed request must never look like an import.
 */
describe("Dashboard PDF upload", () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    uploadMock.mockReset();
    listMaintenanceMock.mockReset();
    listMaintenanceMock.mockResolvedValue(maintenancePage([]));
    window.localStorage.clear();
    respondWithCounts({ total: 0, today: 0, week: 0, open: 0, closed: 0, recent: [] });
  });

  function pdf(name = "order.pdf") {
    return new File(["%PDF-1.7"], name, { type: "application/pdf" });
  }

  function importedResult(filename: string, bookingNumber: string) {
    return {
      filename,
      ok: true,
      combination: false,
      trips: [buildTrip({ id: `trip-${bookingNumber}`, bookingNumber })],
    };
  }

  async function choose(...selected: File[]): Promise<void> {
    await screen.findByText("PDF importeren");
    await userEvent.upload(screen.getByLabelText("Bestanden kiezen"), selected);
    await screen.findByText(selected[0].name);
  }

  function uploadButton(): HTMLElement {
    return screen.getByRole("button", { name: /^Uploaden/ });
  }

  describe("choosing files", () => {
    it("offers a drop area and a file picker", async () => {
      renderDashboard();

      expect(await screen.findByText("PDF importeren")).toBeInTheDocument();
      expect(screen.getByText("Sleep PDF-bestanden hierheen")).toBeInTheDocument();
      expect(screen.getByLabelText("Bestanden kiezen")).toBeInTheDocument();
    });

    it("accepts PDFs only, and several at once", async () => {
      renderDashboard();
      await screen.findByText("PDF importeren");

      const input = screen.getByLabelText("Bestanden kiezen");

      expect(input).toHaveAttribute("accept", expect.stringContaining("pdf"));
      expect(input).toHaveAttribute("multiple");
      expect(
        screen.getByText("Alleen PDF-bestanden worden geaccepteerd"),
      ).toBeInTheDocument();
    });

    it("lists a chosen file with its name and size", async () => {
      renderDashboard();
      await choose(pdf());

      expect(screen.getByText(/KB|MB/)).toBeInTheDocument();
      expect(screen.getByText(/Klaar om te versturen/)).toBeInTheDocument();
    });

    it("queues a dropped PDF", async () => {
      renderDashboard();
      const dropZone = (await screen.findByText("Sleep PDF-bestanden hierheen"))
        .parentElement as HTMLElement;

      fireEvent.drop(dropZone, { dataTransfer: { files: [pdf("dropped.pdf")] } });

      expect(await screen.findByText("dropped.pdf")).toBeInTheDocument();
    });

    /**
     * The picker already refuses non-PDFs through `accept`, so the only way one
     * arrives is a drag-and-drop — which `accept` does not filter.
     */
    it("marks a dropped non-PDF as skipped and never sends it", async () => {
      renderDashboard();
      const dropZone = (await screen.findByText("Sleep PDF-bestanden hierheen"))
        .parentElement as HTMLElement;

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [new File(["x"], "notes.txt", { type: "text/plain" })],
        },
      });

      expect(await screen.findByText(/Geen PDF/)).toBeInTheDocument();
      expect(uploadButton()).toBeDisabled();
    });

    it("removes a file from the list", async () => {
      renderDashboard();
      await choose(pdf());

      await userEvent.click(screen.getByRole("button", { name: "Verwijderen" }));

      await waitFor(() => {
        expect(screen.queryByText("order.pdf")).not.toBeInTheDocument();
      });
    });
  });

  describe("uploading", () => {
    it("sends the selected files to the backend", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      await waitFor(() => {
        expect(uploadMock).toHaveBeenCalledTimes(1);
      });
      expect(uploadMock.mock.calls[0][0]).toHaveLength(1);
      expect((uploadMock.mock.calls[0][0] as File[])[0].name).toBe("order.pdf");
    });

    it("shows that the upload is running, and blocks a second one", async () => {
      let release: (value: { results: [] }) => void = () => {};
      uploadMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("order.pdf")).closest(
        "li",
      ) as HTMLElement;

      await waitFor(() => {
        expect(row.textContent).toContain("Bezig met uploaden");
      });
      expect(
        screen.getByRole("button", { name: /Bezig met uploaden/ }),
      ).toBeDisabled();

      release({ results: [] });

      // A file the backend did not report on is offered again, never assumed
      // imported.
      await waitFor(() => {
        expect(uploadButton()).toBeEnabled();
      });
    });

    it("reports a successful import with its booking number", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/Rit geïmporteerd/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "ANRDUB2602247" }),
      ).toHaveAttribute("href", "/trips/trip-ANRDUB2602247");
    });

    /*
     * A cancelled order creates no Trip. The row must say what happened rather
     * than report an import that did not occur.
     */
    it("reports a cancelled order as cancelled, not imported", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "cancelled.pdf",
            ok: true,
            combination: false,
            trips: [],
            cancellations: [
              { bookingNumber: "ANRBEL2772352", outcome: "CANCELLED" as const },
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/Geannuleerde order — rit geannuleerd/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Rit geïmporteerd/)).not.toBeInTheDocument();
    });

    it("says so when a cancellation matched no Trip", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "cancelled.pdf",
            ok: true,
            combination: false,
            trips: [],
            cancellations: [
              {
                bookingNumber: "ANRBEL2772352",
                outcome: "NO_MATCHING_TRIP" as const,
              },
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(
        await screen.findByText(/geen bijbehorende rit/),
      ).toBeInTheDocument();
    });

    it("reports a Combination as one file that created two Trips", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: true,
            combination: true,
            trips: [
              buildTrip({ id: "trip-a", bookingNumber: "DUBANR2598395" }),
              buildTrip({ id: "trip-b", bookingNumber: "ANRBEL2603249" }),
            ],
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      const row = (await screen.findByText("order.pdf")).closest(
        "li",
      ) as HTMLElement;

      expect(row.textContent).toContain("Combinatie geïmporteerd");
      expect(row.textContent).toContain("2 ritten aangemaakt");
      expect(within(row).getAllByRole("link")).toHaveLength(2);
    });

    it("shows the backend's reason when a file is refused", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: false,
            code: "IMPORT_UNREADABLE_PDF",
            message: '"order.pdf" could not be parsed: no text layer.',
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(await screen.findByText(/Import mislukt/)).toBeInTheDocument();
      expect(screen.getByText(/no text layer/)).toBeInTheDocument();
    });

    /** The code identifies a failure; it is not what an operator should read. */
    it("does not put the error code in front of the operator", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "order.pdf",
            ok: false,
            code: "IMPORT_UNREADABLE_PDF",
            message: "Dit document kon niet gelezen worden.",
          },
        ],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      await screen.findByText(/Import mislukt/);

      expect(document.body.textContent).not.toContain("IMPORT_UNREADABLE_PDF");
    });

    /** The whole point of per-file results. */
    it("shows a success and a failure in the same batch", async () => {
      uploadMock.mockResolvedValue({
        results: [
          {
            filename: "broken.pdf",
            ok: false,
            code: "IMPORT_UNREADABLE_PDF",
            message: "Onleesbaar document.",
          },
          importedResult("good.pdf", "ANRDUB2602247"),
        ],
      });

      renderDashboard();
      await choose(pdf("broken.pdf"), pdf("good.pdf"));
      await userEvent.click(uploadButton());

      const failed = (await screen.findByText("broken.pdf")).closest(
        "li",
      ) as HTMLElement;
      const imported = screen.getByText("good.pdf").closest("li") as HTMLElement;

      expect(failed.textContent).toContain("Import mislukt");
      expect(imported.textContent).toContain("Rit geïmporteerd");
    });
  });

  describe("after a batch", () => {
    it("uploads a new file without resending the finished ones", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());
      await screen.findByText(/Rit geïmporteerd/);

      uploadMock.mockResolvedValue({
        results: [importedResult("second.pdf", "ANRBEL2603249")],
      });

      await userEvent.upload(
        screen.getByLabelText("Bestanden kiezen"),
        pdf("second.pdf"),
      );
      await userEvent.click(uploadButton());

      await waitFor(() => {
        expect(uploadMock).toHaveBeenCalledTimes(2);
      });
      expect(uploadMock.mock.calls[1][0]).toHaveLength(1);
      expect((uploadMock.mock.calls[1][0] as File[])[0].name).toBe("second.pdf");
    });

    it("clears the list on request", async () => {
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());
      await screen.findByText(/Rit geïmporteerd/);

      await userEvent.click(screen.getByRole("button", { name: "Lijst wissen" }));

      await waitFor(() => {
        expect(screen.queryByText("order.pdf")).not.toBeInTheDocument();
      });
    });
  });

  describe("when the request itself fails", () => {
    /** Nothing was imported, so nothing may look imported. */
    it("reports the failure and offers the same files again", async () => {
      uploadMock.mockRejectedValue(
        new ApiError("PAYLOAD_TOO_LARGE", "Het bestand is te groot.", 413),
      );

      renderDashboard();
      await choose(pdf());
      await userEvent.click(uploadButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Uploaden is mislukt",
      );
      expect(screen.getByText(/te groot/)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/geïmporteerd/i);

      const row = screen.getByText("order.pdf").closest("li") as HTMLElement;

      expect(row.textContent).toContain("Klaar om te versturen");
      expect(uploadButton()).toBeEnabled();
    });
  });

  describe("presentation", () => {
    it("translates the whole widget", async () => {
      window.localStorage.setItem("tms.language", "tr");
      uploadMock.mockResolvedValue({
        results: [importedResult("order.pdf", "ANRDUB2602247")],
      });

      renderDashboard();
      await screen.findByText("PDF içe aktar");
      await userEvent.upload(
        screen.getByLabelText("Dosya seç"),
        pdf(),
      );
      await userEvent.click(screen.getByRole("button", { name: /^Yükle/ }));

      expect(
        await screen.findByText(/Sefer içe aktarıldı/),
      ).toBeInTheDocument();
    });

    /** Colours come from the theme tokens, so both themes are already covered. */
    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      window.localStorage.setItem("tms.theme", theme);

      renderDashboard();
      await choose(pdf());

      const widget = screen.getByText("PDF importeren").closest(
        "section",
      ) as HTMLElement;

      expect(widget.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(widget.querySelector("[style]")).toBeNull();
    });
  });

  /** Parsing belongs to the server; the browser only holds file handles. */
  it("never reads the file contents", async () => {
    const readAsText = jest.spyOn(FileReader.prototype, "readAsText");
    const readAsArrayBuffer = jest.spyOn(
      FileReader.prototype,
      "readAsArrayBuffer",
    );
    uploadMock.mockResolvedValue({
      results: [importedResult("order.pdf", "ANRDUB2602247")],
    });

    renderDashboard();
    await choose(pdf());
    await userEvent.click(uploadButton());
    await screen.findByText(/Rit geïmporteerd/);

    expect(readAsText).not.toHaveBeenCalled();
    expect(readAsArrayBuffer).not.toHaveBeenCalled();

    readAsText.mockRestore();
    readAsArrayBuffer.mockRestore();
  });
});

