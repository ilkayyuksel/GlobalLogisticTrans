import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomValuesPage from "./page";
import { request } from "@/lib/api/client";
import type { CustomProperty, Paginated } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

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

/** In the backend's display order — creation order — which is not alphabetical. */
const IN_BACKEND_ORDER: readonly CustomProperty[] = [
  property("prop-tar", "TAR", { isSystemManaged: true }),
  property("prop-zone", "zone extra"),
  property("prop-flat", "Flat", { isSystemManaged: true, isAssignable: false }),
  property("prop-eenmalig", "Éénmalig"),
  property("prop-apart", "apart transport"),
];

function respondWith(items: readonly CustomProperty[]): void {
  requestMock.mockImplementation(() =>
    Promise.resolve({
      items: [...items],
      meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
    } satisfies Paginated<CustomProperty>),
  );
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <CustomValuesPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

async function rowNames(): Promise<string[]> {
  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);

  return rows.map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

describe("the Custom Values page, alphabetically", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  it("A. lists the values by name, ignoring case and accents", async () => {
    respondWith(IN_BACKEND_ORDER);

    renderPage();

    expect(await rowNames()).toEqual([
      "apart transport",
      "Éénmalig",
      "Flat",
      "TAR",
      "zone extra",
    ]);
  });

  it("G. keeps the system-managed values as they were: listed, without delete", async () => {
    respondWith(IN_BACKEND_ORDER);

    renderPage();
    const tarRow = (await screen.findByText("TAR")).closest("tr") as HTMLElement;
    const zoneRow = screen.getByText("zone extra").closest("tr") as HTMLElement;

    expect(within(tarRow).queryByRole("button", { name: /verwijder/i })).toBeNull();
    expect(within(zoneRow).getByRole("button", { name: /verwijder/i })).toBeInTheDocument();
  });

  it("H. edits the value it shows, by its own id", async () => {
    respondWith(IN_BACKEND_ORDER);
    renderPage();
    const firstRow = (await screen.findByText("apart transport")).closest("tr") as HTMLElement;

    await userEvent.click(within(firstRow).getByRole("button", { name: /bewerk/i }));

    expect(screen.getByLabelText("Naam")).toHaveValue("apart transport");

    await userEvent.click(screen.getByRole("button", { name: /opslaan/i }));

    const saved = requestMock.mock.calls.find(
      ([, options]) => (options as { method?: string } | undefined)?.method === "PATCH",
    );
    expect(saved?.[0]).toBe("/api/v1/custom-properties/prop-apart");
  });
});
