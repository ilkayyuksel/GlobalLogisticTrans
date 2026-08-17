"use client";

import { useCallback } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { WidgetLink } from "@/components/dashboard/widget-link";
import { useAsync } from "@/hooks/use-async";
import { listMaintenance } from "@/lib/api/maintenance";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";

/** Enough to act on this morning; the full list is one click away. */
const WARNING_LIMIT = 5;

/**
 * Maintenance that has fallen due.
 *
 * ── ONE REASON, AND IT IS HONEST ────────────────────────────────────────────
 * Every warning here means the same thing: a PLANNED NEXT DATE has arrived.
 * The backend decides it (`dueOnly`), so the rule lives in one place.
 *
 * There is deliberately no mileage warning. A planned next mileage is stored,
 * but deciding it has been reached needs the vehicle's CURRENT odometer
 * reading — and this system has none, by design in V1. Comparing it against the
 * mileage recorded at the last service would answer a different question and
 * produce warnings that are simply wrong. The footnote says so rather than
 * leaving the absence to be discovered.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function MaintenanceWarnings() {
  const t = useTranslation();

  const warnings = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listMaintenance({ dueOnly: true, pageSize: WARNING_LIMIT }, signal),
      [],
    ),
    [],
  );

  return (
    <Card>
      <CardHeader title={t("maintenance.due.title")} />

      {warnings.isLoading ? <LoadingState label={t("maintenance.loading")} /> : null}

      {!warnings.isLoading && warnings.error ? (
        <ErrorState error={warnings.error} onRetry={warnings.reload} />
      ) : null}

      {!warnings.isLoading && !warnings.error && warnings.data?.items.length === 0 ? (
        <EmptyState title={t("maintenance.due.none")} />
      ) : null}

      {!warnings.isLoading && !warnings.error && warnings.data?.items.length ? (
        <ul className="divide-y divide-border">
          {warnings.data.items.map((record) => (
            <li key={record.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {record.vehicle
                    ? record.vehicle.licensePlate
                    : t("maintenance.value.empty")}
                </span>
                <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-semibold text-warning">
                  {t("maintenance.due.reasonDate")}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-secondary">
                {maintenanceTypeLabel(record.maintenanceType, t) ??
                  record.description}{" "}
                ·{" "}
                {t("maintenance.due.plannedFor")}{" "}
                <span className="tabular-nums">
                  {formatCalendarDate(record.nextMaintenanceDate)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <CardBody className="border-t border-border">
        <p className="text-[11px] text-muted">
          {t("maintenance.due.mileageUnknown")}
        </p>
        <p className="mt-2">
          <WidgetLink href="/maintenance" labelKey="maintenance.due.link" />
        </p>
      </CardBody>
    </Card>
  );
}
