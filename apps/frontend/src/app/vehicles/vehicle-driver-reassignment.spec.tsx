import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  today: () => "2026-08-20",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/** The day the operator hands the truck over — deliberately not today. */
const HANDOVER = "2026-08-24";

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

/** Piet has had this truck since the first of August, open-ended. */
const CURRENT_ASSIGNMENT = {
  id: "assignment-1",
  vehicleId: "vehicle-1",
  driverId: "driver-1",
  validFrom: "2026-08-01",
  validTo: null,
  isOpenEnded: true,
  notes: null,
};

function buildDriver(id: string, name: string) {
  return {
    id,
    name,
    licenceNumber: null,
    emergencyContact: null,
    notes: null,
    phoneNumber: null,
    email: null,
    isActive: true,
  };
}

const PIET = buildDriver("driver-1", "Piet Janssens");
const AHMET = buildDriver("driver-2", "Ahmet Yılmaz");

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
 * Changing the chauffeur of a vehicle, from the operator's side.
 *
 * ── THE BUG THIS FIXES ──────────────────────────────────────────────────────
 * The mechanism was always there — the backend closes the running period and
 * opens a new one — but the screen hid it. With a driver already on the truck
 * the only action still read "Chauffeur koppelen", as if the job were done,
 * and the neighbouring "Toewijzing bewerken" opened a form whose chauffeur
 * dropdown was greyed out. Between the two, the honest conclusion was that the
 * chauffeur could not be changed at all.
 *
 * ── WHAT THESE TESTS PIN DOWN ───────────────────────────────────────────────
 *   1. the current chauffeur and the period are visible;
 *   2. changing them is offered, and named as changing;
 *   3. saving CREATES a period through the existing endpoint — it never edits
 *      or replaces the running one, and never sends its id;
 *   4. the start date is the operator's, not today's;
 *   5. no Trip is touched by any of it.
 *
 * Point 3 is the whole reason this is a new assignment rather than an edit:
 * Piet's period is what gives every August Trip its driver, and a form that
 * quietly moved the driver onto that row would rewrite finished work with no
 * record that it happened. Which day the previous period ends on is the
 * backend's decision, and nothing here sends it.
 * ────────────────────────────────────────────────────────────────────────────
 */
function respondWith(overrides: { assignment?: unknown } = {}): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];

    if (options?.method && options.method !== "GET") {
      return Promise.resolve({ ...CURRENT_ASSIGNMENT, id: "assignment-2" });
    }

    if (path.startsWith("/api/v1/vehicle-assignments/current/")) {
      return Promise.resolve(
        overrides.assignment === undefined
          ? CURRENT_ASSIGNMENT
          : overrides.assignment,
      );
    }

    if (path === "/api/v1/drivers") {
      return Promise.resolve({
        items: [PIET, AHMET],
        meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
      });
    }

    if (path.startsWith("/api/v1/drivers/")) {
      return Promise.resolve(PIET);
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

/** Opens the change dialog and returns it. */
async function openChange(): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole("button", { name: "Chauffeur wijzigen" }),
  );

  return screen.findByRole("dialog");
}

/** Picks Ahmet from the 24th and saves. */
async function reassignToAhmet(dialog: HTMLElement): Promise<void> {
  await userEvent.selectOptions(
    await within(dialog).findByLabelText("Chauffeur"),
    "driver-2",
  );

  // A date input is set rather than typed: it already carries today's value,
  // and the point of the test is that the operator's date replaces it.
  fireEvent.change(within(dialog).getByLabelText("Nieuwe chauffeur vanaf"), {
    target: { value: HANDOVER },
  });

  await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
}

