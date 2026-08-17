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

import {
  DEFAULT_LANGUAGE,
  TRANSLATIONS,
  type Language,
  type TranslationKey,
  isLanguage,
} from "./translations";

/**
 * The chosen language, and the `t()` that reads from it.
 *
 * ── ON THE FIRST RENDER ─────────────────────────────────────────────────────
 * The stored choice lives in localStorage, which the server cannot read. So the
 * first render — on the server and again during hydration — always uses Dutch,
 * and the stored language is applied in an effect immediately afterwards.
 *
 * A Turkish user therefore sees Dutch for one frame. That is a deliberate
 * trade: reading storage during render would make the server and client HTML
 * disagree, and a hydration mismatch corrupts the DOM in ways that are far
 * harder to notice than a brief flicker. Dutch is also the default, so the vast
 * majority of loads show the right language immediately.
 * ────────────────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = "tms.language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Applied after mount, when localStorage is readable.
  useEffect(() => {
    const stored = readStoredLanguage();

    if (stored) {
      setLanguageState(stored);
    }
  }, []);

  // Keeps assistive technology and the browser informed of the real language.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). The choice
      // still applies for this session; only persistence is lost.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      // A missing key returns the key itself, which is visible in the interface
      // and searchable in the source — better than an empty label that looks
      // like a rendering bug.
      t: (key) => TRANSLATIONS[language][key] ?? key,
    }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used inside a LanguageProvider.");
  }

  return context;
}

/** Shorthand for components that only need to translate. */
export function useTranslation(): (key: TranslationKey) => string {
  return useLanguage().t;
}

function readStoredLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}
