"use client";

import { useLanguage } from "@/lib/i18n/language-provider";
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  type Language,
} from "@/lib/i18n/translations";

/**
 * Chooses the interface language.
 *
 * A native <select>: it is keyboard-operable everywhere, works on touch, and
 * needs no focus management of its own. Each option is written in its OWN
 * language — a Turkish speaker looking for their language should not have to
 * read Dutch to find it.
 */
export function LanguageSelect() {
  const { language, setLanguage } = useLanguage();
  const { t } = useLanguage();

  return (
    <>
      <label htmlFor="language-select" className="sr-only">
        {t("language.label")}
      </label>
      <select
        id="language-select"
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        title={t("language.label")}
        className="rounded-md border border-navigation-border bg-navigation-raised px-2 py-1.5 text-sm text-navigation-foreground"
      >
        {LANGUAGES.map((option) => (
          <option key={option} value={option}>
            {LANGUAGE_LABELS[option]}
          </option>
        ))}
      </select>
    </>
  );
}
