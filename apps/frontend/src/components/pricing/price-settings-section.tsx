"use client";

import { useState } from "react";

import { PricingConfigurationSection } from "@/components/pricing/pricing-configuration-section";
import { ErrorState, LoadingState } from "@/components/ui/states";
import type { useAsync } from "@/hooks/use-async";
import {
  FUEL_PERCENTAGE_SETTING,
  TOLL_RATE_PER_KM_SETTING,
  listSettings,
  saveSetting,
} from "@/lib/api/settings";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

type SettingsState = ReturnType<
  typeof useAsync<Awaited<ReturnType<typeof listSettings>>>
>;

/**
 * Prijsinstellingen — the numbers that apply to every route.
 *
 * ── FOLDED AWAY, AND WHY ────────────────────────────────────────────────────
 * An operator opens this page to change a route. These values are configured
 * once and then left alone for months, so they sit under the routes and start
 * closed: shut, the panel is one row of header and costs no space at all.
 *
 * It is an ordinary button with `aria-expanded` and the panel it controls,
 * which is the pattern the settings menu already uses. Nothing here remembers
 * the state — reopening the page starts closed again, which is the point.
 *
 * ── AND WHAT IS INSIDE ──────────────────────────────────────────────────────
 * The two amounts an administrator sets by hand, and under them the complete
 * report of every setting the Engine reads — including any that have no row
 * yet, which is what makes a fresh deployment fixable without SQL.
 */
export function PriceSettingsSection({
  settings,
  onSaved,
  onFailed,
}: {
  settings: SettingsState;
  onSaved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-md border border-border bg-card">
      <h2>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="price-settings-panel"
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover"
        >
          <span className="text-sm font-semibold text-foreground">
            {t("settings.pricing.settings.title")}
          </span>
          <span aria-hidden="true" className="text-sm text-secondary">
            {isOpen ? "−" : "+"}
          </span>
        </button>
      </h2>

      {isOpen ? (
        <div
          id="price-settings-panel"
          className="space-y-4 border-t border-border p-4"
        >
          {settings.isLoading ? (
            <LoadingState label={t("settings.pricing.loading")} />
          ) : null}

          {!settings.isLoading && settings.error ? (
            <ErrorState error={settings.error} onRetry={settings.reload} />
          ) : null}

          {!settings.isLoading && !settings.error ? (
            <>
              <AmountField
                settings={settings}
                setting={FUEL_PERCENTAGE_SETTING}
                inputId="fuel-percentage"
                labelKey="settings.pricing.fuel.label"
                unit="%"
                maximum={100}
                onSaved={onSaved}
                onFailed={onFailed}
              />

              {/*
                Said before the change rather than after it: an operator moving
                a rate needs to know what it will and will not touch.
              */}
              <p className="text-[11px] text-muted">
                {t("settings.pricing.fuel.historyNote")}
              </p>

              <AmountField
                settings={settings}
                setting={TOLL_RATE_PER_KM_SETTING}
                inputId="toll-rate-per-km"
                labelKey="settings.pricing.toll.label"
                unit="€ / km"
                onSaved={onSaved}
                onFailed={onFailed}
              />
            </>
          ) : null}

          <PricingConfigurationSection onSaved={onSaved} onFailed={onFailed} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * One configured amount: a number, and a button that saves it.
 *
 * The same control for the fuel percentage and the toll rate, because they are
 * the same thing — a stored decimal an administrator types. What differs is the
 * label, the unit beside the box and the ceiling, so those are given; the input
 * is a number field with the minimum of zero the backend enforces anyway, so a
 * negative amount is refused before it is sent AND refused if it ever is.
 *
 * Nothing is rounded, converted or defaulted here: the value is sent as typed.
 */
function AmountField({
  settings,
  setting,
  inputId,
  labelKey,
  unit,
  maximum,
  onSaved,
  onFailed,
}: {
  settings: SettingsState;
  setting: { readonly category: string; readonly key: string };
  inputId: string;
  labelKey: TranslationKey;
  unit: string;
  maximum?: number;
  onSaved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const stored =
    settings.data?.find(
      (candidate) =>
        candidate.category === setting.category && candidate.key === setting.key,
    )?.value ?? "";

  const value = draft ?? stored;

  async function save(): Promise<void> {
    setIsSaving(true);

    try {
      /*
       * Saves whether or not the setting has ever existed. It used to be an
       * update, which meant this control silently failed on every fresh
       * deployment — where the row does not exist at all.
       */
      await saveSetting(setting.category, setting.key, value.trim());
      setDraft(null);
      onSaved();
    } catch (error: unknown) {
      onFailed(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label
          htmlFor={inputId}
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
        >
          {t(labelKey)}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={maximum}
            step="0.01"
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          />
          <span aria-hidden="true" className="text-sm text-secondary">
            {unit}
          </span>
        </div>
      </div>

      {/*
        Named for the field it saves. Two amounts sit in this panel and the
        settings table below adds more, so a row of buttons all reading
        "Opslaan" would be ambiguous to anyone not looking at the screen.
      */}
      <button
        type="button"
        aria-label={`${t(labelKey)}: ${t("settings.pricing.save")}`}
        disabled={isSaving || value.trim() === ""}
        onClick={() => void save()}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {isSaving ? t("settings.pricing.saving") : t("settings.pricing.save")}
      </button>
    </div>
  );
}
