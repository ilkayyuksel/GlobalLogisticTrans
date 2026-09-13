"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { MaintenanceCompletion } from "@/lib/api/maintenance";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";

/**
 * Every completed cycle of one maintenance record, oldest first — the order the
 * backend delivers, so a record reads from its first execution to its latest.
 *
 * The history belongs to the record and is independent of its current planning:
 * each entry shows the date the work was planned for, the day it was done, what
 * the Administrator added, and the next date that was chosen then.
 */
export function MaintenanceHistory({
  completions,
}: {
  completions: readonly MaintenanceCompletion[];
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader title={t("maintenance.detail.history")} />

      {completions.length === 0 ? (
        <CardBody>
          <p className="text-sm text-secondary">{t("maintenance.detail.historyEmpty")}</p>
        </CardBody>
      ) : (
        <ol className="divide-y divide-border">
          {completions.map((completion) => (
            <li key={completion.id} className="space-y-1 px-5 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCalendarDate(completion.completedOn)}
                </span>
                <Badge tone="success">✓ {t("maintenance.status.COMPLETED")}</Badge>
              </p>

              <p className="text-sm text-foreground">
                {maintenanceTypeLabel(completion.maintenanceType, t) ??
                  completion.description}
              </p>

              {completion.notes ? (
                <p className="whitespace-pre-wrap text-sm text-secondary">
                  <span className="font-medium">{t("maintenance.detail.note")}:</span>{" "}
                  {completion.notes}
                </p>
              ) : null}

              <p className="text-xs text-muted">
                {t("maintenance.detail.plannedFor")}{" "}
                <span className="tabular-nums">
                  {formatCalendarDate(completion.plannedDate)}
                </span>{" "}
                · {t("maintenance.detail.next")}{" "}
                <span className="tabular-nums">
                  {formatCalendarDate(completion.nextMaintenanceDate)}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
