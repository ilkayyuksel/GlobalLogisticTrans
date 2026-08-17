import { render, screen, within } from "@testing-library/react";

import { LoginPanel } from "@/components/auth/login-panel";
import { AppShell } from "@/components/layout/app-shell";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

const mockPathname = jest.fn<string, []>(() => "/auth");
const mockSearchParams = jest.fn(() => new URLSearchParams());

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

/**
 * The TRAXO entry page.
 *
 * The important assertions are negative. This page must never grow a credential
 * field, a registration link or a password-reset link: TRAXO has one
 * administrator, created in the Auth0 dashboard, and every credential is
 * entered on Auth0's own domain. A form here would either be dead markup or a
 * second, unwanted authentication path.
 *
 * The page component itself is a server component that reads the environment,
 * so the panel it renders is what is exercised here — with the one thing the
 * server decides, `isConfigured`, passed in explicitly.
 */
function renderLogin(isConfigured = true) {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LoginPanel isConfigured={isConfigured} />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe("Login page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockPathname.mockReturnValue("/auth");
    mockSearchParams.mockReturnValue(new URLSearchParams());
  });

  describe("branding", () => {
    it("shows the TRAXO wordmark", () => {
      renderLogin();

      expect(
        screen.getByAltText("TRAXO — Transport Operations"),
      ).toBeInTheDocument();
    });

    /** The white-ink wordmark: the login page is navy in either theme. */
    it("uses the asset made for a dark surface", () => {
      renderLogin();

      expect(screen.getByAltText("TRAXO — Transport Operations")).toHaveAttribute(
        "src",
        expect.stringContaining("lightmodus"),
      );
    });

    it("shows no application navigation", () => {
      renderLogin();

      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Ritten" })).not.toBeInTheDocument();
    });
  });

  describe("signing in", () => {
    /** A real endpoint served by the Auth0 middleware, so a link is correct. */
    it("sends the visitor to Auth0 Universal Login", () => {
      renderLogin();

      expect(
        screen.getByRole("link", { name: "Aanmelden" }),
      ).toHaveAttribute("href", "/auth/login");
    });

    it("carries the page the visitor was trying to reach", () => {
      mockSearchParams.mockReturnValue(new URLSearchParams("returnTo=/trips?view=week"));

      renderLogin();

      expect(screen.getByRole("link", { name: "Aanmelden" })).toHaveAttribute(
        "href",
        `/auth/login?returnTo=${encodeURIComponent("/trips?view=week")}`,
      );
    });

    /**
     * An absolute URL in `returnTo` would let a crafted link bounce someone to
     * another site the instant they signed in, with TRAXO's login as the last
     * thing they saw.
     */
    it.each([
      ["https://evil.example/steal"],
      ["//evil.example/steal"],
      ["javascript:alert(1)"],
    ])("refuses to return to %p", (returnTo) => {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({ returnTo }),
      );

      renderLogin();

      expect(screen.getByRole("link", { name: "Aanmelden" })).toHaveAttribute(
        "href",
        "/auth/login",
      );
    });
  });

  describe("what this page must never offer", () => {
    it("has no credential fields", () => {
      const { container } = renderLogin();

      expect(container.querySelector("input[type='password']")).toBeNull();
      expect(container.querySelector("input[type='email']")).toBeNull();
      expect(container.querySelector("form")).toBeNull();
    });

    /**
     * The word appears once, in the sentence explaining that registration is
     * NOT possible here. What must not exist is a CONTROL — signing in is the
     * only action this page offers.
     */
    it("offers no registration or password-reset control", () => {
      renderLogin();

      const actions = [
        ...screen.getAllByRole("link"),
        ...screen.queryAllByRole("button"),
      ].map((element) => element.textContent ?? "");

      expect(actions).toEqual(["Aanmelden"]);
    });
  });

  /**
   * The Auth0 tenant is provisioned outside this repository, so a complete
   * checkout can still have no configuration. Saying so beats a login button
   * that fails.
   */
  describe("before Auth0 is configured", () => {
    it("explains why signing in is unavailable", () => {
      renderLogin(false);

      expect(
        screen.getByText("Aanmelden is nog niet ingesteld"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Aanmelden" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("language", () => {
    it("translates the page", () => {
      window.localStorage.setItem("tms.language", "tr");

      renderLogin();

      expect(screen.getByRole("link", { name: "Giriş yap" })).toBeInTheDocument();
      expect(screen.getByText("Devam etmek için giriş yapın.")).toBeInTheDocument();
    });

    it("offers the language switch, so the page can be read", () => {
      renderLogin();

      expect(screen.getByLabelText(/taal|dil/i)).toBeInTheDocument();
    });
  });

  /** The shell must not wrap this page in the signed-in application's chrome. */
  describe("inside the application shell", () => {
    it("renders without the header", () => {
      mockPathname.mockReturnValue("/auth");

      const { container } = render(
        <ThemeProvider>
          <LanguageProvider>
            <AppShell>
              <LoginPanel isConfigured />
            </AppShell>
          </LanguageProvider>
        </ThemeProvider>,
      );

      expect(container.querySelector("header")).toBeNull();
      expect(
        within(container).queryByRole("link", { name: "Afmelden" }),
      ).not.toBeInTheDocument();
    });
  });
});
