import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MaintenancePage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { Maintenance } from "@/lib/api/maintenance";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-09-14",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Completing a maintenance cycle from the list.
 *
 * The ✓ opens a form; nothing reaches the backend until Opslaan, the next date
 * is required, the extra information is not, and Annuleren changes nothing. What
 * the backend does with it — the same record planned again, the cycle kept in
 * its history — is its own contract, proved in the backend specs.
 */

function record(overrides: Partial<Maintenance> = {}): Maintenance {
  return {
    id: "m-planned",
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
    mileage: null,
    cost: null,
    workshop: null,
    nextMaintenanceDate: null,
    nextMaintenanceMileage: null,
    notes: null,
    urgency: { level: "OVERDUE", daysOverdue: 4 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let completionFails = false;

function respondWith(records: Maintenance[]): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string } | undefined];

    if (path === "/api/v1/vehicles") {
      return Promise.resolve({
        items: [],
        meta: { page: 1, pageSize: 200, totalItems: 0, totalPages: 1 },
      });
    }

    if (options?.method === "POST" && path.endsWith("/completions")) {
      return completionFails
        ? Promise.reject(
            new ApiError("CONFLICT", "Maintenance record is COMPLETED.", 409),
          )
        : Promise.resolve({ ...records[0], completions: [] });
    }

    return Promise.resolve({
      items: records,
      meta: { page: 1, pageSize: 25, totalItems: records.length, totalPages: 1 },
    });
  });
}

function completionCalls() {
  return requestMock.mock.calls.filter(([path]) =>
    String(path).endsWith("/completions"),
  );
}

function listCalls() {
  return requestMock.mock.calls.filter(
    ([path, options]) =>
      path === "/api/v1/maintenance" &&
      !(options as { method?: string } | undefined)?.method,
  );
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <MaintenancePage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

async function openCompletion(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: /^Voltooien/ }));

  return screen.findByRole("dialog");
}

function setNextDate(dialog: HTMLElement, value: string): void {
  fireEvent.change(within(dialog).getByLabelText("Volgende onderhoudsdatum"), {
    target: { value },
  });
}

describe("completing maintenance from the list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    completionFails = false;
    window.localStorage.clear();
    respondWith([record()]);
  });

  it("offers ✓ on PLANNED and IN_PROGRESS records only", async () => {
    respondWith([
      record({ id: "a", status: "PLANNED" }),
      record({ id: "b", status: "IN_PROGRESS" }),
      record({ id: "c", status: "COMPLETED", urgency: null }),
      record({ id: "d", status: "CANCELLED", urgency: null }),
    ]);

    renderPage();
    await screen.findAllByText("2 GAS 189");

    expect(screen.getAllByRole("button", { name: /^Voltooien/ })).toHaveLength(2);
  });

  it("names the plate and the date in the ✓'s accessible name, with a tooltip", async () => {
    renderPage();

    const button = await screen.findByRole("button", {
      name: "Voltooien 2 GAS 189 10/09/2026",
    });

    expect(button).toHaveAttribute("title", "Voltooien");
  });

  it("opens the form and sends nothing yet", async () => {
    renderPage();
    const dialog = await openCompletion();

    expect(within(dialog).getByText("Onderhoud voltooien")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Voltooid op")).toHaveValue("2026-09-14");
    expect(completionCalls()).toHaveLength(0);
  });

  it("requires the next maintenance date", async () => {
    renderPage();
    const dialog = await openCompletion();

    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    expect(
      within(dialog).getByText("Vul de volgende onderhoudsdatum in."),
    ).toBeInTheDocument();
    expect(completionCalls()).toHaveLength(0);
  });

  /** The planned date names the cycle, so a double submit is refused, not recorded twice. */
  it("sends the planned date shown, the completion date, the next date and the extra information", async () => {
    renderPage();
    const dialog = await openCompletion();

    setNextDate(dialog, "2027-03-14");
    await userEvent.type(
      within(dialog).getByLabelText("Extra informatie"),
      "Groot onderhoud uitgevoerd.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(completionCalls()).toHaveLength(1));
    expect(completionCalls()[0]).toEqual([
      "/api/v1/maintenance/m-planned/completions",
      expect.objectContaining({
        method: "POST",
        body: {
          plannedDate: "2026-09-10",
          completedOn: "2026-09-14",
          nextMaintenanceDate: "2027-03-14",
          notes: "Groot onderhoud uitgevoerd.",
        },
      }),
    ]);
  });

  it("sends no note when none was typed", async () => {
    renderPage();
    const dialog = await openCompletion();

    setNextDate(dialog, "2027-03-14");
    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(completionCalls()).toHaveLength(1));
    expect(
      (completionCalls()[0][1] as { body: { notes: unknown } }).body.notes,
    ).toBeNull();
  });

  it("changes nothing on Annuleren", async () => {
    renderPage();
    const dialog = await openCompletion();

    setNextDate(dialog, "2027-03-14");
    await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(completionCalls()).toHaveLength(0);
  });

  it("reloads the list and says so after saving", async () => {
    renderPage();
    const dialog = await openCompletion();
    const listsBefore = listCalls().length;

    setNextDate(dialog, "2027-03-14");
    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    expect(
      await screen.findByText("Onderhoud voltooid en opnieuw gepland"),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(listsBefore));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the form open with the backend's reason when it refuses", async () => {
    completionFails = true;
    renderPage();
    const dialog = await openCompletion();

    setNextDate(dialog, "2027-03-14");
    await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

    expect(
      await within(dialog).findByText(/Maintenance record is COMPLETED/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers a next date that was already planned for the cycle after this one", async () => {
    respondWith([record({ nextMaintenanceDate: "2027-03-14" })]);

    renderPage();
    const dialog = await openCompletion();

    expect(within(dialog).getByLabelText("Volgende onderhoudsdatum")).toHaveValue(
      "2027-03-14",
    );
  });

  /** After a completion the next date equals the planned date: not a new plan. */
  it("does not offer a next date equal to the current planning", async () => {
    respondWith([record({ nextMaintenanceDate: "2026-09-10" })]);

    renderPage();
    const dialog = await openCompletion();

    expect(within(dialog).getByLabelText("Volgende onderhoudsdatum")).toHaveValue("");
  });

  it("links each record to its details", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      "/maintenance/m-planned",
    );
  });
});
