"use client";

import { InlineCell } from "@/components/ritten/inline-cell";
import {
  OVERRIDABLE_COMPONENTS,
  type OverridableComponent,
} from "@/lib/api/trip-pricing-overrides";
import type { EffectivePricing } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The eight pricing columns of one Ritten row.
 *
 * ── NOTHING HERE CALCULATES A PRICE ─────────────────────────────────────────
 * Every amount is rendered exactly as the backend sent it — a preformatted
 * two-decimal string. Totaal above all: it is the backend's own sum and is
 * never added up from the columns beside it. If the two ever disagreed, a
 * locally computed figure would hide a real problem behind a number that looks
 * right.
 *
 * ── THREE OF THE EIGHT ARE EDITABLE ─────────────────────────────────────────
 * Tarief, Tol and Tunnel. The other five are DERIVED from something the
 * operator can already change, so an editor on them would be a second,
 * competing answer:
 *
 *   Brandstof is a percentage of the effective Tarief — correct the Tarief;
 *   Backload follows from Combination membership — change the grouping;
 *   Others is Waiting Time plus the priced Custom Properties — edit one of
 *     those, which is where the amount actually lives;
 *   EK is the Cost Confirmation, and the confirmation is the evidence;
 *   Totaal is a sum, and a sum that disagrees with its parts is not a total.
 *
 * They render as plain text with no control of any kind — not a disabled input,
 * which would still say "this is a field, just not now".
 *
 * ── EMPTY IS NOT ZERO ───────────────────────────────────────────────────────
 * A Trip that has never been priced shows the table's empty marker in all eight
 * columns and offers no editor: there is no breakdown to correct yet. Only a
 * component the Engine priced at nothing shows `0.00`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** What the operator may type into, in the order the columns appear. */
interface EditableColumn {
  readonly labelKey: "ritten.column.tarief" | "ritten.column.tol" | "ritten.column.tunnel";
  readonly componentCode: OverridableComponent;
  readonly amountOf: (pricing: EffectivePricing) => string;
}

const EDITABLE_COLUMNS: Record<string, EditableColumn> = {
  tarief: {
    labelKey: "ritten.column.tarief",
    componentCode: OVERRIDABLE_COMPONENTS.tarief,
    amountOf: (pricing) => pricing.tarief,
  },
  tol: {
    labelKey: "ritten.column.tol",
    componentCode: OVERRIDABLE_COMPONENTS.tol,
    amountOf: (pricing) => pricing.tol,
  },
  tunnel: {
    labelKey: "ritten.column.tunnel",
    componentCode: OVERRIDABLE_COMPONENTS.tunnel,
    amountOf: (pricing) => pricing.tunnel,
  },
};

/**
 * The subtle mark on a manually corrected amount.
 *
 * Tokens only, so it reads the same in both themes, and deliberately smaller
 * than the marker for a field an UPDATE document moved: this says "somebody
 * typed this", which an operator needs to notice but not to be stopped by.
 */
const OVERRIDDEN_AMOUNT_CLASS =
  "rounded px-1 ring-1 ring-inset ring-primary/40 bg-primary/10";

export interface PricingCellsProps {
  /** The effective breakdown, or null when the Trip has never been priced. */
  pricing: EffectivePricing | null;
  /**
   * Records a correction for one component and resolves once the row shows the
   * recalculated figures. Rejects with the backend's own error, which the cell
   * displays without painting the attempted value.
   */
  onSaveOverride: (
    componentCode: OverridableComponent,
    amount: number,
  ) => Promise<void>;
  /** Withdraws a correction. Same contract as `onSaveOverride`. */
  onResetOverride: (componentCode: OverridableComponent) => Promise<void>;
  /** True while a lifecycle action is running for this row. */
  isDisabled: boolean;
}

