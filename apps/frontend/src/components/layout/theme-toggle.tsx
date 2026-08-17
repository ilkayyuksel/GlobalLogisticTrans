"use client";

import { useTheme } from "@/lib/theme/theme-provider";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Switches between light and dark.
 *
 * A single button rather than a three-way control: the system preference is
 * honoured until the user expresses a choice, and once they have, "follow the
 * system" is not a state they are likely to want back. The accessible name says
 * what the button will DO, not what the theme currently is, which is what a
 * screen-reader user needs to decide whether to press it.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const t = useTranslation();

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t(isDark ? "theme.toSwitchToLight" : "theme.toSwitchToDark")}
      title={t("theme.label")}
      className="rounded-md border border-navigation-border px-2.5 py-1.5 text-sm text-navigation-foreground hover:bg-navigation-raised"
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <span className="sr-only">
        {t(isDark ? "theme.light" : "theme.dark")}
      </span>
    </button>
  );
}
