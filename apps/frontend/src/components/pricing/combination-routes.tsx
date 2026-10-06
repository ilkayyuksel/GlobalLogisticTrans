"use client";

import {
  ReviewCheckbox,
  RouteValueCells,
  SelectionCell,
} from "@/components/pricing/route-row";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { InlineCell } from "@/components/ritten/inline-cell";
import type { CombinationRouteConfiguration } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  BLANK_OVER_ST_DRAFT,
  BLANK_ROUTE_DRAFT,
  type OverStDraft,
  type OverStField,
  type RouteDraft,
  type RouteField,
} from "@/lib/pricing/route-draft";

/**
 * A Combination being ADDED: both legs, typed together.
 *
 * There is no draft of a stored Combination, because a stored one is never
 * opened in a form: every value of both legs is edited where it stands. The form
 * exists for the one thing a row cannot do — come into being.
 */
export interface CombinationDraft {
  readonly legs: readonly [RouteDraft, RouteDraft];
  readonly overSt: OverStDraft;
}

export const BLANK_COMBINATION_DRAFT: CombinationDraft = {
  legs: [{ ...BLANK_ROUTE_DRAFT }, { ...BLANK_ROUTE_DRAFT }],
  overSt: { ...BLANK_OVER_ST_DRAFT },
};

/** Over ST's three amounts, in the order of the table's amount columns. */
export const OVER_ST_FIELDS: readonly { field: OverStField; labelKey: TranslationKey }[] = [
  { field: "tarief", labelKey: "settings.pricing.routes.tarief" },
  { field: "toll", labelKey: "settings.pricing.routes.toll" },
  { field: "tunnel", labelKey: "settings.pricing.routes.tunnel" },
];

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
 * ── OVER ST: PART OF THE COMBINATION, NOT A THIRD LEG ───────────────────────
 * Beneath the two legs sits Over ST — the Combination's own Tarief, Toll and
 * Tunnel. It has no Van or Naar, so it fills only the amount columns, carries no
 * selection, no review tick and no sync: it belongs to the group above it.
 *
 * ── AND NO BEWERKEN, ON THE GROUP EITHER ────────────────────────────────────
 * A leg's Van, Naar, Tarief, Toll and Tunnel are edited by clicking them, exactly
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
  onSaveOverStField,
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
  /** Persists one Over ST amount. Rejects to keep the cell open. */
  onSaveOverStField: (field: OverStField, value: string) => Promise<void>;
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

      <tr className="border-b border-border last:border-0">
        {/* Selected with the group; Over ST is no record of its own. */}
        <td className="px-3 py-2" />
        {/* It has no Van or Naar: its label spans the two route columns. */}
        <th
          scope="row"
          colSpan={2}
          className="px-3 py-2 text-left text-xs font-medium text-muted"
        >
          {t("settings.pricing.routes.overSt")}
        </th>
        {OVER_ST_FIELDS.map(({ field, labelKey }) => (
          <td
            key={field}
            className="px-3 py-2 text-right tabular-nums text-secondary"
          >
            <InlineCell
              label={`${t("settings.pricing.routes.overSt")} ${t(labelKey)}: ${label}`}
              // An em dash for an amount nobody has stated, which is not a zero.
              displayValue={combination.overSt[field] ?? "—"}
              editValue={combination.overSt[field] ?? ""}
              kind="number"
              min={0}
              onSave={(value) => onSaveOverStField(field, value)}
            />
          </td>
        ))}
        {/* No review tick and no action of its own. */}
        <td className="px-3 py-2" />
        <td className="px-3 py-2" />
      </tr>
    </tbody>
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
