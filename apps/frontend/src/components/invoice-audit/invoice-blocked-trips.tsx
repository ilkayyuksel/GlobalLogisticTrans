"use client";

import Link from "next/link";

import type { InvoiceAuditResult } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Finished transports the invoice does not state that are NOT added.
 *
 * The backend held them back because a line it could not resolve may be that
 * very transport — a typo in a date or a booking. Adding them would put the
 * transport on the invoice twice, so they are listed beside the rows that
 * block them, for a person to decide.
 */
export function InvoiceBlockedTrips({ result }: { result: InvoiceAuditResult }) {
  const t = useTranslation();

  if (result.blockedMissingTrips.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border px-5 py-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t("invoiceAudit.blocked.title")}{" "}
        <span className="tabular-nums text-secondary">{result.blockedMissingTrips.length}</span>
      </h3>
      <p className="mt-1 text-xs text-muted">{t("invoiceAudit.blocked.description")}</p>

      <ul className="mt-3 divide-y divide-border rounded-md border border-warning/40">
        {result.blockedMissingTrips.map((blocked) => (
          <li
            key={blocked.tripId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <Link href={`/trips/${blocked.tripId}`} className="font-medium text-primary hover:underline">
              {blocked.bookingNumber ?? blocked.tripId}
            </Link>
            <span className="text-secondary">{blocked.containerNumber}</span>
            <span className="tabular-nums text-secondary">{blocked.planningDate}</span>
            <span className="ml-auto text-xs text-warning">
              {t("invoiceAudit.column.row")} {blocked.blockingRowNumbers.join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
