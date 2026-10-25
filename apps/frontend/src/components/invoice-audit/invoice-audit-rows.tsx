"use client";

import Link from "next/link";

import { InvoicePricingCell } from "@/components/invoice-audit/invoice-pricing-cell";
import {
  ContainerCorrectionNote,
  InvoiceRowNotes,
} from "@/components/invoice-audit/invoice-row-notes";
import type { InvoiceAuditRow, InvoiceRowStatus } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/** How each answer reads, and what its badge looks like. */
const STATUS_STYLE: Record<
  InvoiceRowStatus,
  {
    readonly labelKey: TranslationKey;
    readonly badge: string;
  }
> = {
  MATCHED: {
    labelKey: "invoiceAudit.status.matched",
    badge: "border-success/40 bg-success/10 text-success",
  },
  NOT_FOUND: {
    labelKey: "invoiceAudit.status.notFound",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  NOT_FINISHED: {
    labelKey: "invoiceAudit.status.notFinished",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  AMBIGUOUS: {
    labelKey: "invoiceAudit.status.ambiguous",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  CONFLICT: {
    labelKey: "invoiceAudit.status.conflict",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  /* A Cost Confirmation line, resolved: priced against its own confirmation. */
  COST_LINE: {
    labelKey: "invoiceAudit.status.costLine",
    badge: "border-border bg-hover text-secondary",
  },
  COST_LINE_UNRESOLVED: {
    labelKey: "invoiceAudit.status.costLineUnresolved",
    badge: "border-danger/40 bg-danger/10 text-danger",
  },
  /*
   * A line this check wrote into the document because the invoice had forgotten
   * the transport: its prices are checked like any other line's, and it is
   * simply never settled.
   */
  ADDED_MISSING: {
    labelKey: "invoiceAudit.status.addedMissing",
    badge: "border-primary/40 bg-primary/10 text-primary",
  },
};

/** The highlight of a row the corrected workbook marks yellow. */
const MARKED_ROW = "bg-[#fdfd66]/40";

/**
 * Every line of the invoice, with what became of it.
 *
 * The Excel ROW NUMBER is the first column on purpose: it is how an operator
 * finds the line in their own file, and it is the coordinate the corrected
 * workbook will be written into.
 *
 * Which rows are yellow is the backend's answer (`markedRowNumbers`), so the
 * screen highlights exactly the rows the corrected file marks.
 */
export function InvoiceAuditRows({
  rows,
  markedRowNumbers,
}: {
  rows: readonly InvoiceAuditRow[];
  markedRowNumbers: readonly number[];
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
            <InvoiceAuditRowLine
              key={row.rowNumber}
              row={row}
              marked={markedRowNumbers.includes(row.rowNumber)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceAuditRowLine({ row, marked }: { row: InvoiceAuditRow; marked: boolean }) {
  const t = useTranslation();
  const style = STATUS_STYLE[row.status];

  return (
    <tr className={`border-b border-border last:border-0 ${marked ? MARKED_ROW : ""}`}>
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
        {row.dateCorrection ? (
          <span
            className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning"
            title={`${t("invoiceAudit.dateCorrected.detail")} ${row.dateCorrection.invoicePlanningDate} → ${row.dateCorrection.tripPlanningDate}`}
          >
            <span aria-hidden="true">⚠</span>
            {t("invoiceAudit.dateCorrected")} → {row.dateCorrection.tripPlanningDate}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 font-medium text-foreground">
        {row.bookingNumber}
        {/* The matched transport's route, as the backend states it; none without a match. */}
        {row.route ? <div className="text-xs font-normal text-muted">{row.route}</div> : null}
      </td>
      <td className="px-3 py-2 text-secondary">
        {row.containerNumber}
        {/*
          A line that shares its three values with another row of the same
          document: one transport, several charges. Said plainly, because it is
          the reason two rows can point at one Trip without either being wrong.
        */}
        {row.containerCorrection ? (
          <ContainerCorrectionNote correction={row.containerCorrection} />
        ) : null}
        {row.sharedKeyRowNumbers.length > 0 ? (
          <span className="ml-2 text-xs text-muted">
            {t("invoiceAudit.sharedKey")} {row.sharedKeyRowNumbers.join(", ")}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <TripCell row={row} />
        <InvoiceRowNotes row={row} />
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
