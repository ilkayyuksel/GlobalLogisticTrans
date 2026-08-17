import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { THEME_SCRIPT, THEME_STORAGE_KEY, ThemeProvider, useTheme } from "./theme-provider";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * Light and dark.
 *
 * The whole mechanism is one class on <html>, so that is what the tests read.
 * The pre-paint script is executed directly rather than mocked, because its job
 * — deciding the theme before React exists — is exactly what could regress.
 */

function runThemeScript() {
  new Function(THEME_SCRIPT)();
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <ThemeToggle />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** jsdom has no real matchMedia; this lets a test choose the system preference. */
function setSystemPrefersDark(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
      onchange: null,
    }),
  });
}

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
    setSystemPrefersDark(false);
  });

  describe("the pre-paint script", () => {
    it("follows the system when no choice has been made", () => {
      setSystemPrefersDark(true);

      runThemeScript();

      expect(isDark()).toBe(true);
    });

    it("stays light when the system prefers light", () => {
      setSystemPrefersDark(false);

      runThemeScript();

      expect(isDark()).toBe(false);
    });

    /** An explicit choice outranks the operating system. */
    it("prefers a stored choice over the system preference", () => {
      setSystemPrefersDark(true);
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");

      runThemeScript();

      expect(isDark()).toBe(false);
    });

    it("applies a stored dark choice on a light system", () => {
      setSystemPrefersDark(false);
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

      runThemeScript();

      expect(isDark()).toBe(true);
    });

    it("ignores a corrupted stored value", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
      setSystemPrefersDark(false);

      runThemeScript();

      expect(isDark()).toBe(false);
    });

    /** A themed page is not worth a blank one if storage is unavailable. */
    it("does not throw when storage is blocked", () => {
      const getItem = jest
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("blocked");
        });

      expect(() => runThemeScript()).not.toThrow();

      getItem.mockRestore();
    });
  });

  describe("the toggle", () => {
    it("switches to dark", async () => {
      renderToggle();

      await userEvent.click(screen.getByRole("button"));

      expect(isDark()).toBe(true);
    });

    it("switches back to light", async () => {
      renderToggle();

      await userEvent.click(screen.getByRole("button"));
      await userEvent.click(screen.getByRole("button"));

      expect(isDark()).toBe(false);
    });

    it("persists the choice", async () => {
      renderToggle();

      await userEvent.click(screen.getByRole("button"));

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    });

    /** Reload: the script decides, and it must honour what was stored. */
    it("keeps the choice across a reload", async () => {
      renderToggle();
      await userEvent.click(screen.getByRole("button"));

      document.documentElement.className = "";
      runThemeScript();

      expect(isDark()).toBe(true);
    });

    it("adopts the theme the script already applied", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      runThemeScript();

      renderToggle();

      // The button now offers the opposite action.
      expect(
        screen.getByRole("button", { name: "Overschakelen naar licht thema" }),
      ).toBeInTheDocument();
    });

    it("describes the action it will perform, not the current state", () => {
      renderToggle();

      expect(
        screen.getByRole("button", { name: "Overschakelen naar donker thema" }),
      ).toBeInTheDocument();
    });
  });

  describe("the hook", () => {
    function Probe() {
      const { theme } = useTheme();

      return <span>theme:{theme}</span>;
    }

    it("reports the active theme", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      runThemeScript();

      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );

      expect(screen.getByText("theme:dark")).toBeInTheDocument();
    });

    it("refuses to work outside its provider", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      expect(() => render(<Probe />)).toThrow(/ThemeProvider/);

      consoleError.mockRestore();
    });
  });
});
