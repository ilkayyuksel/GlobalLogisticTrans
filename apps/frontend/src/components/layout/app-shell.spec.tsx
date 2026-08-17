import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppShell } from "./app-shell";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

const mockPathname = jest.fn<string, []>();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

/**
 * The application shell: navigation, active state and the settings menu.
 *
 * Everything is asserted through what a user perceives — link text, the current
 * page, the open menu — rather than through class names, so a restyle does not
 * break these tests and a genuine behaviour change does.
 */

function renderShell(pathname = "/dashboard") {
  mockPathname.mockReturnValue(pathname);

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <AppShell>
          <p>Page content</p>
        </AppShell>
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function mainNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Hoofdnavigatie" });
}

describe("AppShell navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  describe("the main navigation", () => {
    it("shows every section in Dutch, in product order", () => {
      renderShell();

      const labels = within(mainNav())
        .getAllByRole("link")
        .map((link) => link.textContent);

      expect(labels).toEqual([
        "Dashboard",
        "Ritten",
        "Voertuigen",
        "Onderhoud",
        "Agenda",
        "Notities",
        "PDF Debug",
      ]);
    });

    it.each([
      ["Dashboard", "/dashboard"],
      ["Ritten", "/trips"],
      ["Voertuigen", "/vehicles"],
      ["Onderhoud", "/maintenance"],
      ["Agenda", "/calendar"],
      ["Notities", "/notes"],
      ["PDF Debug", "/pdf-debug"],
    ])("links %s to %s", (label, href) => {
      renderShell();

      expect(within(mainNav()).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    });

    /**
     * Planning is not a section of this product: it lives inside Ritten, as
     * the Dag, Week and Maand views. The old board is gone entirely.
     */
    it("offers no Planning section", () => {
      renderShell();

      expect(
        within(mainNav()).queryByRole("link", { name: /planning/i }),
      ).not.toBeInTheDocument();
    });

    it("shows the TRAXO brand and links it home", () => {
      renderShell();

      expect(
        screen.getByRole("link", { name: /TRAXO/ }),
      ).toHaveAttribute("href", "/dashboard");
    });

    /** The product was renamed; the old name must not survive anywhere. */
    /**
     * The wordmark carries "TRAXO" and "Transport Operations" as artwork, so
     * the tagline is no longer text on the page — it is the logo's alt text,
     * which is where a screen reader now finds it.
     */
    it("shows the TRAXO wordmark, linked to the dashboard", () => {
      renderShell();

      const home = screen.getByRole("link", { name: /TRAXO/ });

      expect(home).toHaveAttribute("href", "/dashboard");
      expect(
        screen.getByAltText("TRAXO — Transport Operations"),
      ).toBeInTheDocument();
    });

    it("renders the page content it is given", () => {
      renderShell();

      expect(screen.getByText("Page content")).toBeInTheDocument();
    });
  });

  describe("the active route", () => {
    it("marks the current section as the current page", () => {
      renderShell("/trips");

      expect(within(mainNav()).getByRole("link", { name: "Ritten" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("marks only one section at a time", () => {
      renderShell("/vehicles");

      const current = within(mainNav())
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");

      expect(current.map((link) => link.textContent)).toEqual(["Voertuigen"]);
    });

    /** A detail page belongs to its section. */
    it("keeps the section active on a detail page", () => {
      renderShell("/trips/abc-123");

      expect(within(mainNav()).getByRole("link", { name: "Ritten" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("marks nothing when the route is outside the navigation", () => {
      renderShell("/an-unknown-route");

      const current = within(mainNav())
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");

      expect(current).toHaveLength(0);
    });
  });

  describe("the settings dropdown", () => {
    it("is closed to begin with", () => {
      renderShell();

      expect(
        screen.getByRole("button", { name: /Instellingen/ }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens on click and lists both settings pages", async () => {
      renderShell();

      await userEvent.click(screen.getByRole("button", { name: /Instellingen/ }));

      const menu = screen.getByRole("menu");

      expect(
        within(menu).getByRole("menuitem", { name: "Nummerplaten" }),
      ).toHaveAttribute("href", "/settings/license-plates");
      expect(
        within(menu).getByRole("menuitem", { name: "Custom waarden" }),
      ).toHaveAttribute("href", "/settings/custom-values");
    });

    /** A closed menu whose links are still tabbable is an accessibility trap. */
    it("keeps its links out of the tab order while closed", () => {
      renderShell();

      expect(
        screen.queryByRole("menuitem", { name: "Nummerplaten" }),
      ).not.toBeInTheDocument();
    });

    it("opens from the keyboard", async () => {
      renderShell();

      screen.getByRole("button", { name: /Instellingen/ }).focus();
      await userEvent.keyboard("{Enter}");

      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the trigger", async () => {
      renderShell();

      const trigger = screen.getByRole("button", { name: /Instellingen/ });
      await userEvent.click(trigger);
      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("closes when a click lands outside it", async () => {
      renderShell();

      await userEvent.click(screen.getByRole("button", { name: /Instellingen/ }));
      await userEvent.click(screen.getByText("Page content"));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("reads as active while a settings page is open", () => {
      renderShell("/settings/license-plates");

      expect(
        screen.getByRole("button", { name: /Instellingen/ }),
      ).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("offers a skip link to the content", () => {
      renderShell();

      expect(
        screen.getByRole("link", { name: "Naar de inhoud" }),
      ).toHaveAttribute("href", "#main-content");
    });

    it("names the main navigation landmark", () => {
      renderShell();

      expect(mainNav()).toBeInTheDocument();
    });

    it("labels the theme and language controls", () => {
      renderShell();

      expect(screen.getByLabelText("Taal")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /thema/i }),
      ).toBeInTheDocument();
    });

    /** Authentication is out of scope, so the control says so by being inert. */
    /**
     * A link to the Auth0 middleware's endpoint, not a button clearing local
     * state. Ending only the browser's state would leave the Auth0 session
     * alive, and the next visit would sign straight back in without asking.
     */
    it("logs out through Auth0", () => {
      renderShell();

      expect(screen.getByRole("link", { name: "Afmelden" })).toHaveAttribute(
        "href",
        "/auth/logout",
      );
    });
  });
});
