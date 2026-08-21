"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import type { CostConfirmation } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { toCostConfirmationLabel } from "@/lib/trips/cost-confirmation";

/**
 * What Eucon has confirmed it will pay for this Trip.
 *
 * ── READ-ONLY, AND VISIBLY SO ───────────────────────────────────────────────
 * There is no edit control here and no delete, because there is no endpoint for
 * either: the amount is somebody else's statement, and an interface that let an
 * administrator change it would be claiming Eucon said something it did not.
 * The panel says as much in words rather than leaving it to be discovered.
 *
 * It is also NOT the waiting time. The minutes an operator entered live on the
 * Trip and are priced by the configured rule; this is the money confirmed for
 * those minutes. The note below says so, because two numbers about the same
 * delay invite exactly that confusion.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There is exactly ONE, or none. Eucon confirms a Trip's waiting time once, so
 * this is a single value rather than a list — and a second, different
 * confirmation is refused by the backend rather than shown here beside the
 * first.
 */
export function CostConfirmations({
  confirmation,
  onView,
  onDownload,
}: {
  /** Null when Eucon has confirmed nothing for this Trip. */
  confirmation: CostConfirmation | null;
  onView: (pdfDocumentId: string) => void;
  onDownload: (confirmation: CostConfirmation) => void;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader title={t("costConfirmation.title")} />

      {confirmation === null ? (
        <EmptyState title={t("costConfirmation.none")} />
      ) : (
        <div className="border-t border-border">
          <div className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="success">
                  {toCostConfirmationLabel(confirmation)}
                </Badge>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {confirmation.currency} {confirmation.amount}
                </span>
                <span className="text-xs text-muted">
                  {confirmation.costCode}
                </span>
              </span>

              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onView(confirmation.pdfDocumentId)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("costConfirmation.view")}
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(confirmation)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("costConfirmation.download")}
                </button>
              </span>
            </div>

            <p className="mt-0.5 text-xs text-secondary">
              {t("costConfirmation.received")}{" "}
              <time dateTime={confirmation.receivedAt}>
                {new Date(confirmation.receivedAt).toLocaleString()}
              </time>
            </p>
          </div>
        </div>
      )}

      <CardBody>
        <p className="text-[11px] text-muted">
          {t("costConfirmation.readOnly")}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {t("costConfirmation.note")}
        </p>
      </CardBody>
    </Card>
  );
}