describe("changing the chauffeur of a vehicle", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("what the vehicle page offers", () => {
    it("shows the chauffeur the vehicle has now, and since when", async () => {
      respondWith();

      renderDetail();
      const panel = (
        await screen.findByText("Chauffeurtoewijzing")
      ).closest("section") as HTMLElement;

      expect(within(panel).getByText("Piet Janssens")).toBeInTheDocument();
      expect(within(panel).getByText("01/08/2026")).toBeInTheDocument();
      expect(within(panel).getByText("Open einde")).toBeInTheDocument();
    });

    /** The bug, stated as an expectation. */
    it("offers to change the chauffeur when there already is one", async () => {
      respondWith();

      renderDetail();

      expect(
        await screen.findByRole("button", { name: "Chauffeur wijzigen" }),
      ).toBeInTheDocument();
    });

    it("still calls it linking when the vehicle has no chauffeur", async () => {
      respondWith({ assignment: null });

      renderDetail();

      expect(
        await screen.findByRole("button", { name: "Chauffeur koppelen" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Chauffeur wijzigen" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("the change dialog", () => {
    it("names the chauffeur being replaced", async () => {
      respondWith();

      renderDetail();
      const dialog = await openChange();

      expect(
        within(dialog).getByText(/Huidige chauffeur: Piet Janssens/),
      ).toBeInTheDocument();
    });

    it("says what will happen to the running period and to earlier ritten", async () => {
      respondWith();

      renderDetail();
      const dialog = await openChange();

      expect(
        within(dialog).getByText(/loopt tot de dag vóór deze datum/),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(/ritten van vóór die datum houden hun chauffeur/),
      ).toBeInTheDocument();
    });

    it("lets a different chauffeur be selected", async () => {
      respondWith();

      renderDetail();
      const dialog = await openChange();
      const select = (await within(dialog).findByLabelText(
        "Chauffeur",
      )) as HTMLSelectElement;

      expect(select).toBeEnabled();
      expect(
        within(select).getByRole("option", { name: "Ahmet Yılmaz" }),
      ).toBeInTheDocument();

      await userEvent.selectOptions(select, "driver-2");
      expect(select.value).toBe("driver-2");
    });

    /** An explicit date, because a handover is planned rather than noticed. */
    it("asks from which day, defaulting to today", async () => {
      respondWith();

      renderDetail();
      const dialog = await openChange();

      expect(
        within(dialog).getByLabelText("Nieuwe chauffeur vanaf"),
      ).toHaveValue("2026-08-20");
    });
  });

  describe("saving it", () => {
    it("creates a new assignment through the existing endpoint", async () => {
      respondWith();

      renderDetail();
      await reassignToAhmet(await openChange());

      await waitFor(() => {
        expect(mutationCalls()).toHaveLength(1);
      });
      expect(mutationCalls()[0][0]).toBe("/api/v1/vehicle-assignments");
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "POST",
        body: {
          vehicleId: "vehicle-1",
          driverId: "driver-2",
          validFrom: HANDOVER,
          validTo: null,
          notes: null,
        },
      });
    });

    /**
     * The running period is left entirely alone. Not edited, not ended, not
     * even mentioned: closing it belongs to the backend, which does it on the
     * day before the new one starts.
     */
    it("never edits, ends or names the previous assignment", async () => {
      respondWith();

      renderDetail();
      await reassignToAhmet(await openChange());

      await waitFor(() => {
        expect(mutationCalls()).toHaveLength(1);
      });

      const [path, options] = mutationCalls()[0] as [string, { body: unknown }];

      expect(path).not.toContain("assignment-1");
      expect(JSON.stringify(options.body)).not.toContain("assignment-1");
      expect(
        requestMock.mock.calls.some(([called]) =>
          String(called).includes("/vehicle-assignments/assignment-1"),
        ),
      ).toBe(false);
    });

    /** The frontend does not compute the handover; it only sends the date. */
    it("sends the operator's date rather than today", async () => {
      respondWith();

      renderDetail();
      await reassignToAhmet(await openChange());

      await waitFor(() => {
        expect(
          (mutationCalls()[0][1] as { body: { validFrom: string } }).body
            .validFrom,
        ).toBe(HANDOVER);
      });
    });

    /**
     * Reassigning a truck is not an edit of anybody's work. A Trip keeps its
     * own driver — the resolved one for its planning date, or its own override
     * — and this screen has no business writing either.
     */
    it("touches no Trip at all", async () => {
      respondWith();

      renderDetail();
      await reassignToAhmet(await openChange());

      await waitFor(() => {
        expect(mutationCalls()).toHaveLength(1);
      });
      expect(
        requestMock.mock.calls.some(([path]) => String(path).includes("/trips")),
      ).toBe(false);
      expect(JSON.stringify(mutationCalls()[0][1])).not.toContain("tripId");
    });

    it("shows the refusal and keeps the dialog open", async () => {
      respondWith();

      renderDetail();
      const dialog = await openChange();

      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          "The vehicle already has an assignment in this period.",
          409,
        ),
      );

      await reassignToAhmet(dialog);

      expect(
        await within(dialog).findByText(/already has an assignment/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("reports success and re-reads the assignment from the backend", async () => {
      respondWith();

      renderDetail();
      const before = requestMock.mock.calls.filter(([path]) =>
        String(path).includes("/vehicle-assignments/current/"),
      ).length;

      await reassignToAhmet(await openChange());

      expect(await screen.findByText("Chauffeur gekoppeld")).toBeInTheDocument();
      await waitFor(() => {
        expect(
          requestMock.mock.calls.filter(([path]) =>
            String(path).includes("/vehicle-assignments/current/"),
          ).length,
        ).toBeGreaterThan(before);
      });
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith();

      renderDetail();

      await userEvent.click(
        await screen.findByRole("button", { name: "Şoförü değiştir" }),
      );
      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByText(/Mevcut şoför: Piet Janssens/),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByLabelText("Yeni şoför şu tarihten itibaren"),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith();

      renderDetail();
      const dialog = await openChange();

      expect(dialog.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(
        within(dialog).getByText(/Huidige chauffeur: Piet Janssens/),
      ).toBeInTheDocument();
    });
  });
});