export function PricingCells({
  pricing,
  onSaveOverride,
  onResetOverride,
  isDisabled,
}: PricingCellsProps) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");

  return (
    <>
      <EditableAmountCell
        column={EDITABLE_COLUMNS.tarief}
        pricing={pricing}
        onSaveOverride={onSaveOverride}
        onResetOverride={onResetOverride}
        isDisabled={isDisabled}
      />
      <ReadOnlyAmountCell amount={pricing?.brandstof ?? null} empty={empty} />
      <ReadOnlyAmountCell amount={pricing?.backload ?? null} empty={empty} />
      <EditableAmountCell
        column={EDITABLE_COLUMNS.tol}
        pricing={pricing}
        onSaveOverride={onSaveOverride}
        onResetOverride={onResetOverride}
        isDisabled={isDisabled}
      />
      <EditableAmountCell
        column={EDITABLE_COLUMNS.tunnel}
        pricing={pricing}
        onSaveOverride={onSaveOverride}
        onResetOverride={onResetOverride}
        isDisabled={isDisabled}
      />
      <ReadOnlyAmountCell amount={pricing?.others ?? null} empty={empty} />
      <ReadOnlyAmountCell amount={pricing?.ek ?? null} empty={empty} />
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-foreground">
        {pricing?.totaal ?? empty}
      </td>
    </>
  );
}

/**
 * A derived amount.
 *
 * Text, and only text. No button, no input, no disabled control — a reader must
 * be able to tell at a glance which three of the eight they can change.
 */
function ReadOnlyAmountCell({
  amount,
  empty,
}: {
  amount: string | null;
  empty: string;
}) {
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-secondary">
      {amount ?? empty}
    </td>
  );
}

/**
 * One of the three amounts an operator may type.
 *
 * Editing follows the row's own convention: `InlineCell` opens on click, saves
 * on Enter or the Save button, closes only once the backend has accepted, and
 * keeps a refusal in the cell with the backend's own wording. Nothing is
 * painted optimistically, so a failed save leaves the persisted amount exactly
 * where it was — there is nothing to roll back.
 *
 * The reset action is a SIBLING of the cell rather than inside it: the closed
 * cell is itself a button, and a button inside a button is not a control a
 * browser or a screen reader can make sense of.
 */
function EditableAmountCell({
  column,
  pricing,
  onSaveOverride,
  onResetOverride,
  isDisabled,
}: {
  column: EditableColumn;
  pricing: EffectivePricing | null;
  onSaveOverride: PricingCellsProps["onSaveOverride"];
  onResetOverride: PricingCellsProps["onResetOverride"];
  isDisabled: boolean;
}) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");
  const label = t(column.labelKey);

  /*
   * No breakdown, nothing to correct. An override on an unpriced Trip would be
   * stored and then have nothing to show for itself, because the backend
   * answers null until the Engine has priced the Trip.
   */
  if (!pricing) {
    return (
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-secondary">
        {empty}
      </td>
    );
  }

  const amount = column.amountOf(pricing);
  const isOverridden = isOverriddenComponent(pricing, column.componentCode);

  return (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-secondary">
      <span className="inline-flex items-center justify-end gap-1">
        <InlineCell
          label={`${label} ${t("ritten.pricing.editLabel")}`}
          kind="number"
          editValue={amount}
          displayValue={
            isOverridden ? (
              <span
                className={OVERRIDDEN_AMOUNT_CLASS}
                title={t("ritten.pricing.overridden")}
              >
                {amount}
              </span>
            ) : (
              amount
            )
          }
          isDisabled={isDisabled}
          onSave={(value) => onSaveOverride(column.componentCode, Number(value))}
        />

        {isOverridden ? (
          <ResetOverrideButton
            label={`${t("ritten.pricing.reset")} ${label}`}
            isDisabled={isDisabled}
            onReset={() => onResetOverride(column.componentCode)}
          />
        ) : null}
      </span>
    </td>
  );
}

/**
 * Withdraws a correction in one click, with no confirmation step.
 *
 * Deliberately no dialog: the action is small, immediately visible in the row,
 * and undone by typing the amount again. A confirmation would cost more
 * attention than the mistake it prevents.
 *
 * It does NOT clear the field. An empty box is indistinguishable from zero, and
 * zero is a legitimate correction — a Trip genuinely without toll.
 */
function ResetOverrideButton({
  label,
  isDisabled,
  onReset,
}: {
  label: string;
  isDisabled: boolean;
  onReset: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={isDisabled}
      onClick={() => void onReset()}
      className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* An arrow returning to its start. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 10a6 6 0 1 0 1.8-4.2" />
        <path d="M4 3.5V6h2.5" />
      </svg>
    </button>
  );
}

/** Whether an operator typed this component's amount, per the backend. */
function isOverriddenComponent(
  pricing: EffectivePricing,
  componentCode: string,
): boolean {
  return pricing.components.some(
    (component) =>
      component.componentCode === componentCode &&
      component.source === "OVERRIDE",
  );
}
