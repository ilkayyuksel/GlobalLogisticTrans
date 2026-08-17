import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomValuesPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { CustomProperty, Paginated } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

const TAR: CustomProperty = {
  id: "prop-tar",
  name: "TAR",
  description: "Terminal administratie",
  pricingComponentId: null,
  defaultPrice: "35.00",
  isActive: true,
};

const FLAT: CustomProperty = {
  id: "prop-flat",
  name: "Flat",
  description: null,
  pricingComponentId: null,
  defaultPrice: "50.00",
  isActive: true,
};

const OVER_SINT_NIKLAAS: CustomProperty = {
  id: "prop-osn",
  name: "Over Sint-Niklaas",
  description: null,
  pricingComponentId: null,
  defaultPrice: "27.50",
  isActive: true,
};

/** Linked to a pricing component: the amount comes from the route config. */
const TOLL: CustomProperty = {
  id: "prop-toll",
  name: "Toll",
  description: null,
  pricingComponentId: "component-toll",
  defaultPrice: null,
  isActive: true,
};

function page(items: CustomProperty[]): Paginated<CustomProperty> {
  return {
    items,
    meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
  };
}

function respondWith(items: CustomProperty[]): void {
  requestMock.mockImplementation((...args: unknown[]) => {
    const [, options] = args as [string, { method?: string } | undefined];

    return Promise.resolve(
      options?.method && options.method !== "GET" ? TAR : page(items),
    );
  });
}

