import { render, screen } from "@testing-library/react";

import AuthPage, { dynamic } from "./page";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("next/navigation", () => ({
  usePathname: () => "/auth",
  useSearchParams: () => new URLSearchParams(),
}));

/*
 * The Auth0 SDK ships as ES modules that Jest cannot parse, and constructing a
 * client is not what these tests are about. Only the SDK is replaced —
 * `isAuthConfigured` remains the real one, so what is under test is the actual
 * check the page makes against the actual environment.
 */
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {},
}));

/**
 * ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
 * `/auth` asks `isAuthConfigured()`, which reads server-side environment
 * variables. Those are RUNTIME configuration — two of them are secrets and are
 * therefore not build arguments — so a container build has none of them.
 *
 * Next prerenders any page that uses no dynamic API. It did exactly that here,
 * froze the build machine's answer ("not configured") into static HTML, and the
 * deployed site told every visitor that signing in was not set up while the
 * running container held a complete Auth0 configuration.
 *
 * The tests below pin both halves of the fix: the page must be rendered per
 * request, and it must report what the environment says AT THAT MOMENT.
 * ────────────────────────────────────────────────────────────────────────────
 */

const AUTH0_VARIABLES = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
] as const;

const CONFIGURED: Record<string, string> = {
  AUTH0_DOMAIN: "example.eu.auth0.com",
  AUTH0_CLIENT_ID: "a-client-id",
  AUTH0_CLIENT_SECRET: "a-client-secret-that-must-stay-on-the-server",
  AUTH0_SECRET: "0123456789abcdef0123456789abcdef",
  APP_BASE_URL: "https://trano.be",
};

const original = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of AUTH0_VARIABLES) {
    original.set(name, process.env[name]);
  }
});

afterEach(() => {
  for (const [name, value] of original) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function configure(values: Record<string, string> | null): void {
  for (const name of AUTH0_VARIABLES) {
    if (values === null) {
      delete process.env[name];
    } else {
      process.env[name] = values[name];
    }
  }
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>{AuthPage()}</LanguageProvider>
    </ThemeProvider>,
  );
}

describe("the /auth page", () => {
  /**
   * The one line that separates a working login page from one that lies about
   * itself. Asserted directly, because its absence is invisible in every test
   * that renders the component instead of the page.
   */
  it("is rendered per request, never prerendered at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("offers the login action when Auth0 is configured", () => {
    configure(CONFIGURED);

    renderPage();

    expect(screen.getByRole("link", { name: "Aanmelden" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(screen.queryByText("Aanmelden is nog niet ingesteld")).toBeNull();
  });

  it("keeps the guard when Auth0 is genuinely not configured", () => {
    configure(null);

    renderPage();

    expect(
      screen.getByText("Aanmelden is nog niet ingesteld"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aanmelden" })).toBeNull();
  });

  /**
   * An incomplete tenant is not a configured one. Each variable is removed in
   * turn from an otherwise complete set: every one of them must be enough to
   * fall back, because a half-configured SDK fails at the first redirect
   * instead of at the page.
   */
  it.each(AUTH0_VARIABLES)("falls back when %s is missing", (missing) => {
    configure({ ...CONFIGURED, [missing]: "" });

    renderPage();

    expect(
      screen.getByText("Aanmelden is nog niet ingesteld"),
    ).toBeInTheDocument();
  });

  /**
   * The page reads secrets; it must pass on nothing but a boolean. If a secret
   * ever reached the markup it would reach the browser with it.
   */
  it("puts no Auth0 value into the rendered page", () => {
    configure(CONFIGURED);

    const { container } = renderPage();
    const markup = container.innerHTML;

    for (const value of Object.values(CONFIGURED)) {
      expect(markup).not.toContain(value);
    }
  });

  /**
   * Reading the environment at render time is what makes the fix work: the same
   * page must be able to answer differently on two successive requests, which a
   * prerendered page cannot.
   */
  it("answers from the environment at the moment it renders", () => {
    configure(null);
    const first = renderPage();
    expect(
      first.getByText("Aanmelden is nog niet ingesteld"),
    ).toBeInTheDocument();
    first.unmount();

    configure(CONFIGURED);
    const second = renderPage();
    expect(second.getByRole("link", { name: "Aanmelden" })).toBeInTheDocument();
  });
});
