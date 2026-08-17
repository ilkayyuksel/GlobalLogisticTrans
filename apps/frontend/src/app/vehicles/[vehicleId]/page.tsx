"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import {
  getMaintenanceSummary,
  type MaintenanceSummary,
} from "@/lib/api/maintenance";
import {
  closeAssignment,
  createAssignment,
  getCurrentAssignment,
  getDriverById,
  getVehicleById,
  updateAssignment,
  type CreateAssignmentPayload,
} from "@/lib/api/vehicles";
import type { Driver, Vehicle, VehicleAssignment } from "@/lib/api/types";
import { AssignmentDialog } from "@/components/vehicles/assignment-dialog";
import { today } from "@/lib/calendar/calendar-dates";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { userFacingMessage } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * One Vehicle, in full.
 *
 * Three requests, all on this page and none per row: the Vehicle, the
 * assignment currently in effect, and — only when there is one — the Driver it
 * names. WHICH assignment is in effect is the backend's answer, resolved by the
 * same rule that gives a Trip its effective driver; nothing here compares dates.
 *
 * The maintenance summary comes from the backend, which counts and SUMS in the
 * database. Adding NUMERIC(12,2) costs in JavaScript would put binary rounding
 * into a figure read as money, and would only ever cover one page of history.
 *
 * The panel keeps two things apart on purpose:
 *   - "Laatste kilometerstand" is the reading entered at the last service. It
 *     is NOT the vehicle's current mileage; nothing here knows that.
 *   - "Volgend onderhoud" is the plan — a date, a mileage, or both.
 * Only the DATE can make something due, which is why the warning says so.
 */
export default function VehicleDetailPage() {
  const t = useTranslation();
  const params = useParams<{ vehicleId: string }>();
  const vehicleId = params.vehicleId;

  const vehicle = useAsync(
    useCallback(
      (signal: AbortSignal) => getVehicleById(vehicleId, signal),
      [vehicleId],
    ),
    [vehicleId],
  );

  const assignment = useAsync(
    useCallback(
      async (signal: AbortSignal) => {
        const current = await getCurrentAssignment(vehicleId, signal);

        if (!current) {
          return null;
        }

        return {
          assignment: current,
          driver: await getDriverById(current.driverId, signal),
        };
      },
      [vehicleId],
    ),
    [vehicleId],
  );

  const maintenance = useAsync(
    useCallback(
      (signal: AbortSignal) => getMaintenanceSummary(vehicleId, signal),
      [vehicleId],
    ),
    [vehicleId],
  );

  const [isAssigning, setIsAssigning] = useState(false);
  const [isEditingAssignment, setIsEditingAssignment] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const isMissing =
    vehicle.error instanceof ApiError && vehicle.error.isNotFound;

  /**
   * One call, then the authoritative assignment, then the report.
   *
   * Which assignment is in effect is re-read rather than assumed: an
   * open-ended assignment closes the previous one, and only the backend
   * knows what that left behind.
   */
  async function runAssignment(
    operation: () => Promise<unknown>,
    successKey: Parameters<typeof t>[0],
  ): Promise<void> {
    setAssignmentFeedback(null);

    try {
      await operation();

      assignment.reload();
      setAssignmentFeedback({ text: t(successKey), isError: false });
    } catch (error: unknown) {
      setAssignmentFeedback({
        text: userFacingMessage(error),
        isError: true,
      });

      // Rethrown so the dialog stays open with its values.
      throw error;
    }
  }

  function saveAssignment(payload: CreateAssignmentPayload): Promise<void> {
    const current = assignment.data?.assignment;

    return isEditingAssignment && current
      ? runAssignment(
          () =>
            updateAssignment(current.id, {
              validTo: payload.validTo ?? null,
              notes: payload.notes ?? null,
            }),
          "vehicles.assignment.updated",
        )
      : runAssignment(
          () => createAssignment(payload),
          "vehicles.assignment.created",
        );
  }

  function endAssignment(assignmentId: string): void {
    if (!window.confirm(t("vehicles.assignment.confirmEnd"))) {
      return;
    }

    void runAssignment(
      () => closeAssignment(assignmentId),
      "vehicles.assignment.ended",
    ).catch(() => undefined);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/vehicles"
        className="text-sm font-medium text-primary hover:underline"
      >
        ← {t("vehicles.detail.back")}
      </Link>

      {vehicle.isLoading ? <LoadingState label={t("vehicles.loading")} /> : null}

      {!vehicle.isLoading && isMissing ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-foreground">
          {t("vehicles.detail.notFound")}
        </p>
      ) : null}

      {!vehicle.isLoading && vehicle.error && !isMissing ? (
        <ErrorState error={vehicle.error} onRetry={vehicle.reload} />
      ) : null}

      {vehicle.data ? (
        <>
          <VehicleSummary vehicle={vehicle.data} />
          <AssignmentPanel
            data={assignment.data ?? null}
            isLoading={assignment.isLoading}
            feedback={assignmentFeedback}
            onLink={() => {
              setIsEditingAssignment(false);
              setIsAssigning(true);
            }}
            onEdit={() => {
              setIsEditingAssignment(true);
              setIsAssigning(true);
            }}
            onEnd={endAssignment}
          />
          <MaintenancePanel
            summary={maintenance.data ?? null}
            isLoading={maintenance.isLoading}
          />
        </>
      ) : null}

      {isAssigning ? (
        <AssignmentDialog
          vehicleId={vehicleId}
          assignment={
            isEditingAssignment
              ? (assignment.data?.assignment ?? null)
              : null
          }
          today={today()}
          onSave={saveAssignment}
          onClose={() => setIsAssigning(false)}
        />
      ) : null}
    </div>
  );
}

