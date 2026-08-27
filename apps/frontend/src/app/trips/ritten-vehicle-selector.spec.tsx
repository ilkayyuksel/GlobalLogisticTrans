import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

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
 * The Ritten vehicle picker, showing who is on each truck.
 *
 * ── WHY THE DRIVER IS IN THE OPTION ─────────────────────────────────────────
 * Choosing a truck is really choosing a truck AND the person on it. A list of
 * bare plates asks an operator to remember which is which, when the fleet page
 * two clicks away already knows.
 *
 * ── AND WHY IT COSTS NOTHING ────────────────────────────────────────────────
 * The name rides along on the vehicle list the page already loads — the same
 * `currentDriver` field the Voertuigen page renders. There is no request per
 * option and no second rule that could name a different driver.
 */
const VEHICLES_PATH = "/api/v1/vehicles";

const JAN = { id: "driver-1", name: "Jan Janssens", isActive: true };

function fleet() {
  return [
    {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      isActive: true,
      currentDriver: JAN,
    },
    {
      id: "vehicle-2",
      licensePlate: "1-XYZ-456",
      displayColor: "#16a34a",
      isActive: true,
      currentDriver: { id: "driver-2", name: "Mehmet Yilmaz", isActive: true },
    },
    {
      id: "vehicle-3",
      licensePlate: "1-DEF-789",
      displayColor: "#f59e0b",
      isActive: true,
      currentDriver: null,
    },
  ];
}

/** Opens the vehicle cell's editor and returns its select element. */
async function openPicker(): Promise<HTMLSelectElement> {
  renderRitten();

  const row = (await screen.findByText("ANRDUB2602247")).closest(
    "tr",
  ) as HTMLElement;

  await userEvent.click(
    within(row).getByRole("button", { name: "Voertuig" }),
  );

  return within(row).getByRole("combobox") as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.textContent ?? "");
}

function vehicleListCalls(): number {
  return requestMock.mock.calls.filter(([path]) => path === VEHICLES_PATH).length;
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the vehicle picker's labels", () => {
  beforeEach(() => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ vehicleId: null, vehicle: null })]),
      vehicles: fleet(),
    });
  });

  it("writes the plate and the current driver", async () => {
    const select = await openPicker();

    expect(optionLabels(select)).toContain("1-ABC-123 (Jan Janssens)");
    expect(optionLabels(select)).toContain("1-XYZ-456 (Mehmet Yilmaz)");
  });

  /** `1-DEF-789 ()` would read as a missing name, not an unassigned truck. */
  it("writes the plate alone for a truck with no driver", async () => {
    const select = await openPicker();

    expect(optionLabels(select)).toContain("1-DEF-789");
    expect(optionLabels(select).join("|")).not.toContain("()");
  });

  /** The label is display; the value an operator selects is still the id. */
  it("keeps the vehicle id as the option value", async () => {
    const select = await openPicker();
    const option = [...select.options].find(
      (candidate) => candidate.textContent === "1-ABC-123 (Jan Janssens)",
    );

    expect(option?.value).toBe("vehicle-1");
  });

  /** One list for the page — never a lookup per option. */
  it("adds no request per vehicle", async () => {
    await openPicker();

    expect(vehicleListCalls()).toBe(1);
  });
});

describe("choosing a vehicle", () => {
  it("still saves the vehicle id through the existing behaviour", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ vehicleId: null, vehicle: null })]),
      vehicles: fleet(),
    });
    const select = await openPicker();

    await userEvent.selectOptions(select, "vehicle-1");

    await waitFor(() => {
      const saves = requestMock.mock.calls.filter(
        ([path, options]) =>
          path === "/api/v1/trips/trip-1" &&
          (options as { method?: string } | undefined)?.method === "PATCH",
      );

      expect(saves).toHaveLength(1);
      expect((saves[0][1] as { body?: unknown }).body).toEqual({
        vehicleId: "vehicle-1",
      });
    });
  });
});

describe("agreeing with the Voertuigen page", () => {
  /**
   * Both read `vehicle.currentDriver`. This asserts the consequence: the name
   * in the picker is the name the fleet list would show for that same truck,
   * because there is only one field and one rule behind it.
   */
  it("names the driver the vehicle list carries", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ vehicleId: null, vehicle: null })]),
      vehicles: fleet(),
    });

    const select = await openPicker();
    const shown = optionLabels(select).find((label) =>
      label.startsWith("1-ABC-123"),
    );

    expect(shown).toBe(`1-ABC-123 (${JAN.name})`);
  });

  it("drops the driver as soon as the vehicle list stops naming one", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ vehicleId: null, vehicle: null })]),
      vehicles: fleet().map((vehicle) => ({ ...vehicle, currentDriver: null })),
    });

    const select = await openPicker();

    expect(optionLabels(select)).toContain("1-ABC-123");
    expect(optionLabels(select)).not.toContain("1-ABC-123 (Jan Janssens)");
  });
});
