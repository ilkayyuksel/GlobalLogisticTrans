"use client";

import { InlineCell } from "@/components/ritten/inline-cell";
import type { RouteConfiguration } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { RouteField } from "@/lib/pricing/route-draft";

/**
 * The review tick: one checkbox, one column, as little width as a column can
 * take.
 *
 * ── WHAT IT MEANS, AND WHAT IT DOES NOT ─────────────────────────────────────
 * That somebody has been through these prices. Nothing more: the route is used
 * either way, a Trip is charged the same either way, and the Pricing Engine
 * never reads it. It is a place for an administrator working through a long list
 * to keep their place.
 *
 * The VALUE is sent rather than a toggle, so pressing it twice leaves the mark
 * where it was put — see the API client.
 */
export function ReviewCheckbox({
  reviewed,
  label,
  isBusy,
  onChange,
}: {
  reviewed: boolean;
  /** Which record this ticks, for anyone not looking at the screen. */
  label: string;
  isBusy: boolean;
  onChange: (reviewed: boolean) => void;
}) {
  const t = useTranslation();

  return (
    <input
      type="checkbox"
      checked={reviewed}
      disabled={isBusy}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={`${t("settings.pricing.routes.reviewed")}: ${label}`}
      className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
    />
  );
}

/**
 * The selection tick for a bulk action — a different checkbox from the review
 * tick, in its own first column, and never sent anywhere until the operator
 * acts on the selection.
 */
export function SelectionCell({
  isSelected,
  label,
  onToggle,
}: {
  isSelected: boolean;
  /** Which record this selects, for anyone not looking at the screen. */
  label: string;
  onToggle: () => void;
}) {
  const t = useTranslation();

  return (
    <td className="w-px px-3 py-2">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        aria-label={`${t("settings.pricing.routes.select")}: ${label}`}
        className="h-4 w-4 rounded border-border accent-primary"
      />
    </td>
  );
}

/** Each editable value, with the control its field calls for. */
const FIELDS: readonly {
  readonly field: RouteField;
  readonly labelKey: TranslationKey;
  readonly isAmount: boolean;
}[] = [
  { field: "departure", labelKey: "settings.pricing.routes.from", isAmount: false },
  { field: "destination", labelKey: "settings.pricing.routes.to", isAmount: false },
  { field: "tarief", labelKey: "settings.pricing.routes.tarief", isAmount: true },
  {
    field: "kilometres",
    labelKey: "settings.pricing.routes.kilometres",
    isAmount: true,
  },
  { field: "tunnel", labelKey: "settings.pricing.routes.tunnel", isAmount: true },
];

/**
 * One configured route, as a row of the Routeprijzen table — every value of it
 * editable where it stands.
 *
 * ── THE VALUE IS THE CONTROL ────────────────────────────────────────────────
 * There is no Bewerken button and no form. Clicking a value opens it, Enter
 * saves it, Escape puts it back: the application's own inline-editing component,
 * the same one the Ritten list has always used for a container number or a
 * destination. Reusing it is the point — the behaviour an operator has learned
 * on one screen is the behaviour they get here, including that leaving a field
 * saves NOTHING and that a refusal stays in the cell with the backend's own
 * words.
 *
 * ── ONE ROW SHAPE FOR BOTH KINDS ────────────────────────────────────────────
 * An ordinary route and a leg of a Combination are the same thing on screen: a
 * road with a Tarief, a distance and a tunnel. They are drawn by the same cells
 * and edited the same way; only WHERE the change is sent differs, which is the
 * caller's business and arrives as `onSaveField`.
 */
export function RouteValueCells({
  route,
  onSaveField,
}: {
  route: RouteConfiguration;
  /** Persists one field. Rejects to keep the cell open with its message. */
  onSaveField: (field: RouteField, value: string) => Promise<void>;
}) {
  const t = useTranslation();
  const road = `${route.departure} ${route.destination}`;

  return (
    <>
      {FIELDS.map(({ field, labelKey, isAmount }) => (
        <td
          key={field}
          className={`px-3 py-2 ${isAmount ? "text-right tabular-nums text-secondary" : "text-foreground"}`}
        >
          <InlineCell
            label={`${t(labelKey)}: ${road}`}
            /*
             * An em dash for a road nobody has measured: no toll is charged for
             * it until somebody states a distance, and a 0 would claim that
             * somebody had decided it is free. The EDIT box is empty, which is
             * the same statement in a form an operator can fill in.
             */
            displayValue={displayValueOf(route, field)}
            editValue={route[field] ?? ""}
            kind={isAmount ? "number" : "text"}
            /*
             * No length or range limit stated here. The endpoint lengths, the
             * money precision and the refusal of a negative amount are the
             * backend's rules, applied to this call exactly as they are to the
             * add form — repeating them in the browser would be the same rule in
             * two places, and the browser's copy is the one that drifts.
             */
            min={isAmount ? 0 : undefined}
            onSave={(value) => onSaveField(field, value)}
          />
        </td>
      ))}
    </>
  );
}

function displayValueOf(route: RouteConfiguration, field: RouteField): string {
  return route[field] ?? "—";
}

/** An ordinary route: its editable values, its review tick, and Verwijderen. */
export function RouteRow({
  route,
  isBusy,
  isSelected,
  onToggleSelected,
  onDelete,
  onReview,
  onSaveField,
}: {
  route: RouteConfiguration;
  isBusy: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onDelete: () => void;
  onReview: (reviewed: boolean) => void;
  onSaveField: (field: RouteField, value: string) => Promise<void>;
}) {
  const t = useTranslation();

  return (
    <tr className="border-b border-border last:border-0">
      <SelectionCell
        isSelected={isSelected}
        label={`${route.departure} ${route.destination}`}
        onToggle={onToggleSelected}
      />
      <RouteValueCells route={route} onSaveField={onSaveField} />
      <td className="px-3 py-2">
        <ReviewCheckbox
          reviewed={route.reviewed}
          label={`${route.departure} ${route.destination}`}
          isBusy={isBusy}
          onChange={onReview}
        />
      </td>
      {/*
        One action, where there were two. Editing is the row itself now, so the
        column holds only what a row cannot do to itself: go away.
      */}
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={onDelete}
          aria-label={`${t("settings.pricing.routes.delete")} ${route.departure} ${route.destination}`}
          className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {t("settings.pricing.routes.delete")}
        </button>
      </td>
    </tr>
  );
}
