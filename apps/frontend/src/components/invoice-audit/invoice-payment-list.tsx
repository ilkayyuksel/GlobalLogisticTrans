"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type {
  InvoiceNotPayableReason,
  InvoicePaymentCategory,
  InvoiceTripPayment,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/** The order the payable groups are shown in; a higher invoice stands apart, last. */
const CATEGORIES: readonly InvoicePaymentCategory[] = ["UNCHANGED", "RAISED", "ADDED", "INVOICE_HIGHER"];

/**
 * The transports the invoice charges, grouped by the backend's own answer.
 *
 * Only payable, not yet paid transports can be chosen. Already paid ones are
 * listed as re-invoiced, and the ones that cannot be settled with their
 * reasons — the screen decides none of it.
 */
export function InvoicePaymentList({
  payments,
  selected,
  onToggle,
  disabled,
}: {
  payments: readonly InvoiceTripPayment[];
  selected: ReadonlySet<string>;
  onToggle: (tripId: string) => void;
  disabled: boolean;
}) {
  const t = useTranslation();
  const choosable = payments.filter((payment) => payment.payable && !payment.alreadyPaid);
  const alreadyPaid = payments.filter((payment) => payment.payable && payment.alreadyPaid);
  const notPayable = payments.filter((payment) => !payment.payable);

  return (
    <div className="mt-3 space-y-3">
      {CATEGORIES.map((category) => {
        const group = choosable.filter((payment) => payment.category === category);

        return group.length === 0 ? null : (
          <PaymentGroup key={category} title={t(`invoiceAudit.payment.category.${category}`)} count={group.length}>
            {group.map((payment) => (
              <li key={payment.tripId} className="px-3 py-1.5">
                <label className="flex items-baseline gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(payment.tripId)}
                    onChange={() => onToggle(payment.tripId)}
                    disabled={disabled}
                  />
                  <TripLabel payment={payment} />
                </label>
              </li>
            ))}
          </PaymentGroup>
        );
      })}
      {alreadyPaid.length > 0 ? (
        <PaymentGroup title={t("invoiceAudit.payment.alreadyPaid")} count={alreadyPaid.length}>
          {alreadyPaid.map((payment) => (
            <li key={payment.tripId} className="px-3 py-1.5">
              <TripLabel payment={payment} />
            </li>
          ))}
        </PaymentGroup>
      ) : null}
      {notPayable.length > 0 ? (
        <PaymentGroup title={t("invoiceAudit.payment.notPayable")} count={notPayable.length}>
          {notPayable.map((payment) => (
            <li key={payment.tripId} className="px-3 py-1.5">
              <TripLabel payment={payment} />
              <NotPayableExplanation payment={payment} />
            </li>
          ))}
        </PaymentGroup>
      ) : null}
    </div>
  );
}

/**
 * Why a transport is not offered, the rows to fix and what to do — one reason
 * per line, each with its own action, as the backend decided them.
 */
function NotPayableExplanation({ payment }: { payment: InvoiceTripPayment }) {
  const t = useTranslation();
  // Older answers carry no rows.
  const rows = payment.blockingRowNumbers ?? [];

  return (
    <ul className="mt-0.5 space-y-0.5 text-xs">
      {payment.reasons.map((reason) => (
        <li key={reason}>
          <span className="text-warning">{t(`invoiceAudit.payment.reason.${reason}` as TranslationKey)}</span>
          {rows.length > 0 && ROW_REASONS.includes(reason) ? (
            <span className="text-warning">
              {" "}
              ({t("invoiceAudit.column.row")} {rows.join(", ")})
            </span>
          ) : null}
          <span className="text-secondary"> — {t(`invoiceAudit.payment.fix.${reason}` as TranslationKey)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The reasons whose rows are the ones to fix. */
const ROW_REASONS: readonly InvoiceNotPayableReason[] = [
  "AMBIGUOUS_MATCH",
  "MATCH_CONFLICT",
  "BLOCKED_BY_UNRESOLVED_LINE",
  "NOT_CLOSED",
];

function PaymentGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title} <span className="tabular-nums">{count}</span>
      </h4>
      <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">{children}</ul>
    </section>
  );
}

function TripLabel({ payment }: { payment: InvoiceTripPayment }) {
  const t = useTranslation();

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3">
      <Link href={`/trips/${payment.tripId}`} className="font-medium text-primary hover:underline">
        {payment.bookingNumber ?? payment.tripId}
      </Link>
      <span className="text-secondary">{payment.containerNumber}</span>
      <span className="tabular-nums text-secondary">{payment.planningDate}</span>
      <span className="tabular-nums text-muted">
        {t("invoiceAudit.column.row")} {payment.rowNumbers.join(", ")}
      </span>
    </span>
  );
}
