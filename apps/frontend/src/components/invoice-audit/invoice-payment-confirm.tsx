"use client";

import { useState } from "react";

import { errorDetailsOf, userFacingMessage } from "@/lib/api/client";
import {
  confirmInvoicePayment,
  type InvoiceAuditResult,
  type InvoicePaymentResult,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

import { InvoicePaymentList } from "./invoice-payment-list";

/**
 * The third and last step: the operator confirms which transports are paid.
 *
 * ── A DECISION OF ITS OWN ───────────────────────────────────────────────────
 * Neither the check nor the corrected file pays anything. Here the operator
 * sees what the backend found payable — grouped, with a higher invoice price
 * apart — chooses, and confirms. The original file goes up again with the
 * choice, so the backend decides on the document and not on this screen; if a
 * chosen transport is no longer payable, nothing is paid and the reason shows.
 *
 * Every payable transport not yet paid is chosen to begin with: they are the
 * ones the check found settled. The button is disabled while the request runs,
 * so a double click cannot confirm twice.
 */
export function InvoicePaymentConfirm({
  file,
  result,
}: {
  file: File;
  result: InvoiceAuditResult;
}) {
  const t = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        result.payments
          .filter((payment) => payment.payable && !payment.alreadyPaid)
          .map((payment) => payment.tripId),
      ),
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [outcome, setOutcome] = useState<InvoicePaymentResult | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  function toggle(tripId: string): void {
    setSelected((current) => {
      const next = new Set(current);

      if (!next.delete(tripId)) {
        next.add(tripId);
      }

      return next;
    });
  }

  async function confirm(): Promise<void> {
    if (isConfirming || selected.size === 0) {
      return;
    }

    setIsConfirming(true);
    setError(null);

    try {
      setOutcome(await confirmInvoicePayment(file, [...selected]));
    } catch (failure: unknown) {
      setError({ message: userFacingMessage(failure), details: errorDetailsOf(failure) });
    } finally {
      setIsConfirming(false);
    }
  }

  if (result.payments.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border px-5 py-4">
      <h3 className="text-sm font-semibold text-foreground">{t("invoiceAudit.payment.title")}</h3>
      <p className="mt-1 text-xs text-muted">{t("invoiceAudit.payment.description")}</p>

      {outcome ? (
        <p role="status" className="mt-3 text-sm font-medium text-success">
          {t("invoiceAudit.payment.done")} {outcome.paidTrips}
          {outcome.alreadyPaid > 0
            ? ` · ${t("invoiceAudit.payment.doneAlreadyPaid")} ${outcome.alreadyPaid}`
            : ""}
        </p>
      ) : (
        <>
          <InvoicePaymentList
            payments={result.payments}
            selected={selected}
            onToggle={toggle}
            disabled={isConfirming}
          />
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isConfirming || selected.size === 0}
            className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConfirming
              ? t("invoiceAudit.payment.working")
              : `${t("invoiceAudit.payment.action")} (${selected.size})`}
          </button>
        </>
      )}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
        >
          <p>{error.message}</p>
          {error.details.map((detail) => (
            <p key={detail} className="text-xs text-secondary">
              {detail}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
