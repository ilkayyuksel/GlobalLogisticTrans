import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  UPDATED_FIELD_CLASS,
  changedByLatestUpdate,
  isRevised,
} from "@/lib/trips/latest-update";
import { TripStatusBadge } from "./trip-status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Trip, Vehicle } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { formatWaitingTime } from "@/lib/waiting-time";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";

/**
 * Everything a Trip is, as stored.
 *
 * Values are shown as the backend returned them. Nothing is reformatted beyond
 * joining a city to its country, and nothing is inferred — an absent value is
 * shown as absent rather than filled in with a guess.
 */
export function TripSummary({
  trip,
  vehicle,
}: {
  trip: Trip;
  /**
   * The full Vehicle record, which carries brand and model. The Trip's own
   * embedded summary has only the plate, and a detail page can afford the one
   * extra request that makes the truck identifiable.
   */
  vehicle: Vehicle | null;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader
        // A manual Trip may have neither yet, and its own id is the only
        // thing that always identifies it.
        title={trip.bookingNumber ?? t("tripDetail.value.noBookingNumber")}
        description={`${t("ritten.column.container")} ${
          trip.containerType ?? t("tripDetail.value.notSet")
        }${trip.containerNumber ? ` · ${trip.containerNumber}` : ""}`}
        action={
          <span className="flex items-center gap-2">
            <TripStatusBadge status={trip.status} />
            {/* Derived, and beside the status: the lifecycle is still OPEN. */}
            {isRevised(trip) ? (
              <Badge tone="warning">{t("ritten.status.revised")}</Badge>
            ) : null}
          </span>
        }
      />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label={t("ritten.column.containerType")}
            value={trip.containerType}
            isUpdated={changedByLatestUpdate(trip, "containerType")}
          />
          <Field
            label={t("ritten.column.container")}
            value={trip.containerNumber}
            isUpdated={changedByLatestUpdate(trip, "containerNumber")}
          />
          <Field
            label={t("ritten.column.terminal")}
            value={trip.terminal}
            isUpdated={changedByLatestUpdate(trip, "terminal")}
          />
          <Field
            label={t("tripDetail.field.city")}
            value={trip.destinationCity}
            isUpdated={changedByLatestUpdate(trip, "destinationCity")}
          />
          <Field
            label={t("tripDetail.field.country")}
            value={trip.destinationCountry}
            isUpdated={changedByLatestUpdate(trip, "destinationCountry")}
          />
          <Field
            label={t("ritten.column.date")}
            value={formatCalendarDate(trip.planningDate)}
          />
          <Field
            label={t("tripDetail.field.plannedTime")}
            value={formatTimeRange(trip)}
            isUpdated={
              changedByLatestUpdate(trip, "startTime") ||
              changedByLatestUpdate(trip, "endTime")
            }
          />
          <Field
            label={t("tripDetail.field.carriedOutAt")}
            value={formatDateTime(trip.executionDatetime)}
          />
          <Field
            label={t("ritten.filter.vehicle")}
            value={vehicle ? formatVehicle(vehicle) : null}
          />
          <DriverField trip={trip} />
          <Field
            label={t("ritten.column.waitingTime")}
            value={
              formatWaitingTime(trip.waitingTimeMinutes) === null
                ? null
                : formatWaitingTime(trip.waitingTimeMinutes)
            }
          />
          <Field
            label={t("tripDetail.field.distance")}
            value={trip.distanceKm === null ? null : `${trip.distanceKm} km`}
          />
          <Field
            label={t("tripDetail.field.tripType")}
            value={
              trip.tripGroupId
                ? t("tripDetail.value.combination")
                : t("tripDetail.value.single")
            }
          />
          <Field
            label={t("tripDetail.field.originalDate")}
            value={formatCalendarDate(trip.originalPlanningDate)}
            isUpdated={changedByLatestUpdate(trip, "originalPlanningDate")}
          />
        </dl>

        {trip.internalNotes ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("tripDetail.field.internalNotes")}
            </p>
            <p className="mt-1 text-sm text-secondary">{trip.internalNotes}</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * The Trip's driver, as the backend resolved it.
 *
 * `effectiveDriver` is the answer, already worked out server-side from the
 * Trip's own planning date: the override when one is set, otherwise the Driver
 * of the vehicle assignment covering that date. Nothing is derived here, and no
 * assignment endpoint is consulted.
 *
 * The source is shown because the two cases mean different things to a planner:
 * an override was chosen for this Trip specifically, while a vehicle assignment
 * is the standing arrangement that would apply to any Trip on that truck.
 */
function DriverField({ trip }: { trip: Trip }) {
  const t = useTranslation();
  const driver = trip.effectiveDriver;

  if (!driver) {
    return (
      <Field label={t("ritten.column.driver")} value={null}>
        <span className="text-xs text-muted">{t("ritten.value.noDriver")}</span>
      </Field>
    );
  }

  return (
    <Field label={t("ritten.column.driver")} value={driver.name}>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {/*
          A Trip-level override can no longer be SET from the UI, but records
          created while it could be still carry one. Reporting the source
          honestly is the difference between "this truck's standing driver" and
          "someone chosen for this Trip alone".
        */}
        <span>
          {driver.source === "OVERRIDE"
            ? t("tripDetail.driver.fromOverride")
            : t("tripDetail.driver.fromAssignment")}
        </span>
        {driver.isActive ? null : (
          <Badge tone="warning">{t("vehicles.status.inactive")}</Badge>
        )}
      </span>
    </Field>
  );
}

function Field({
  label,
  value,
  children,
  isUpdated = false,
}: {
  label: string;
  value: string | null;
  children?: ReactNode;
  /** Marked when the LATEST update document moved this field. */
  isUpdated?: boolean;
}) {
  const t = useTranslation();

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">
        <span
          className={isUpdated ? UPDATED_FIELD_CLASS : undefined}
          title={isUpdated ? t("ritten.status.revisedField") : undefined}
        >
          {value ?? (
            <span className="text-muted">{t("tripDetail.value.notSet")}</span>
          )}
        </span>
        {children ? <div className="mt-0.5">{children}</div> : null}
      </dd>
    </div>
  );
}

function formatVehicle(vehicle: Vehicle): string {
  const model = [vehicle.brand, vehicle.model].filter(Boolean).join(" ");

  return model ? `${vehicle.licensePlate} · ${model}` : vehicle.licensePlate;
}

/** Both ends are needed for an interval; one alone says nothing useful. */
function formatTimeRange(trip: Trip): string | null {
  if (!trip.startTime || !trip.endTime) {
    return trip.startTime ?? trip.endTime;
  }

  return `${trip.startTime} – ${trip.endTime}`;
}

/** Locale-independent, so a server and a browser render the same string. */
function formatDateTime(value: string | null): string | null {
  return value ? value.replace("T", " ").slice(0, 16) : null;
}
