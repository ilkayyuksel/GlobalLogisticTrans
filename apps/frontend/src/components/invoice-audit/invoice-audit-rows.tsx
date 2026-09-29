"use client";

import Link from "next/link";

import { InvoicePricingCell } from "@/components/invoice-audit/invoice-pricing-cell";
import type {
  InvoiceAuditRow,
  InvoiceRowStatus,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * How each answer reads, and what it looks like.
 *
 * ── THE THREE PROBLEMS SHARE ONE COLOUR ─────────────────────────────────────
 * NOT_FOUND, NOT_FINISHED and AMBIGUOUS are the rows an operator has to do
 * something about, and they are the rows that will be marked in the corrected
 * workbook later. Giving them one highlight here — and the same highlight —
 * means the screen and the returned file will show the same set.
 */
const STATUS_STYLE: Record<
  InvoiceRowStatus,
  {
    readonly labelKey: TranslationKey;
    readonly row: string;
    readonly badge: string;
  }
> = {
  MATCHED: {
    labelKey: "invoiceAudit.status.matched",
    row: "",
    badge: "border-success/40 bg-success/10 text-success",
  },
  NOT_FOUND: {
    labelKey: "invoiceAudit.status.notFound",
    row: "bg-[#fdfd66]/40",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  NOT_FINISHED: {
    labelKey: "invoiceAudit.status.notFinished",
    row: "bg-[#fdfd66]/40",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  AMBIGUOUS: {
    labelKey: "invoiceAudit.status.ambiguous",
    row: "bg-[#fdfd66]/40",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  /*
   * A line this check wrote into the document because the invoice had forgotten
   * the transport. Not a problem and never highlighted: its prices are checked
   * like any other line's, and it is simply never settled.
   */
  ADDED_MISSING: {
    labelKey: "invoiceAudit.status.addedMissing",
    row: "",
    badge: "border-primary/40 bg-primary/10 text-primary",
  },
};

/**
 * Every line of the invoice, with what became of it.
 *
 * The Excel ROW NUMBER is the first column on purpose: it is how an operator
 * finds the line in their own file, and it is the coordinate the corrected
 * workbook will be written into.
 */
export function InvoiceAuditRows({
  rows,
}: {
  rows: readonly InvoiceAuditRow[];
}) {
  const t = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-hover/40 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.row")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.status")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.planningDate")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.booking")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.container")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.trip")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("invoiceAudit.column.pricing")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InvoiceAuditRowLine key={row.rowNumber} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceAuditRowLine({ row }: { row: InvoiceAuditRow }) {
  const t = useTranslation();
  const style = STATUS_STYLE[row.status];

  return (
    <tr className={`border-b border-border last:border-0 ${style.row}`}>
      <td className="px-3 py-2 tabular-nums text-muted">{row.rowNumber}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${style.badge}`}
        >
          {t(style.labelKey)}
        </span>
      </td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        {row.planningDate}
      </td>
      <td className="px-3 py-2 font-medium text-foreground">
        {row.bookingNumber}
      </td>
      <td className="px-3 py-2 text-secondary">
        {row.containerNumber}
        {/*
          A line that shares its three values with another row of the same
          document: one transport, several charges. Said plainly, because it is
          the reason two rows can point at one Trip without either being wrong.
        */}
        {row.sharedKeyRowNumbers.length > 0 ? (
          <span className="ml-2 text-xs text-muted">
            {t("invoiceAudit.sharedKey")} {row.sharedKeyRowNumbers.join(", ")}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <TripCell row={row} />
      </td>
      <td className="px-3 py-2 align-top">
        <InvoicePricingCell row={row} />
      </td>
    </tr>
  );
}

/** What was found on our side, in the words the answer calls for. */
function TripCell({ row }: { row: InvoiceAuditRow }) {
  const t = useTranslation();

  if (row.trip) {
    return (
      <Link
        href={`/trips/${row.trip.id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.trip.bookingNumber ?? row.trip.id}
        <span className="ml-2 text-xs text-muted">{row.trip.status}</span>
      </Link>
    );
  }

  if (row.status === "NOT_FINISHED") {
    return (
      <span className="text-xs text-secondary">
        {row.candidates
          .map(
            (candidate) =>
              `${candidate.bookingNumber ?? candidate.id} · ${candidate.status}`,
          )
          .join(", ")}
      </span>
    );
  }

  if (row.status === "AMBIGUOUS") {
    return (
      <span className="text-xs text-secondary">
        {t("invoiceAudit.ambiguousDetail")} {row.candidates.length}
      </span>
    );
  }

  return <span className="text-xs text-muted">{t("invoiceAudit.noTrip")}</span>;
}
