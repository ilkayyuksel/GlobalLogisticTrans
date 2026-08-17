"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Light or dark, remembered between visits.
 *
 * No theme library. `globals.css` already defines both palettes as CSS
 * variables and Tailwind is configured with `darkMode: "class"`, so the entire
 * mechanism is one class on <html> — which is exactly what a library would do,
 * with a dependency attached.
 *
 * The initial class is applied by `THEME_SCRIPT` before the browser paints, so
 * a dark-mode user never sees a white flash. This provider therefore does not
 * decide the first paint; it reads back what the script already applied and
 * owns every change after that.
 */

export const THEME_STORAGE_KEY = "tms.theme";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Runs before first paint, inline in <head>.
 *
 * Deliberately tiny and dependency-free: it reads the stored choice, falls back
 * to the operating system's preference, and sets the class. Anything heavier
 * would delay the paint it exists to protect. Wrapped in try/catch because
 * localStorage throws in some privacy modes, and a themed page is not worth a
 * blank one.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts light so the server and the client agree; the effect below adopts
  // whatever the pre-paint script actually applied.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is optional; the theme still applies for this session.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside a ThemeProvider.");
  }

  return context;
}
