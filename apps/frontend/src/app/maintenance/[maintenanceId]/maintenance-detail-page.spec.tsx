import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MaintenanceDetailPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type {
  MaintenanceCompletion,
  MaintenanceDetail,
} from "@/lib/api/maintenance";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useParams: () => ({ maintenanceId: "m-1" }),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-09-14",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * One maintenance record: its current planning, its whole history, and the ✓.
 *
 * The history is the backend's list, rendered in the order it came — oldest
 * cycle first — and it belongs to the record: completing it again adds an
 * entry without moving or losing the earlier ones.
 */

function cycle(
  id: string,
  completedOn: string,
  nextMaintenanceDate: string,
  notes: string | null,
): MaintenanceCompletion {
  return {
    id,
    plannedDate: completedOn,
    completedOn,
    nextMaintenanceDate,
    notes,
    maintenanceType: "Onderhoud",
    description: "Grote beurt",
    createdAt: `${completedOn}T12:00:00.000Z`,
  };
}

function detail(overrides: Partial<MaintenanceDetail> = {}): MaintenanceDetail {
  return {
    id: "m-1",
    vehicleId: "vehicle-1",
    vehicle: {
      id: "vehicle-1",
      licensePlate: "2 GAS 189",
      displayColor: "#2563eb",
      isActive: true,
    },
    status: "PLANNED",
    maintenanceType: "Onderhoud",
    maintenanceDate: "2026-09-10",
    description: "Grote beurt",
    mileage: 245_000,
    cost: null,
    workshop: "Garage Peeters",
    nextMaintenanceDate: null,
    nextMaintenanceMileage: 275_000,
    notes: null,
    urgency: { level: "OVERDUE", daysOverdue: 4 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completions: [],
    ...overrides,
  };
}

function respondWith(
  loaded: MaintenanceDetail | Error,
  afterCompletion?: MaintenanceDetail,
): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];

    if (options?.method === "POST" && path === "/api/v1/maintenance/m-1/completions") {
      return Promise.resolve(afterCompletion);
    }

    return loaded instanceof Error ? Promise.reject(loaded) : Promise.resolve(loaded);
  });
}

function completionCalls() {
  return requestMock.mock.calls.filter(([path]) =>
    String(path).endsWith("/completions"),
  );
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <MaintenanceDetailPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function historySection(): HTMLElement {
  return screen.getByText("Geschiedenis").closest("section") as HTMLElement;
}

function planningSection(): HTMLElement {
  return screen.getByText("Huidige planning").closest("section") as HTMLElement;
}

describe("the maintenance details", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  it("loads the record and its history in one request", async () => {
    respondWith(detail());

    renderPage();
    await screen.findByText("Huidige planning");

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toBe("/api/v1/maintenance/m-1");
  });

  it("shows the current planning with the backend's urgency", async () => {
    respondWith(detail());

    renderPage();
    await screen.findByText("Huidige planning");

    const planning = planningSection();

    expect(within(planning).getByText("10/09/2026")).toBeInTheDocument();
    expect(within(planning).getByText("Gepland")).toBeInTheDocument();
    expect(within(planning).getByText("TE LAAT — 4 dagen")).toBeInTheDocument();
  });

  it("keeps the kilometre fields as information only", async () => {
    respondWith(detail());

    renderPage();
    await screen.findByText("Huidige planning");

    expect(within(planningSection()).getByText("245.000 km")).toBeInTheDocument();
    expect(within(planningSection()).getByText("275.000 km")).toBeInTheDocument();
  });

  it("says when the record has no completed cycle yet", async () => {
    respondWith(detail());

    renderPage();
    await screen.findByText("Geschiedenis");

    expect(within(historySection()).getByText("Nog geen voltooide beurten.")).toBeInTheDocument();
  });

  it("shows one completed cycle with its note and its next date", async () => {
    respondWith(
      detail({
        maintenanceDate: "2027-03-14",
        urgency: { level: "UPCOMING", daysOverdue: 0 },
        completions: [cycle("c1", "2026-09-14", "2027-03-14", "Olie + filters vervangen")],
      }),
    );

    renderPage();
    await screen.findByText("Geschiedenis");

    const entry = within(historySection()).getByRole("listitem");

    expect(entry.textContent).toContain("14/09/2026");
    expect(entry.textContent).toContain("✓ Voltooid");
    expect(entry.textContent).toContain("Olie + filters vervangen");
    expect(entry.textContent).toContain("14/03/2027");
  });

  it("shows every cycle, oldest first, as the backend ordered them", async () => {
    respondWith(
      detail({
        completions: [
          cycle("c1", "2026-09-14", "2027-03-14", "Eerste"),
          cycle("c2", "2027-03-14", "2027-09-14", "Tweede"),
          cycle("c3", "2027-09-14", "2028-03-14", null),
        ],
      }),
    );

    renderPage();
    await screen.findByText("Geschiedenis");

    const entries = within(historySection()).getAllByRole("listitem");

    expect(entries.map((entry) => entry.textContent?.slice(0, 10))).toEqual([
      "14/09/2026",
      "14/03/2027",
      "14/09/2027",
    ]);
    // A cycle without extra information shows no empty note.
    expect(entries[2].textContent).not.toContain("Notitie");
  });

  it("completes the cycle and shows the same record planned again, with its history", async () => {
    respondWith(
      detail({ completions: [cycle("c1", "2026-03-10", "2026-09-10", "Vorige")] }),
      detail({
        maintenanceDate: "2027-03-14",
        urgency: { level: "UPCOMING", daysOverdue: 0 },
        completions: [
          cycle("c1", "2026-03-10", "2026-09-10", "Vorige"),
          cycle("c2", "2026-09-14", "2027-03-14", "Groot onderhoud uitgevoerd."),
        ],
      }),
    );

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Voltooien" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Volgende onderhoudsdatum"), {
      target: { value: "2027-03-14" },
    });
    await userEvent.type(
      within(dialog).getByLabelText("Extra informatie"),
      "Groot onderhoud uitgevoerd.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    expect(
      await screen.findByText("Onderhoud voltooid en opnieuw gepland"),
    ).toBeInTheDocument();
    expect(within(planningSection()).getByText("14/03/2027")).toBeInTheDocument();
    expect(within(planningSection()).getByText("GEPLAND")).toBeInTheDocument();
    expect(within(planningSection()).queryByText(/TE LAAT/)).not.toBeInTheDocument();
    expect(within(historySection()).getAllByRole("listitem")).toHaveLength(2);
    expect(completionCalls()).toHaveLength(1);
  });

  it("requires the next date, and Annuleren sends nothing", async () => {
    respondWith(detail());

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Voltooien" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Vul de volgende onderhoudsdatum in.",
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(completionCalls()).toHaveLength(0);
    expect(within(planningSection()).getByText("10/09/2026")).toBeInTheDocument();
  });

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "offers no ✓ on a %s record",
    async (status) => {
      respondWith(detail({ status, urgency: null }));

      renderPage();
      await screen.findByText("Huidige planning");

      expect(screen.queryByRole("button", { name: "Voltooien" })).not.toBeInTheDocument();
    },
  );

  it("says so when the record does not exist", async () => {
    respondWith(new ApiError("NOT_FOUND", "Maintenance record does not exist.", 404));

    renderPage();

    expect(await screen.findByText("Dit onderhoud bestaat niet.")).toBeInTheDocument();
  });

  it("links back to the maintenance list", async () => {
    respondWith(detail());

    renderPage();

    expect(
      await screen.findByRole("link", { name: /Terug naar onderhoud/ }),
    ).toHaveAttribute("href", "/maintenance");
  });
});
