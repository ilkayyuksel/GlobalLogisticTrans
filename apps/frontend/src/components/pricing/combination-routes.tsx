"use client";

import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import type { CombinationRouteConfiguration } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  BLANK_ROUTE_DRAFT,
  draftOf,
  type RouteDraft,
} from "@/lib/pricing/route-draft";

/** A Combination being typed: its group, if it has one, and both legs. */
export interface CombinationDraft {
  readonly id: string | null;
  readonly legs: readonly [RouteDraft, RouteDraft];
}

export const BLANK_COMBINATION_DRAFT: CombinationDraft = {
  id: null,
  legs: [{ ...BLANK_ROUTE_DRAFT }, { ...BLANK_ROUTE_DRAFT }],
};

/** A stored Combination, opened for editing — both legs at once, always. */
export function combinationDraftOf(
  combination: CombinationRouteConfiguration,
): CombinationDraft {
  return {
    id: combination.id,
    legs: [draftOf(combination.legs[0]), draftOf(combination.legs[1])],
  };
}

/**
 * The configured Combinations, each shown as ONE record with two legs.
 *
 * ── WHY NOT TWO ROWS IN THE TABLE ───────────────────────────────────────────
 * Two rows would look like two routes an operator could edit or delete
 * separately, and neither is true: a Combination is created, changed and removed
 * as a whole, because half of one prices the outbound and silently charges
 * nothing for the return. So the group carries the actions and the legs sit
 * inside it, labelled Leg 1 and Leg 2 in the order they were configured.
 *
 * ── AND IT IS NOT A TRIP GROUP ──────────────────────────────────────────────
 * Nothing here relates to grouping Trips in the Rittenlijst. That decides which
 * Trips carry the Backload; this decides what the two legs COST.
 */
export function CombinationRouteList({
  combinations,
  editingId,
  busyId,
  onEdit,
  onDelete,
}: {
  combinations: readonly CombinationRouteConfiguration[];
  editingId: string | null;
  busyId: string | null;
  onEdit: (combination: CombinationRouteConfiguration) => void;
  onDelete: (combination: CombinationRouteConfiguration) => void;
}) {
  const t = useTranslation();

  if (combinations.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        {t("settings.pricing.routes.combinations.title")}
      </h3>

      {combinations.map((combination, index) =>
        combination.id === editingId ? null : (
          <article
            key={combination.id}
            className="rounded-md border border-border"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              {/*
                Numbered by position rather than by its identifier: an operator
                needs to tell two Combinations apart on screen, and a UUID does
                that worse than "Combination #2".
              */}
              <span className="text-sm font-medium text-foreground">
                {`${t("settings.pricing.routes.combinations.label")} #${index + 1}`}
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === combination.id}
                  onClick={() => onEdit(combination)}
                  aria-label={`${t("settings.pricing.routes.edit")} ${t("settings.pricing.routes.combinations.label")} ${index + 1}`}
                  className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
                >
                  {t("settings.pricing.routes.edit")}
                </button>
                <button
                  type="button"
                  disabled={busyId === combination.id}
                  onClick={() => onDelete(combination)}
                  aria-label={`${t("settings.pricing.routes.delete")} ${t("settings.pricing.routes.combinations.label")} ${index + 1}`}
                  className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t("settings.pricing.routes.delete")}
                </button>
              </span>
            </header>

            <ul className="divide-y divide-border">
              {combination.legs.map((leg, legIndex) => (
                <li
                  key={leg.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    {`${t("settings.pricing.routes.combinations.leg")} ${legIndex + 1}`}
                  </span>
                  <span className="text-foreground">
                    {`${leg.departure} → ${leg.destination}`}
                  </span>
                  <LegAmount
                    labelKey="settings.pricing.routes.tarief"
                    value={leg.tarief}
                  />
                  {/*
                    A leg configured without a distance is charged no toll. An em
                    dash says that; a 0 would claim the road was measured.
                  */}
                  <LegAmount
                    labelKey="settings.pricing.routes.kilometres"
                    value={leg.kilometres ?? "—"}
                  />
                  <LegAmount
                    labelKey="settings.pricing.routes.tunnel"
                    value={leg.tunnel}
                  />
                </li>
              ))}
            </ul>
          </article>
        ),
      )}
    </div>
  );
}

function LegAmount({
  labelKey,
  value,
}: {
  labelKey: TranslationKey;
  value: string;
}) {
  const t = useTranslation();

  return (
    <span className="text-secondary">
      <span className="text-xs uppercase tracking-wide text-muted">
        {`${t(labelKey)} `}
      </span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

/**
 * The add / edit form for a Combination: both legs, always together.
 *
 * ── WHY ONE FORM AND NOT TWO ────────────────────────────────────────────────
 * A Combination is saved in one request and the backend writes both legs in one
 * transaction, so there is no moment at which it has a single leg. A form that
 * saved one leg at a time would have to invent that moment.
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
    <div className="mt-4 rounded-md border border-border bg-hover/40 p-3">
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
        {field("kilometres", "settings.pricing.routes.kilometres", true)}
        {field("tunnel", "settings.pricing.routes.tunnel", true)}
      </div>
    </fieldset>
  );
}

/** Confirms removing a whole Combination — both legs, never one. */
export function CombinationDeleteDialog({
  combination,
  index,
  onConfirm,
  onClose,
}: {
  combination: CombinationRouteConfiguration;
  index: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();

  return (
    <ConfirmDialog
      titleKey="settings.pricing.routes.combinations.deleteTitle"
      descriptionKey="settings.pricing.routes.combinations.deleteDescription"
      consequenceKey="settings.pricing.routes.deleteConsequence"
      confirmKey="settings.pricing.routes.delete"
      tone="danger"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <span className="font-medium text-foreground">
        {`${t("settings.pricing.routes.combinations.label")} #${index + 1}: ${combination.legs
          .map((leg) => `${leg.departure} → ${leg.destination}`)
          .join(" / ")}`}
      </span>
    </ConfirmDialog>
  );
}
