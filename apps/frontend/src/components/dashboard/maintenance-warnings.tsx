"use client";

import Link from "next/link";
import { useCallback } from "react";

import { MaintenanceUrgencyBadge } from "@/components/maintenance/maintenance-badges";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { WidgetLink } from "@/components/dashboard/widget-link";
import { useAsync } from "@/hooks/use-async";
import {
  getMaintenanceAttention,
  type MaintenanceUrgencyLevel,
} from "@/lib/api/maintenance";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/** A left rule per urgency, so TE LAAT reads as the heaviest row at a glance. */
const ROW_ACCENTS: Record<MaintenanceUrgencyLevel, string> = {
  OVERDUE: "border-danger bg-danger/5",
  TODAY: "border-warning",
  UPCOMING: "border-transparent",
};

/**
 * The maintenance the Administrator should look at first.
 *
 * ── THE BACKEND DECIDES ALL OF IT ───────────────────────────────────────────
 * Which records (planned ones only), in which order (overdue from the oldest
 * date, then today, then the next dates) and how many (five): one request,
 * answered by one database query. This widget renders the list as it came and
 * never re-sorts or re-labels it — each row's TE LAAT / VANDAAG / GEPLAND is the
 * record's own `urgency`, the same answer its details page shows.
 *
 * Kilometres play no part anywhere in it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Each row opens the record's details, where it can be completed.
 */
export function MaintenanceWarnings() {
  const t = useTranslation();

  const attention = useAsync(
    useCallback((signal: AbortSignal) => getMaintenanceAttention(signal), []),
    [],
  );

  const items = attention.data?.items ?? [];

  return (
    <Card>
      <CardHeader title={t("maintenance.due.title")} />

      {attention.isLoading ? <LoadingState label={t("maintenance.loading")} /> : null}

      {!attention.isLoading && attention.error ? (
        <ErrorState error={attention.error} onRetry={attention.reload} />
      ) : null}

      {!attention.isLoading && !attention.error && attention.data && items.length === 0 ? (
        <EmptyState title={t("maintenance.due.none")} />
      ) : null}

      {!attention.isLoading && !attention.error && items.length > 0 ? (
        <ul className="divide-y divide-border">
          {items.map((record) => (
            <li key={record.id}>
              <Link
                href={`/maintenance/${record.id}`}
                className={cn(
                  "flex items-start justify-between gap-3 border-l-4 px-4 py-2.5 hover:bg-hover",
                  record.urgency ? ROW_ACCENTS[record.urgency.level] : "border-transparent",
                )}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    {record.urgency ? (
                      <MaintenanceUrgencyBadge urgency={record.urgency} />
                    ) : null}
                    <span className="text-sm font-semibold text-foreground">
                      {record.vehicle
                        ? record.vehicle.licensePlate
                        : t("maintenance.value.empty")}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-secondary">
                    {maintenanceTypeLabel(record.maintenanceType, t) ??
                      record.description}
                  </span>
                </span>

                <span className="shrink-0 text-sm tabular-nums text-secondary">
                  {formatCalendarDate(record.maintenanceDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <CardBody className="border-t border-border">
        <WidgetLink href="/maintenance" labelKey="maintenance.due.link" />
      </CardBody>
    </Card>
  );
}
