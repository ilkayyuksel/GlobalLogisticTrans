"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * One headline figure.
 *
 * `value` is null when the backend cannot supply the number. That renders as an
 * explicit "not available" rather than a zero — a dash is honest, a zero is a
 * claim that there are none.
 */
export function StatCard({
  labelKey,
  value,
  isLoading,
  unavailable = false,
}: {
  labelKey: TranslationKey;
  value: number | string | null;
  isLoading?: boolean;
  unavailable?: boolean;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {t(labelKey)}
        </p>

        {isLoading ? (
          <span className="mt-2 block">
            <Spinner />
          </span>
        ) : unavailable || value === null ? (
          <p className="mt-1 text-sm text-muted">
            {t("dashboard.notAvailable")}
          </p>
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
