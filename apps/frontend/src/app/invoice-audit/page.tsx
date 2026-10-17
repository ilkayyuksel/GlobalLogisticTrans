"use client";

import { useState } from "react";

import { InvoiceApply } from "@/components/invoice-audit/invoice-apply";
import { InvoiceAuditRows } from "@/components/invoice-audit/invoice-audit-rows";
import { InvoiceAuditSummary } from "@/components/invoice-audit/invoice-audit-summary";
import { InvoiceBlockedTrips } from "@/components/invoice-audit/invoice-blocked-trips";
import { InvoiceDocumentChecks } from "@/components/invoice-audit/invoice-document-checks";
import { InvoiceMissingTrips } from "@/components/invoice-audit/invoice-missing-trips";
import { InvoicePaymentConfirm } from "@/components/invoice-audit/invoice-payment-confirm";
import { InvoiceTotals } from "@/components/invoice-audit/invoice-totals";
import { InvoiceUpload } from "@/components/invoice-audit/invoice-upload";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import type {
  AppliedInvoiceAudit,
  InvoiceAuditResult,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Excel factuurcontrole — checking a customer's weekly invoice, and settling it.
 *
 * ── THREE STEPS, AND ONLY THE LAST ONE PAYS ─────────────────────────────────
 * Uploading CHECKS: a preview of the corrected document, the totals before and
 * after, and which transports may be settled — nothing changes. Processing
 * produces the corrected file — still nothing changes in the system. Only the
 * separate payment confirmation marks the chosen transports paid.
 *
 * ── THE RESULT LIVES ONLY HERE ──────────────────────────────────────────────
 * Nothing is stored: no audit history, no upload record. Reloading the page
 * empties it, and checking the same file again produces the same answer, which
 * is what makes the invoice itself the record rather than a copy of it.
 */
export default function InvoiceAuditPage() {
  const t = useTranslation();
  const [checked, setChecked] = useState<{
    result: InvoiceAuditResult;
    file: File;
  } | null>(null);
  const [applied, setApplied] = useState<AppliedInvoiceAudit | null>(null);
  const result = checked?.result ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("invoiceAudit.title")}
          description={t("invoiceAudit.description")}
        />
        <InvoiceUpload
          onChecked={(next) => {
            setChecked(next);
            // A new check is about another reading: what a previous run did is
            // no longer what this screen is showing.
            setApplied(null);
          }}
        />
      </Card>

      <Card>
        {result ? (
          <>
            <InvoiceAuditSummary result={result} />
            {result.rows.length > 0 ? (
              <InvoiceAuditRows rows={result.rows} markedRowNumbers={result.markedRowNumbers} />
            ) : (
              <EmptyState
                title={t("invoiceAudit.empty.title")}
                description={t("invoiceAudit.empty.description")}
              />
            )}
            <InvoiceDocumentChecks result={result} />
            <InvoiceMissingTrips result={result} />
            <InvoiceBlockedTrips result={result} />
            <InvoiceTotals result={result} />
            {checked ? (
              <InvoiceApply
                file={checked.file}
                result={result}
                applied={applied}
                onApplied={setApplied}
              />
            ) : null}
            {/*
              Offered once the corrected file exists: the operator first reads
              the preview, then the file, and only then decides about payment.
            */}
            {checked && applied ? (
              <InvoicePaymentConfirm file={checked.file} result={result} />
            ) : null}
          </>
        ) : (
          <EmptyState
            title={t("invoiceAudit.nothing.title")}
            description={t("invoiceAudit.nothing.description")}
          />
        )}
      </Card>
    </div>
  );
}