function VehicleSummary({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslation();
  const empty = t("vehicles.value.empty");

  return (
    <Card>
      <CardHeader
        title={`${t("vehicles.detail.title")} ${vehicle.licensePlate}`}
        action={
          <Badge tone={vehicle.isActive ? "success" : "neutral"}>
            {vehicle.isActive
              ? t("vehicles.status.active")
              : t("vehicles.status.inactive")}
          </Badge>
        }
      />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Detail label={t("vehicles.form.brand")}>
            {vehicle.brand ?? empty}
          </Detail>
          <Detail label={t("vehicles.form.model")}>
            {vehicle.model ?? empty}
          </Detail>
          <Detail label={t("vehicles.form.year")}>
            {vehicle.year ?? empty}
          </Detail>
          <Detail label={t("vehicles.form.displayColor")}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                style={{ backgroundColor: vehicle.displayColor }}
                className="inline-block h-3 w-3 rounded-sm"
              />
              {vehicle.displayColor}
            </span>
          </Detail>
          <Detail label={t("vehicles.form.description")}>
            {vehicle.description ?? empty}
          </Detail>
          <Detail label={t("vehicles.form.notes")}>
            {vehicle.notes ?? empty}
          </Detail>
        </dl>
      </CardBody>
    </Card>
  );
}

/**
 * The standing arrangement, exactly as the backend resolved it.
 *
 * WHICH assignment is in effect today is the backend's answer — the same rule
 * that gives a Trip its effective driver. Nothing here compares dates; the
 * panel shows what came back and offers the three operations the API has.
 */
function AssignmentPanel({
  data,
  isLoading,
  feedback,
  onLink,
  onEdit,
  onEnd,
}: {
  data: { assignment: VehicleAssignment; driver: Driver } | null;
  isLoading: boolean;
  feedback: { text: string; isError: boolean } | null;
  onLink: () => void;
  onEdit: () => void;
  onEnd: (assignmentId: string) => void;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader
        title={t("vehicles.assignment.title")}
        action={
          <button
            type="button"
            onClick={onLink}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {t("vehicles.assignment.link")}
          </button>
        }
      />
      <CardBody>
        {feedback ? (
          <p
            role="status"
            className={
              feedback.isError
                ? "mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
                : "mb-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-foreground"
            }
          >
            {feedback.text}
          </p>
        ) : null}

        {isLoading ? <LoadingState label={t("vehicles.loading")} /> : null}

        {!isLoading && !data ? (
          <p className="text-sm text-muted">{t("vehicles.detail.noDriver")}</p>
        ) : null}

        {/* The rule is the backend's; the panel credits it rather than restating it. */}
        <p className="mt-3 text-[11px] text-muted">
          {t("vehicles.assignment.effectiveNote")}
        </p>

        {!isLoading && data ? (
          <div className="text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              {data.driver.name}
              {data.driver.isActive ? null : (
                <Badge tone="neutral">{t("vehicles.status.inactive")}</Badge>
              )}
            </p>

            <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Detail label={t("vehicles.assignment.validFrom")}>
                <span className="tabular-nums">
                  {formatCalendarDate(data.assignment.validFrom)}
                </span>
              </Detail>
              <Detail label={t("vehicles.assignment.validTo")}>
                {data.assignment.validTo === null ? (
                  <Badge tone="info">
                    {t("vehicles.assignment.openEnded")}
                  </Badge>
                ) : (
                  <span className="tabular-nums">
                    {formatCalendarDate(data.assignment.validTo)}
                  </span>
                )}
              </Detail>
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onEdit}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("vehicles.assignment.edit")}
              </button>
              <button
                type="button"
                onClick={() => onEnd(data.assignment.id)}
                className="text-sm font-medium text-danger hover:underline"
              >
                {t("vehicles.assignment.end")}
              </button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * What this Vehicle's maintenance adds up to.
 *
 * Every figure is the backend's: the count and the total are computed by the
 * database, and whether something is due is decided there too — by DATE only,
 * because a mileage-based due date cannot be evaluated without a current
 * odometer reading.
 */
function MaintenancePanel({
  summary,
  isLoading,
}: {
  summary: MaintenanceSummary | null;
  isLoading: boolean;
}) {
  const t = useTranslation();
  const empty = t("vehicles.value.empty");

  return (
    <Card>
      <CardHeader
        title={t("vehicles.detail.maintenance")}
        action={
          <Link
            href="/maintenance"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("vehicles.detail.maintenanceLink")}
          </Link>
        }
      />
      <CardBody>
        {isLoading ? <LoadingState label={t("maintenance.loading")} /> : null}

        {!isLoading && summary ? (
          <>
            {summary.isDueByDate ? (
              <p
                role="status"
                className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-foreground"
              >
                {t("maintenance.summary.due")}
              </p>
            ) : null}

            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <Detail label={t("maintenance.summary.count")}>
                {summary.maintenanceCount}
              </Detail>
              {/* Summed by the database; shown exactly as sent. */}
              <Detail label={t("maintenance.summary.totalCost")}>
                {summary.totalCost}
              </Detail>
              <Detail label={t("maintenance.summary.latest")}>
                {summary.latestMaintenance
                  ? `${formatCalendarDate(summary.latestMaintenance.maintenanceDate)} · ${summary.latestMaintenance.description}`
                  : t("maintenance.summary.none")}
              </Detail>
              <Detail
                label={t("maintenance.summary.latestMileage")}
                hint={t("maintenance.summary.latestMileageHint")}
              >
                {summary.latestMileage === null
                  ? empty
                  : `${summary.latestMileage.toLocaleString("nl-BE")} ${t("maintenance.value.km")}`}
              </Detail>
              <Detail label={t("maintenance.summary.next")}>
                {summary.nextMaintenanceDate === null &&
                summary.nextMaintenanceMileage === null
                  ? empty
                  : [
                      formatCalendarDate(summary.nextMaintenanceDate),
                      summary.nextMaintenanceMileage === null
                        ? null
                        : `${summary.nextMaintenanceMileage.toLocaleString("nl-BE")} ${t("maintenance.value.km")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </Detail>
            </dl>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Detail({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
