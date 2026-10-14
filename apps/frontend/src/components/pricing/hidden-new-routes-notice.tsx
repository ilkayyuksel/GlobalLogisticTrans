"use client";

import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Says that something just added is saved but hidden by the active search or
 * review filter — rather than letting it look as if nothing was saved.
 *
 * The filter is the operator's own and is not cleared behind their back; the
 * button clears it when they ask.
 */
export function HiddenNewRoutesNotice({
  count,
  onShowAll,
}: {
  count: number;
  onShowAll: () => void;
}) {
  const t = useTranslation();

  if (count === 0) {
    return null;
  }

  return (
    <p
      role="status"
      className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-foreground"
    >
      <span>{t("settings.pricing.routes.hiddenNew").replace("{count}", String(count))}</span>
      <button
        type="button"
        onClick={onShowAll}
        className="rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-hover"
      >
        {t("settings.pricing.routes.hiddenNew.showAll")}
      </button>
    </p>
  );
}
