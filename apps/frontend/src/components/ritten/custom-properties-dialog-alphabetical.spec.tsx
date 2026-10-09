import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomPropertiesDialog } from "./custom-properties-dialog";
import { buildTrip } from "@/app/trips/ritten-test-support";
import { request } from "@/lib/api/client";
import type { CustomProperty, TripCustomProperty } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;
const TRIP = buildTrip({ id: "trip-1", bookingNumber: "ANRDUB2600001" });

function property(id: string, name: string, extra: Partial<CustomProperty> = {}): CustomProperty {
  return {
    id,
    name,
    description: null,
    pricingComponentId: null,
    defaultPrice: "10.00",
    isActive: true,
    isSystemManaged: false,
    isAssignable: true,
    ...extra,
  };
}

function assignment(id: string, of: CustomProperty, isRequired = false): TripCustomProperty {
  return {
    id,
    tripId: TRIP.id,
    customPropertyId: of.id,
    customProperty: of,
    assignedAt: "2026-10-09T08:00:00.000Z",
    isAutomatic: isRequired,
    isRequired,
  } as TripCustomProperty;
}

const FLAT = property("prop-flat", "Flat", { isSystemManaged: true, isAssignable: false });
const ZONE = property("prop-zone", "zone extra");
const BRUG = property("prop-brug", "Brug");
const EENMALIG = property("prop-eenmalig", "Éénmalig");
const APART = property("prop-apart", "apart transport");
const TOLL = property("prop-toll", "Toll", { isSystemManaged: true, isAssignable: false });

/** Both lists in the backend's display order, which is not alphabetical. */
let assigned: TripCustomProperty[];

function respond(): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as [string, { method?: string; body?: { customPropertyId?: string } }?];

    if (path === "/api/v1/custom-properties") {
      return Promise.resolve({
        items: [ZONE, FLAT, EENMALIG, TOLL, APART, BRUG],
        meta: { page: 1, pageSize: 100, totalItems: 6, totalPages: 1 },
      });
    }

    if (path.startsWith("/api/v1/trip-custom-properties/trip/")) {
      return Promise.resolve({ items: assigned });
    }

    if (options?.method === "POST") {
      const added = [ZONE, EENMALIG, APART].find((item) => item.id === options.body?.customPropertyId);
      assigned = [...assigned, assignment(`a-${added?.id}`, added as CustomProperty)];

      return Promise.resolve({ ...assigned[assigned.length - 1], pricing: null, reasonCode: null });
    }

    return Promise.resolve({});
  });
}

function renderDialog(onChanged = jest.fn(), onClose = jest.fn()) {
  render(
    <LanguageProvider>
      <CustomPropertiesDialog trip={TRIP} onChanged={onChanged} onClose={onClose} />
    </LanguageProvider>,
  );

  return { onChanged, onClose };
}

async function lists() {
  await screen.findByRole("button", { name: "+ apart transport" });
  const [assignedList, availableList] = screen.getAllByRole("list");

  return {
    assigned: within(assignedList)
      .getAllByRole("listitem")
      .map((item) => item.firstElementChild?.textContent ?? ""),
    available: within(availableList)
      .getAllByRole("button")
      .map((button) => button.textContent ?? ""),
  };
}

describe("the Custom Values dialog on a Trip, alphabetically", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    assigned = [assignment("a-zone", ZONE), assignment("a-flat", FLAT, true), assignment("a-brug", BRUG)];
    respond();
  });

  it("B. shows the assigned and the available values by name", async () => {
    renderDialog();

    expect(await lists()).toEqual({
      assigned: ["Brug", "Flat", "zone extra"],
      available: ["+ apart transport", "+ Éénmalig"],
    });
  });

  it("G. keeps the system-managed rules: Flat required, Toll not offered", async () => {
    renderDialog();
    await lists();

    const flat = screen.getByText("Flat").closest("li") as HTMLElement;
    expect(within(flat).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Toll" })).toBeNull();
  });

  it("E/H. assigns the value clicked, by its id, and keeps every existing one", async () => {
    const { onChanged } = renderDialog();
    await lists();

    await userEvent.click(screen.getByRole("button", { name: "+ Éénmalig" }));

    const posted = requestMock.mock.calls.find(([, options]) => (options as { method?: string })?.method === "POST");
    expect((posted?.[1] as { body: unknown }).body).toEqual({
      tripId: TRIP.id,
      customPropertyId: "prop-eenmalig",
    });
    await waitFor(async () =>
      expect((await lists()).assigned).toEqual(["Brug", "Éénmalig", "Flat", "zone extra"]),
    );
    // The row behind the dialog gets the backend's set in the backend's order.
    expect(onChanged.mock.calls[0][0].assigned.map((item: TripCustomProperty) => item.id)).toEqual([
      "a-zone",
      "a-flat",
      "a-brug",
      "a-prop-eenmalig",
    ]);
  });

  it("F. still closes as before", async () => {
    const { onClose } = renderDialog();
    await lists();

    await userEvent.click(screen.getByRole("button", { name: /sluit/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
