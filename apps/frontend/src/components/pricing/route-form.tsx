"use client";

import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { RouteDraft } from "@/lib/pricing/route-draft";

/**
 * The add / edit row for an ordinary route.
 *
 * Van and Naar are free TEXT. There is no terminal master data in this system
 * and no city list, so a dropdown could only ever offer a guess — the operator
 * types what the route is, and the backend matches a terminal canonically.
 */
export function RouteForm({
  draft,
  isBusy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: RouteDraft;
  isBusy: boolean;
  onChange: (draft: RouteDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();

  const amountInput = (
    field: "tarief" | "toll" | "tunnel",
    labelKey: TranslationKey,
  ) => (
    <td className="px-3 py-2">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label={t(labelKey)}
        value={draft[field]}
        onChange={(event) =>
          onChange({ ...draft, [field]: event.target.value })
        }
        className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-sm text-foreground"
      />
    </td>
  );

  return (
    <tr className="border-b border-border bg-hover/40 last:border-0">
      {/* The selection column: a route being typed is not yet a record. */}
      <td className="px-3 py-2" />
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label={t("settings.pricing.routes.from")}
          value={draft.departure}
          onChange={(event) =>
            onChange({ ...draft, departure: event.target.value })
          }
          className="w-40 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label={t("settings.pricing.routes.to")}
          value={draft.destination}
          onChange={(event) =>
            onChange({ ...draft, destination: event.target.value })
          }
          className="w-40 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </td>
      {amountInput("tarief", "settings.pricing.routes.tarief")}
      {amountInput("toll", "settings.pricing.routes.toll")}
      {amountInput("tunnel", "settings.pricing.routes.tunnel")}
      {/* The Acties column: the form's own two buttons stand in its place. */}
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onSave}
            className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isBusy ? t("settings.pricing.saving") : t("settings.pricing.save")}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.cancel")}
          </button>
        </span>
      </td>
    </tr>
  );
}
