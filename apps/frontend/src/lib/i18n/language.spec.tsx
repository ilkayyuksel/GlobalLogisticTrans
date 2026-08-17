import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LanguageProvider, useLanguage } from "./language-provider";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  TRANSLATIONS,
  type TranslationKey,
} from "./translations";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

const STORAGE_KEY = "tms.language";

/**
 * Language selection and persistence.
 *
 * The dictionaries are checked structurally — every language must define every
 * key — because a missing translation shows a raw key in the interface, and no
 * individual test would catch the one key someone forgot.
 */

function renderShell() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <AppShell>
          <p>Inhoud</p>
        </AppShell>
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/**
 * Found by role, not by label: the label itself is translated, so looking it up
 * by Dutch text would stop working the moment the language changes — which is
 * precisely what these tests do.
 */
function languageSelect(): HTMLSelectElement {
  return screen.getByRole("combobox") as HTMLSelectElement;
}

describe("language", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
  });

  describe("the dictionaries", () => {
    it("defines Dutch as the default", () => {
      expect(DEFAULT_LANGUAGE).toBe("nl");
    });

    it("supports exactly Dutch and Turkish", () => {
      expect([...LANGUAGES]).toEqual(["nl", "tr"]);
    });

    /** A missing key renders as the key itself — visible, but wrong. */
    it("translates every key in every language", () => {
      const dutchKeys = Object.keys(TRANSLATIONS.nl).sort();

      for (const language of LANGUAGES) {
        expect(Object.keys(TRANSLATIONS[language]).sort()).toEqual(dutchKeys);
      }
    });

    it("leaves no translation empty", () => {
      for (const language of LANGUAGES) {
        for (const [key, value] of Object.entries(TRANSLATIONS[language])) {
          expect(`${key}=${value}`).not.toBe(`${key}=`);
        }
      }
    });

    it("uses the product's own Dutch vocabulary", () => {
      expect(TRANSLATIONS.nl["navigation.trips"]).toBe("Ritten");
      expect(TRANSLATIONS.nl["navigation.calendar"]).toBe("Agenda");
      expect(TRANSLATIONS.nl["navigation.licensePlates"]).toBe("Nummerplaten");
      expect(TRANSLATIONS.nl["navigation.customValues"]).toBe("Custom waarden");
    });

    it("actually differs in Turkish rather than copying Dutch", () => {
      const shared = (
        [
          "navigation.trips",
          "navigation.vehicles",
          "navigation.notes",
          "common.save",
        ] as TranslationKey[]
      ).filter((key) => TRANSLATIONS.nl[key] === TRANSLATIONS.tr[key]);

      expect(shared).toEqual([]);
    });
  });

  describe("choosing a language", () => {
    it("starts in Dutch", () => {
      renderShell();

      expect(languageSelect().value).toBe("nl");
      expect(screen.getByRole("link", { name: "Ritten" })).toBeInTheDocument();
    });

    it("offers each language in its own name", () => {
      renderShell();

      const options = within(languageSelect())
        .getAllByRole("option")
        .map((option) => option.textContent);

      expect(options).toEqual(["Nederlands", "Türkçe"]);
    });

    it("translates the navigation when Turkish is chosen", async () => {
      renderShell();

      await userEvent.selectOptions(languageSelect(), "tr");

      expect(await screen.findByRole("link", { name: "Seferler" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Araçlar" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Ritten" })).not.toBeInTheDocument();
    });

    it("translates the settings menu too", async () => {
      renderShell();

      await userEvent.selectOptions(languageSelect(), "tr");
      await userEvent.click(await screen.findByRole("button", { name: /Ayarlar/ }));

      expect(screen.getByRole("menuitem", { name: "Plakalar" })).toBeInTheDocument();
    });

    it("switches back to Dutch", async () => {
      renderShell();

      await userEvent.selectOptions(languageSelect(), "tr");
      await screen.findByRole("link", { name: "Seferler" });
      await userEvent.selectOptions(languageSelect(), "nl");

      expect(await screen.findByRole("link", { name: "Ritten" })).toBeInTheDocument();
    });
  });

  describe("persistence", () => {
    it("stores the chosen language", async () => {
      renderShell();

      await userEvent.selectOptions(languageSelect(), "tr");

      await waitFor(() => {
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("tr");
      });
    });

    it("restores the stored language on the next visit", async () => {
      window.localStorage.setItem(STORAGE_KEY, "tr");

      renderShell();

      expect(await screen.findByRole("link", { name: "Seferler" })).toBeInTheDocument();
    });

    it("falls back to Dutch when the stored value is not a language", async () => {
      window.localStorage.setItem(STORAGE_KEY, "klingon");

      renderShell();

      expect(screen.getByRole("link", { name: "Ritten" })).toBeInTheDocument();
    });

    it("keeps the document language in step for assistive technology", async () => {
      renderShell();

      await userEvent.selectOptions(languageSelect(), "tr");

      await waitFor(() => {
        expect(document.documentElement.lang).toBe("tr");
      });
    });
  });

  describe("the hook", () => {
    function Probe() {
      const { t } = useLanguage();

      return <span>{t("common.save")}</span>;
    }

    it("translates through the active language", () => {
      render(
        <LanguageProvider>
          <Probe />
        </LanguageProvider>,
      );

      expect(screen.getByText("Opslaan")).toBeInTheDocument();
    });

    it("refuses to work outside its provider", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      expect(() => render(<Probe />)).toThrow(/LanguageProvider/);

      consoleError.mockRestore();
    });
  });
});
