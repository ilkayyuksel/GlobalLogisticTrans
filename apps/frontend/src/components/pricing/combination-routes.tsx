"use client";

import {
  ReviewCheckbox,
  RouteValueCells,
  SelectionCell,
} from "@/components/pricing/route-row";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import type { CombinationRouteConfiguration } from "@/lib/api/route-configuration";
import type { RouteField } from "@/lib/pricing/route-draft";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { BLANK_ROUTE_DRAFT, type RouteDraft } from "@/lib/pricing/route-draft";

/**
 * A Combination being ADDED: both legs, typed together.
 *
 * There is no draft of a stored Combination, because a stored one is never
 * opened in a form: every value of both legs is edited where it stands. The form
 * exists for the one thing a row cannot do — come into being.
 */
export interface CombinationDraft {
  readonly legs: readonly [RouteDraft, RouteDraft];
}

export const BLANK_COMBINATION_DRAFT: CombinationDraft = {
  legs: [{ ...BLANK_ROUTE_DRAFT }, { ...BLANK_ROUTE_DRAFT }],
};

/**
 * One Combination, as rows of the Routeprijzen table.
 *
 * ── THE SAME ROWS AS AN ORDINARY ROUTE ──────────────────────────────────────
 * A Combination used to be drawn as a card of its own beside the table: a
 * different border, different spacing, different type, and twice the height for
 * the same information. It is the same information — two roads, each with a
 * Tarief, a distance and a tunnel — so it is now the same two rows, in the same
 * table, drawn by the very component an ordinary route uses.
 *
 * ── AND STILL PLAINLY ONE RECORD ────────────────────────────────────────────
 * What a Combination needs beyond an ordinary route is the fact that its two
 * rows belong together. That is a quiet header row — the word Combination, and
 * the actions that apply to the PAIR — and the browser's own grouping: each
 * Combination is one `<tbody>`, which is what that element is for, so a screen
 * reader hears the legs as a group rather than as two loose rows. The same
 * pattern the Ritten list uses to group a day's Trips under their truck.
 *
 * No leg is selected, reviewed or removed on its own, because none exists on
 * its own. The one action a leg does carry is Sync: copying its prices to the
 * same leg of other Combinations, which is about that leg and nothing else.
 *
 * ── AND NO BEWERKEN, ON THE GROUP EITHER ────────────────────────────────────
 * A leg's Van, Naar, Tarief, KM and Tunnel are edited by clicking them, exactly
 * as an ordinary route's are, so the pair has nothing left for a form to do. The
 * transaction that keeps both legs in step is the backend's, not the form's: one
 * leg at a time reaches it, and the other is passed through unchanged.
 */
export function CombinationRows({
  combination,
  index,
  isBusy,
  isSelected,
  columnCount,
  onToggleSelected,
  onDelete,
  onSyncLeg,
  onReview,
  onSaveLegField,
}: {
  combination: CombinationRouteConfiguration;
  /** Its place in the list, which is what the operator sees it called. */
  index: number;
  isBusy: boolean;
  /** Selected for a bulk action — the whole Combination, never one leg. */
  isSelected: boolean;
  columnCount: number;
  onToggleSelected: () => void;
  onDelete: () => void;
  /**
   * Starts copying one leg's prices to the same leg of other Combinations.
   * Named by index, as `onSaveLegField` is: index 0 is leg position 1.
   */
  onSyncLeg: (legIndex: number) => void;
  onReview: (reviewed: boolean) => void;
  /**
   * Persists one field of ONE leg.
   *
   * The leg is named by its index because that is what the Combination's own
   * update needs: it replaces both legs in one transaction, and the untouched
   * one is passed through unchanged. Rejects to keep the cell open.
   */
  onSaveLegField: (
    legIndex: number,
    field: RouteField,
    value: string,
  ) => Promise<void>;
}) {
  const t = useTranslation();
  const label = `${t("settings.pricing.routes.combinations.label")} #${index + 1}`;

  return (
    <tbody className="border-t border-border">
      <tr>
        {/*
          The selection belongs to the GROUP, like the review tick: a bulk delete
          removes a Combination whole, so there is no leg to select on its own.
        */}
        <SelectionCell
          isSelected={isSelected}
          label={label}
          onToggle={onToggleSelected}
        />
        {/*
          A heading row rather than a card header: it spans the value columns and
          leaves the last one to the actions, so the table's own column rhythm is
          not broken by the group it introduces.
        */}
        <th
          scope="colgroup"
          colSpan={columnCount - 3}
          className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted"
        >
          {label}
        </th>
        {/*
          The tick belongs to the GROUP, beside the actions that also belong to
          it. A Combination is reviewed as one record, because it is configured,
          edited and removed as one.
        */}
        <td className="px-3 py-1.5">
          <ReviewCheckbox
            reviewed={combination.reviewed}
            label={label}
            isBusy={isBusy}
            onChange={onReview}
          />
        </td>
        {/*
          One action, as on an ordinary route's row: the one thing the pair
          cannot do to itself. Editing happens in the legs below.
        */}
        <td className="px-3 py-1.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={onDelete}
            aria-label={`${t("settings.pricing.routes.delete")} ${t("settings.pricing.routes.combinations.label")} ${index + 1}`}
            className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t("settings.pricing.routes.delete")}
          </button>
        </td>
      </tr>

      {combination.legs.map((leg, legIndex) => (
        <tr key={leg.id} className="border-b border-border last:border-0">
          {/* Selected with the group, in the header row above. */}
          <td className="px-3 py-2" />
          {/*
            Every value of a leg is edited where it stands, exactly as an
            ordinary route's is. What differs is only where the change goes: one
            leg at a time, through the Combination's own transaction.
          */}
          <RouteValueCells
            route={leg}
            onSaveField={(field, value) =>
              onSaveLegField(legIndex, field, value)
            }
          />
          {/* No tick per leg: the group's mark above answers for both. */}
          <td className="px-3 py-2" />
          {/*
            The leg number, where the eye already is, and the one action that IS
            a leg's own: copying its prices to the same leg of other
            Combinations. A leg is still never edited as a form or removed on its
            own.
          */}
          <td className="px-3 py-2 text-xs text-muted">
            <span className="flex items-center gap-2">
              {`${t("settings.pricing.routes.combinations.leg")} ${legIndex + 1}`}
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onSyncLeg(legIndex)}
                aria-label={t("settings.pricing.routes.sync.actionLabel")
                  .replace(
                    "{leg}",
                    `${t("settings.pricing.routes.combinations.leg")} ${legIndex + 1}`,
                  )
                  .replace("{route}", `${leg.departure} → ${leg.destination}`)}
                className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
              >
                {t("settings.pricing.routes.sync.action")}
              </button>
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  );
}

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
