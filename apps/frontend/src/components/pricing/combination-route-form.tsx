"use client";

import {
  OVER_ST_FIELDS,
  type CombinationDraft,
} from "@/components/pricing/combination-routes";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { OverStDraft, RouteDraft } from "@/lib/pricing/route-draft";

/**
 * The ADD form for a Combination: both legs, always together.
 *
 * ── WHY ONE FORM AND NOT TWO ────────────────────────────────────────────────
 * A Combination is created in one request and the backend writes both legs in one
 * transaction, so there is no moment at which it has a single leg. A form that
 * saved one leg at a time would have to invent that moment.
 *
 * It only ever adds. A Combination that exists is changed in its own rows.
 *
 * Van and Naar are free TEXT, as they are for an ordinary route: there is no
 * terminal master data in this system and no city list, so a dropdown could only
 * offer a guess.
 */
export function CombinationRouteForm({
  draft,
  isBusy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: CombinationDraft;
  isBusy: boolean;
  onChange: (draft: CombinationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();

  function changeLeg(index: number, leg: RouteDraft): void {
    onChange({
      ...draft,
      legs: (index === 0 ? [leg, draft.legs[1]] : [draft.legs[0], leg]) as [
        RouteDraft,
        RouteDraft,
      ],
    });
  }

  return (
    <div className="mb-3 rounded-md border border-border bg-hover/40 p-3">
      <h3 className="text-sm font-semibold text-foreground">
        {t("settings.pricing.routes.combinations.formTitle")}
      </h3>
      {/*
        Two legs is not a limit to work around — it is what a Combination IS, and
        saying so prevents an operator hunting for a way to add a third.
      */}
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.routes.combinations.note")}
      </p>

      <div className="mt-3 space-y-3">
        {draft.legs.map((leg, index) => (
          <LegFields
            key={index}
            legNumber={index + 1}
            leg={leg}
            onChange={(changed) => changeLeg(index, changed)}
          />
        ))}
        <OverStFields
          overSt={draft.overSt}
          onChange={(overSt) => onChange({ ...draft, overSt })}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={onSave}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isBusy ? t("settings.pricing.saving") : t("settings.pricing.save")}
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("settings.pricing.cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * One leg's five fields.
 *
 * Every label names the leg it belongs to — "Leg 2: Tarief" — because the form
 * shows the same five fields twice, and a screen reader on a field called
 * "Tarief" could not say which leg it is priced for.
 */
function LegFields({
  legNumber,
  leg,
  onChange,
}: {
  legNumber: number;
  leg: RouteDraft;
  onChange: (leg: RouteDraft) => void;
}) {
  const t = useTranslation();
  const legLabel = `${t("settings.pricing.routes.combinations.leg")} ${legNumber}`;

  const field = (
    name: keyof Omit<RouteDraft, "id">,
    labelKey: TranslationKey,
    isAmount: boolean,
  ) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {t(labelKey)}
      </span>
      <input
        type={isAmount ? "number" : "text"}
        inputMode={isAmount ? "decimal" : undefined}
        min={isAmount ? 0 : undefined}
        step={isAmount ? "0.01" : undefined}
        aria-label={`${legLabel}: ${t(labelKey)}`}
        value={leg[name]}
        onChange={(event) => onChange({ ...leg, [name]: event.target.value })}
        className={`rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground ${
          isAmount ? "w-24 text-right" : "w-40"
        }`}
      />
    </label>
  );

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {legLabel}
      </legend>
      <div className="flex flex-wrap gap-3">
        {field("departure", "settings.pricing.routes.from", false)}
        {field("destination", "settings.pricing.routes.to", false)}
        {field("tarief", "settings.pricing.routes.tarief", true)}
        {field("toll", "settings.pricing.routes.toll", true)}
        {field("tunnel", "settings.pricing.routes.tunnel", true)}
      </div>
    </fieldset>
  );
}

/**
 * Over ST's three amounts in the add form.
 *
 * Optional, like the stored ones: an empty box is "not stated" and is saved as
 * null, never as an invented zero.
 */
function OverStFields({
  overSt,
  onChange,
}: {
  overSt: OverStDraft;
  onChange: (overSt: OverStDraft) => void;
}) {
  const t = useTranslation();
  const legend = t("settings.pricing.routes.overSt");

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-3">
        {OVER_ST_FIELDS.map(({ field, labelKey }) => (
          <label key={field} className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
              {t(labelKey)}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              aria-label={`${legend}: ${t(labelKey)}`}
              value={overSt[field]}
              onChange={(event) => onChange({ ...overSt, [field]: event.target.value })}
              className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-sm text-foreground"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
