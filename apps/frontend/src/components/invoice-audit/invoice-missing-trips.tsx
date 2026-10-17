"use client";

import Link from "next/link";

import type { InvoiceAuditResult, MissingTrip } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

import { InvoicePriceReliabilityNote } from "./invoice-price-reliability";

/**
 * The finished transports the invoice never mentioned.
 *
 * ── WHY THEY ARE NOT A PROBLEM ──────────────────────────────────────────────
 * A line the check could not resolve is highlighted, because somebody has to
 * look at it. These are the opposite: transports this system finished, nobody
 * has paid for, and the customer simply did not bill. The corrected workbook
 * adds them as ordinary lines, so they are listed plainly — with the row each
 * one takes, so an operator can find it in the file they download.
 *
 * The backend decides everything shown here: the row (none when the document's
 * totals cannot take a line), the Remarks, the `COMBINATION` marker, and
 * whether the price is relied on. A line whose price is not is still added —
 * without amounts, in yellow — and the reason is shown beside it.
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
          <MissingTripItem key={missing.tripId} missing={missing} />
        ))}
      </ul>
    </div>
  );
}

function MissingTripItem({ missing }: { missing: MissingTrip }) {
  const t = useTranslation();
  const reliable = missing.priceReliability.reliable;

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular-nums text-muted">
          {missing.rowNumber === null
            ? "—"
            : `${t("invoiceAudit.column.row")} ${missing.rowNumber}`}
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
        {missing.combinationEnd ? (
          <span className="text-xs text-secondary">COMBINATION</span>
        ) : null}
        <span className="ml-auto tabular-nums font-medium text-foreground">
          {missing.totaal === null || !reliable ? "—" : `€${missing.totaal}`}
        </span>
        <MissingTripOutcome missing={missing} />
      </div>
      {missing.remarks ? (
        <p className="mt-1 text-xs text-secondary">
          {t("invoiceAudit.missing.remarks")} {missing.remarks}
        </p>
      ) : null}
      {missing.remarkNotes.map((note) => (
        <p key={note} className="mt-1 text-xs text-warning">
          {note}
        </p>
      ))}
      {reliable ? null : (
        <div className="mt-1">
          <InvoicePriceReliabilityNote reliability={missing.priceReliability} />
        </div>
      )}
    </li>
  );
}

/** What happens to the transport in the corrected file. */
function MissingTripOutcome({ missing }: { missing: MissingTrip }) {
  const t = useTranslation();

  if (missing.rowNumber === null) {
    return (
      <span className="text-xs text-warning">
        {t("invoiceAudit.missing.notAdded")}
      </span>
    );
  }

  return missing.priceReliability.reliable ? (
    <span className="text-xs text-success">{t("invoiceAudit.missing.added")}</span>
  ) : (
    <span className="text-xs text-warning">
      {t("invoiceAudit.missing.addedForReview")}
    </span>
  );
}
