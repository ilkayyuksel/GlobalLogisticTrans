"use client";

import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The Routeprijzen table's column headings: selection, the five values, the
 * review tick and the actions. Ordinary routes and Combination legs share them.
 */
export function RouteTableHead() {
  const t = useTranslation();

  return (
    <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
      <tr>
        <th scope="col" className="w-px px-3 py-2 font-medium">
          <span className="sr-only">
            {t("settings.pricing.routes.select")}
          </span>
        </th>
        <th scope="col" className="px-3 py-2 font-medium">
          {t("settings.pricing.routes.from")}
        </th>
        <th scope="col" className="px-3 py-2 font-medium">
          {t("settings.pricing.routes.to")}
        </th>
        <th scope="col" className="px-3 py-2 text-right font-medium">
          {t("settings.pricing.routes.tarief")}
        </th>
        <th scope="col" className="px-3 py-2 text-right font-medium">
          {t("settings.pricing.routes.kilometres")}
        </th>
        <th scope="col" className="px-3 py-2 text-right font-medium">
          {t("settings.pricing.routes.tunnel")}
        </th>
        {/*
          As narrow as a column can be: a tick needs a checkbox's width
          and no more, so `w-px` lets the values keep the table.
        */}
        <th scope="col" className="w-px px-3 py-2 font-medium">
          <span aria-hidden="true">✓</span>
          <span className="sr-only">
            {t("settings.pricing.routes.reviewed")}
          </span>
        </th>
        <th scope="col" className="px-3 py-2 font-medium">
          {t("settings.pricing.routes.actions")}
        </th>
      </tr>
    </thead>
  );
}
