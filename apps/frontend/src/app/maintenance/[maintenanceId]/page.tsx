"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

import { BackLink } from "@/components/layout/back-link";
import { CompleteMaintenanceDialog } from "@/components/maintenance/complete-maintenance-dialog";
import {
  MaintenanceStatusBadge,
  MaintenanceUrgencyBadge,
} from "@/components/maintenance/maintenance-badges";
import { MaintenanceHistory } from "@/components/maintenance/maintenance-history";
import { CompleteIcon } from "@/components/ritten/row-action-button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import {
  completeMaintenance,
  getMaintenance,
  type CompleteMaintenancePayload,
  type MaintenanceDetail,
} from "@/lib/api/maintenance";
import { formatCalendarDate, today } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";

/**
 * One maintenance record: its current planning, its full history, and the ✓
 * that completes the current cycle.
 *
 * One request loads the record and its history together. After a completion
 * the page shows what the backend answered — the same record, planned again,
 * with the finished cycle added to its history — without a second request.
 */
export default function MaintenanceDetailPage() {
  const t = useTranslation();
  const { maintenanceId } = useParams<{ maintenanceId: string }>();

  const record = useAsync(
    useCallback(
      (signal: AbortSignal) => getMaintenance(maintenanceId, signal),
      [maintenanceId],
    ),
    [maintenanceId],
  );

  const [completed, setCompleted] = useState<MaintenanceDetail | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const current = completed ?? record.data;
  const isMissing = record.error instanceof ApiError && record.error.isNotFound;

  async function complete(payload: CompleteMaintenancePayload): Promise<void> {
    setCompleted(await completeMaintenance(maintenanceId, payload));
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <BackLink href="/maintenance" className="text-sm font-medium text-primary hover:underline">
        ← {t("maintenance.detail.back")}
      </BackLink>

      {record.isLoading && !current ? <LoadingState label={t("maintenance.loading")} /> : null}

      {isMissing ? (
        <p role="alert" className="text-sm text-foreground">
          {t("maintenance.detail.notFound")}
        </p>
      ) : null}

      {record.error && !isMissing ? (
        <ErrorState error={record.error} onRetry={record.reload} />
      ) : null}

      {current ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              {t("maintenance.detail.title")}{" "}
              {current.vehicle?.licensePlate ?? t("maintenance.value.empty")}
            </h1>

            {current.status === "PLANNED" || current.status === "IN_PROGRESS" ? (
              <button
                type="button"
                onClick={() => setIsCompleting(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
              >
                <CompleteIcon />
                {t("maintenance.action.complete")}
              </button>
            ) : null}
          </div>

          {completed ? (
            <p role="status" className="rounded-md border border-success/30 bg-success/5 px-4 py-2 text-sm font-medium text-foreground">
              {t("maintenance.feedback.completed")}
            </p>
          ) : null}

          <CurrentPlanning record={current} />
          <MaintenanceHistory completions={current.completions} />

          {isCompleting ? (
            <CompleteMaintenanceDialog
              maintenance={current}
              today={today()}
              onComplete={complete}
              onClose={() => setIsCompleting(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function CurrentPlanning({ record }: { record: MaintenanceDetail }) {
  const t = useTranslation();
  const empty = t("maintenance.value.empty");
  const km = (value: number | null) =>
    value === null ? empty : `${value.toLocaleString("nl-BE")} ${t("maintenance.value.km")}`;

  return (
    <Card>
      <CardHeader title={t("maintenance.detail.current")} />
      <CardBody>
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatCalendarDate(record.maintenanceDate)}
          </span>
          <MaintenanceStatusBadge status={record.status} />
          {record.urgency ? <MaintenanceUrgencyBadge urgency={record.urgency} /> : null}
        </p>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label={t("maintenance.form.type")} value={maintenanceTypeLabel(record.maintenanceType, t) ?? empty} />
          <Detail label={t("maintenance.form.description")} value={record.description} />
          <Detail label={t("maintenance.form.workshop")} value={record.workshop ?? empty} />
          <Detail label={t("maintenance.form.cost")} value={record.cost ?? empty} />
          <Detail label={t("maintenance.form.mileage")} value={km(record.mileage)} />
          <Detail label={t("maintenance.form.nextMileage")} value={km(record.nextMaintenanceMileage)} />
          <Detail label={t("maintenance.form.nextDate")} value={formatCalendarDate(record.nextMaintenanceDate) ?? empty} />
          <Detail label={t("maintenance.form.notes")} value={record.notes ?? empty} />
        </dl>
      </CardBody>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{value}</dd>
    </div>
  );
}
