"use client";

import type { PaginationMeta } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Server-side paging, stated plainly.
 *
 * Only one page is ever in memory, so the summary always names the range AND
 * the total: a week or a month that does not fit on one page must never read as
 * though the sections below it are the whole period.
 */
export function RittenPagination({
  meta,
  onChange,
}: {
  meta: PaginationMeta;
  onChange: (page: number) => void;
}) {
  const t = useTranslation();

  if (meta.totalPages <= 1) {
    return null;
  }

  const firstRow = (meta.page - 1) * meta.pageSize + 1;
  const lastRow = Math.min(meta.page * meta.pageSize, meta.totalItems);

  return (
    <nav
      aria-label={t("ritten.pagination.page")}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
    >
      <button
        type="button"
        onClick={() => onChange(meta.page - 1)}
        disabled={meta.page <= 1}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.nav.previous")}
      </button>

      <span className="text-secondary">
        {t("ritten.pagination.showing")} {firstRow}–{lastRow}{" "}
        {t("ritten.pagination.of")} {meta.totalItems} ·{" "}
        {t("ritten.pagination.page")} {meta.page} {t("ritten.pagination.of")}{" "}
        {meta.totalPages}
      </span>

      <button
        type="button"
        onClick={() => onChange(meta.page + 1)}
        disabled={meta.page >= meta.totalPages}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.nav.next")}
      </button>
    </nav>
  );
}
