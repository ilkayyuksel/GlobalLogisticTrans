"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { PricingSnapshot, TripStatus } from "@/lib/api/types";

/**
 * The stored pricing of a Trip.
 *
 * THIS COMPONENT PERFORMS NO ARITHMETIC. Every amount — each line and the total
 * — is rendered exactly as the backend sent it, as a preformatted string. The
 * total is the stored total, never the sum of the lines shown: if the two ever
 * disagreed, showing a locally computed figure would hide a real problem behind
 * a number that looks right.
 *
 * Lines are displayed in `calculationOrder`, which is the sequence the Pricing
 * Engine applied them in and the only order in which a breakdown reads
 * correctly.
 */
export function PricingPanel({
  snapshot,
  tripStatus,
  isReprocessing,
  onReprocess,
  reprocessError,
}: {
  snapshot: PricingSnapshot | null;
  tripStatus: TripStatus;
  isReprocessing: boolean;
  onReprocess: () => void;
  reprocessError: string | null;
}) {
  const t = useTranslation();

  // The backend refuses to price anything that is not CLOSED, so offering the
  // action otherwise would produce a guaranteed error.
  const canReprocess = tripStatus === "CLOSED";

  return (
    <Card>
      <CardHeader
        title={t("pricing.title")}
        description={
          snapshot
            ? `${t("pricing.calculatedAt")} ${formatTimestamp(snapshot.pricing.calculatedAt)}`
            : t("pricing.noneCalculated")
        }
        action={
          <ReprocessButton
            canReprocess={canReprocess}
            isReprocessing={isReprocessing}
            onReprocess={onReprocess}
          />
        }
      />

      {reprocessError ? (
        <p role="alert" className="px-5 pt-4 text-sm font-medium text-danger">
          {reprocessError}
        </p>
      ) : null}

      {snapshot ? (
        <PricingBreakdown snapshot={snapshot} />
      ) : canReprocess ? (
        <PricingNeedsAttention />
      ) : (
        <EmptyState
          title={t("pricing.notPricedTitle")}
          description={t("pricing.notPricedDescription")}
        />
      )}
    </Card>
  );
}

/**
 * A CLOSED Trip with no pricing.
 *
 * Automatic pricing runs when a Trip closes and CLOSED is terminal, so this
 * means the calculation did not produce a snapshot — most often because
 * configuration is missing, such as a route cost for this terminal and
 * destination. It is recoverable, and Reprocess is the recovery.
 *
 * Deliberately NOT presented as a way to reopen the Trip: the status is
 * correct, only the pricing is absent.
 */
function PricingNeedsAttention() {
  const t = useTranslation();

  return (
    <div
      role="status"
      className="border-t border-warning/30 bg-warning/5 px-5 py-6"
    >
      <p className="text-sm font-medium text-foreground">
        {t("pricing.attentionTitle")}
      </p>
      <p className="mt-1 max-w-2xl text-sm text-secondary">
        {t("pricing.attentionWhy")}
      </p>
      <p className="mt-2 max-w-2xl text-sm text-secondary">
        {t("pricing.attentionWhatToDo")}
      </p>
    </div>
  );
}

function ReprocessButton({
  canReprocess,
  isReprocessing,
  onReprocess,
}: {
  canReprocess: boolean;
  isReprocessing: boolean;
  onReprocess: () => void;
}) {
  const t = useTranslation();

  return (
    <button
      type="button"
      onClick={onReprocess}
      disabled={!canReprocess || isReprocessing}
      title={canReprocess ? undefined : t("pricing.reprocessUnavailable")}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isReprocessing ? <Spinner label={t("pricing.reprocessing")} /> : null}
      {isReprocessing ? t("pricing.reprocessing") : t("pricing.reprocess")}
    </button>
  );
}

function PricingBreakdown({ snapshot }: { snapshot: PricingSnapshot }) {
  const t = useTranslation();
  const { pricing, items } = snapshot;

  // Sorted defensively: the backend already returns calculation order, and
  // sorting by the same key cannot change a correct response.
  const orderedItems = [...items].sort(
    (left, right) => left.calculationOrder - right.calculationOrder,
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 text-xs text-muted">
        <Badge tone={pricing.calculationStatus === "FAILED" ? "danger" : "success"}>
          {pricing.calculationStatus}
        </Badge>
        <span>
          {t("pricing.engine")} {pricing.pricingEngineVersion}
        </span>
        <span>·</span>
        <span>
          {t("pricing.rules")} {pricing.pricingRuleVersion}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">{t("pricing.breakdown")}</caption>
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-5 py-2 font-medium">
                #
              </th>
              <th scope="col" className="px-5 py-2 font-medium">
                {t("pricing.column.description")}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                {t("pricing.column.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.map((item) => (
              <tr key={item.id} className="border-b border-border">
                <td className="px-5 py-2 text-muted">{item.calculationOrder}</td>
                <td className="px-5 py-2 text-foreground">
                  {item.description}
                  {item.quantity && item.unitPrice ? (
                    <span className="ml-2 text-xs text-muted">
                      {item.quantity} × {item.unitPrice} {item.currency}
                    </span>
                  ) : null}
                </td>
                {/*
                  Rendered verbatim — the backend formatted it to two decimals.
                  Built as one string rather than two children so the amount and
                  its currency are a single text node, which is how a reader
                  sees them.
                */}
                <td className="px-5 py-2 text-right tabular-nums text-foreground">
                  {`${item.amount} ${item.currency}`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="px-5 py-3 text-right font-semibold text-foreground">
                {t("pricing.total")}
              </td>
              {/* The STORED total, not the sum of the rows above. */}
              <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-foreground">
                {`${pricing.totalPrice} ${pricing.currency}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {pricing.notes ? (
        <p className="px-5 pb-4 text-sm text-secondary">{pricing.notes}</p>
      ) : null}
    </>
  );
}

/** Locale-independent so a server and a browser render the same string. */
function formatTimestamp(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}