function mutationCalls() {
  return requestMock.mock.calls.filter(
    ([, options]) =>
      ((options as { method?: string } | undefined)?.method ?? "GET") !== "GET",
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

/**
 * Settings → Custom waarden.
 *
 * The distinction these tests protect: a fixed-price property carries an
 * amount, a route-priced one does not and never may — the backend refuses a
 * default price on a linked property, so the UI must not offer the field.
 */
describe("Custom values", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  describe("the list", () => {
    it("shows fixed prices exactly as the backend formatted them", async () => {
      respondWith([TAR, FLAT, OVER_SINT_NIKLAAS]);

      renderPage();

      expect(await screen.findByText("€ 35.00")).toBeInTheDocument();
      expect(screen.getByText("€ 50.00")).toBeInTheDocument();
      expect(screen.getByText("€ 27.50")).toBeInTheDocument();
    });

    /** Toll and Tunnel are priced per route; there is no fixed amount. */
    it("marks a route-priced property instead of showing a price", async () => {
      respondWith([TOLL]);

      renderPage();
      const row = (await screen.findByText("Toll")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(row).getByText("Route-afhankelijk")).toBeInTheDocument();
      expect(within(row).queryByText(/€/)).not.toBeInTheDocument();
    });

    /** An identifier is not information an operator can use. */
    it("never shows an identifier", async () => {
      respondWith([TAR, TOLL]);

      renderPage();
      await screen.findByText("TAR");

      expect(document.body.textContent).not.toContain("prop-tar");
      expect(document.body.textContent).not.toContain("component-toll");
    });

    it("shows the active state", async () => {
      respondWith([TAR, { ...FLAT, isActive: false }]);

      renderPage();
      const inactive = (await screen.findByText("Flat")).closest(
        "tr",
      ) as HTMLElement;

      expect(within(inactive).getByText("Inactief")).toBeInTheDocument();
    });

    it("shows a loading state, then the table", async () => {
      requestMock.mockReturnValue(new Promise(() => undefined));

      renderPage();

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("reports a failed request", async () => {
      requestMock.mockRejectedValue(
        new ApiError("NETWORK_ERROR", "De server is niet bereikbaar.", 0),
      );

      renderPage();

      expect(
        await screen.findByText("De server is niet bereikbaar."),
      ).toBeInTheDocument();
    });

    it("says when there are none", async () => {
      respondWith([]);

      renderPage();

      expect(
        await screen.findByText("Nog geen custom waarden"),
      ).toBeInTheDocument();
    });
  });

  describe("creating", () => {
    it("sends the name, description and fixed price", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuwe custom waarde" }),
      );

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Naam"), "ADR");
      await userEvent.type(
        within(dialog).getByLabelText("Omschrijving"),
        "Gevaarlijke goederen",
      );
      await userEvent.type(
        within(dialog).getByLabelText("Vaste prijs"),
        "42.50",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][1]).toMatchObject({
          method: "POST",
          body: {
            name: "ADR",
            description: "Gevaarlijke goederen",
            defaultPrice: 42.5,
          },
        });
      });
      expect(
        await screen.findByText("Custom waarde aangemaakt"),
      ).toBeInTheDocument();
    });

    it("sends null for an empty price", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuwe custom waarde" }),
      );

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Naam"), "Losse dienst");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(
          (mutationCalls()[0][1] as { body: { defaultPrice: unknown } }).body
            .defaultPrice,
        ).toBeNull();
      });
    });

    it("keeps the dialog open and shows the backend's detail", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(
        screen.getByRole("button", { name: "+ Nieuwe custom waarde" }),
      );

      const dialog = await screen.findByRole("dialog");
      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Validation failed", 409, [
          "name is already used by an active custom property",
        ]),
      );

      await userEvent.type(within(dialog).getByLabelText("Naam"), "TAR");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      expect(
        await within(dialog).findByText(/already used by an active/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("opens with the current values and PATCHes", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByLabelText("Naam")).toHaveValue("TAR");
      expect(within(dialog).getByLabelText("Vaste prijs")).toHaveValue(35);

      await userEvent.clear(within(dialog).getByLabelText("Vaste prijs"));
      await userEvent.type(within(dialog).getByLabelText("Vaste prijs"), "37.50");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe("/api/v1/custom-properties/prop-tar");
      });
      expect(mutationCalls()[0][1]).toMatchObject({
        method: "PATCH",
        body: { name: "TAR", defaultPrice: 37.5 },
      });
    });

    /**
     * The backend refuses a default price on a linked property, so an input
     * here could only ever produce a rejection.
     */
    it("offers no price field for a route-priced property", async () => {
      respondWith([TOLL]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).queryByLabelText("Vaste prijs"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(/prijs kan hier niet ingesteld worden/),
      ).toBeInTheDocument();
    });

    it("never sends a price for a route-priced property", async () => {
      respondWith([TOLL]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Bewerken" }));

      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Opslaan" }),
      );

      await waitFor(() => {
        expect(mutationCalls()).toHaveLength(1);
      });
      expect(
        (mutationCalls()[0][1] as { body: Record<string, unknown> }).body,
      ).not.toHaveProperty("defaultPrice");
    });
  });

  describe("activation", () => {
    it("deactivates after confirming, through the sub-resource", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/custom-properties/prop-tar/deactivation",
        );
      });
      expect(
        await screen.findByText("Custom waarde gedeactiveerd"),
      ).toBeInTheDocument();
    });

    it("sends nothing when the confirmation is declined", async () => {
      confirmSpy.mockReturnValue(false);
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Deactiveren" }));

      expect(mutationCalls()).toHaveLength(0);
    });

    it("activates an inactive property without a confirmation", async () => {
      respondWith([{ ...TAR, isActive: false }]);

      renderPage();
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: "Activeren" }));

      await waitFor(() => {
        expect(mutationCalls()[0][0]).toBe(
          "/api/v1/custom-properties/prop-tar/activation",
        );
      });
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    /** A deactivated property stays on the Trips that already carry it. */
    it("keeps an inactive property visible", async () => {
      respondWith([{ ...TAR, isActive: false }]);

      renderPage();

      expect(await screen.findByText("TAR")).toBeInTheDocument();
      expect(screen.getByText("Inactief")).toBeInTheDocument();
    });

    it("offers no delete", async () => {
      respondWith([TAR]);

      renderPage();
      await screen.findByRole("table");

      expect(
        screen.queryByRole("button", { name: /verwijder/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith([TOLL]);

      renderPage();

      expect(
        await screen.findByRole("heading", { name: "Özel değerler", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByText("Rotaya bağlı")).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      respondWith([TAR, TOLL]);

      renderPage();
      const table = await screen.findByRole("table");

      expect(table.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(within(table).getByText("TAR")).toBeInTheDocument();
    });
  });
});
