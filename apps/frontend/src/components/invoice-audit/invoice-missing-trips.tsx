"use client";

import Link from "next/link";

import type { InvoiceAuditResult } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The finished transports the invoice never mentioned.
 *
 * ── WHY THEY ARE NOT A PROBLEM ──────────────────────────────────────────────
 * A line the check could not resolve is highlighted, because somebody has to
 * look at it. These are the opposite: transports this system finished, nobody
 * has paid for, and the customer simply did not bill. The corrected workbook
 * adds them as ordinary lines, so they are listed plainly — with the row each
 * one takes, so an operator can find it in the file they download.
 */
export function InvoiceMissingTrips({
  result,
}: {
  result: InvoiceAuditResult;
}) {
  const t = useTranslation();

  if (result.missingTrips.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border px-5 py-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t("invoiceAudit.missing.title")}{" "}
        <span className="tabular-nums text-secondary">
          {result.missingTrips.length}
        </span>
      </h3>
      <p className="mt-1 text-xs text-muted">
        {t("invoiceAudit.missing.description")}
      </p>

      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {result.missingTrips.map((missing) => (
          <li
            key={missing.tripId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="tabular-nums text-muted">
              {t("invoiceAudit.column.row")} {missing.rowNumber}
            </span>
            <Link
              href={`/trips/${missing.tripId}`}
              className="font-medium text-primary hover:underline"
            >
              {missing.bookingNumber ?? missing.tripId}
            </Link>
            <span className="text-secondary">{missing.containerNumber}</span>
            <span className="tabular-nums text-secondary">
              {missing.planningDate}
            </span>
            <span className="text-secondary">{missing.route}</span>
            <span className="ml-auto tabular-nums font-medium text-foreground">
              {missing.totaal === null ? "—" : `€${missing.totaal}`}
            </span>
            <span className="text-xs text-success">
              {t("invoiceAudit.missing.added")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
