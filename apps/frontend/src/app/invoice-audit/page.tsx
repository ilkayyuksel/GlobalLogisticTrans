"use client";

import { useState } from "react";

import { InvoiceApply } from "@/components/invoice-audit/invoice-apply";
import { InvoiceAuditRows } from "@/components/invoice-audit/invoice-audit-rows";
import { InvoiceAuditSummary } from "@/components/invoice-audit/invoice-audit-summary";
import { InvoiceMissingTrips } from "@/components/invoice-audit/invoice-missing-trips";
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
 * ── TWO STEPS, AND THE FIRST ONE IS FREE ────────────────────────────────────
 * Uploading CHECKS: it shows, per line, whether this system holds a finished
 * transport for it and what the prices should be, and it changes nothing at
 * all. Processing is a second, deliberate action — it corrects the document,
 * adds the transports the invoice forgot, marks the unresolved lines, saves the
 * file and settles the transports the invoice covers.
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
              <InvoiceAuditRows rows={result.rows} />
            ) : (
              <EmptyState
                title={t("invoiceAudit.empty.title")}
                description={t("invoiceAudit.empty.description")}
              />
            )}
            <InvoiceMissingTrips result={result} />
            {checked ? (
              <InvoiceApply
                file={checked.file}
                result={result}
                applied={applied}
                onApplied={setApplied}
              />
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
