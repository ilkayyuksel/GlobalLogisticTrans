"use client";

import Link from "next/link";
import { useCallback } from "react";

import { AgendaToday } from "@/components/dashboard/agenda-today";
import { DriverStatisticsWidget } from "@/components/dashboard/driver-statistics";
import { MaintenanceWarnings } from "@/components/dashboard/maintenance-warnings";
import { PdfUpload } from "@/components/dashboard/pdf-upload";
import { StatCard } from "@/components/dashboard/stat-card";
import { WidgetLink } from "@/components/dashboard/widget-link";
import { TripStatusBadge } from "@/components/trips/trip-status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { getDashboardCounts, getRecentTrips } from "@/lib/api/dashboard";
import { useTranslation } from "@/lib/i18n/language-provider";
import { toClockLabel } from "@/lib/calendar/clock";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";

/**
 * The operational homepage.
 *
 * Every figure comes from the backend, counted by the database.
 *
 * The Agenda sits in the fourth place of the headline row, where the average
 * waiting time used to be. It shows today through the calendar's own day
 * endpoint and grid — the same items, arranged the same way, not a second
 * dataset.
 *
 * The maintenance section is the backend's own top five: overdue work first,
 * then today's, then the next planned dates — decided from dates and statuses
 * only, never from kilometres.
 */
export default function DashboardPage() {
  const t = useTranslation();

  const counts = useAsync(
    useCallback((signal: AbortSignal) => getDashboardCounts(signal), []),
    [],
  );

  const recent = useAsync(
    useCallback((signal: AbortSignal) => getRecentTrips(signal), []),
    [],
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <h1 className="text-xl font-semibold text-foreground">
        {t("dashboard.title")}
      </h1>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          labelKey="dashboard.stats.totalTrips"
          value={counts.data ? counts.data.totalTrips : null}
          isLoading={counts.isLoading}
        />
        <StatCard
          labelKey="dashboard.stats.today"
          value={counts.data ? counts.data.today : null}
          isLoading={counts.isLoading}
        />
        <StatCard
          labelKey="dashboard.stats.thisWeek"
          value={counts.data ? counts.data.thisWeek : null}
          isLoading={counts.isLoading}
        />
        <AgendaToday />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PdfUpload />

        <Card>
          <CardHeader title={t("dashboard.tripStatus.title")} />
          <CardBody>
            {counts.isLoading ? <LoadingState /> : null}

            {!counts.isLoading && counts.error ? (
              <ErrorState error={counts.error} onRetry={counts.reload} />
            ) : null}

            {!counts.isLoading && !counts.error && counts.data ? (
              <dl className="space-y-2">
                <StatusRow
                  label={t("dashboard.tripStatus.open")}
                  value={counts.data.open}
                />
                <StatusRow
                  label={t("dashboard.tripStatus.closed")}
                  value={counts.data.closed}
                />
                <StatusRow
                  label={t("dashboard.tripStatus.total")}
                  value={counts.data.totalTrips}
                  emphasis
                />
              </dl>
            ) : null}

            <p className="mt-4">
              <WidgetLink href="/trips" labelKey="dashboard.tripStatus.link" />
            </p>
          </CardBody>
        </Card>

        <MaintenanceWarnings />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("dashboard.recentTrips.title")} />

          {recent.isLoading ? <LoadingState /> : null}

          {!recent.isLoading && recent.error ? (
            <ErrorState error={recent.error} onRetry={recent.reload} />
          ) : null}

          {!recent.isLoading && !recent.error && recent.data?.length === 0 ? (
            <EmptyState title={t("dashboard.recentTrips.empty")} />
          ) : null}

          {!recent.isLoading && !recent.error && recent.data?.length ? (
            <ul className="divide-y divide-border">
              {recent.data.map((trip) => (
                <li key={trip.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/trips/${trip.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {trip.bookingNumber}
                    </Link>
                    <TripStatusBadge status={trip.status} />
                  </div>

                  {/* Vehicle and driver are embedded in the row — no extra calls. */}
                  <p className="mt-0.5 text-xs text-secondary">
                    {trip.terminal ?? "—"} → {trip.destinationCity} ·{" "}
                    {formatCalendarDate(trip.planningDate)}
                    {trip.startTime ? ` ${toClockLabel(trip.startTime)}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {trip.vehicle ? trip.vehicle.licensePlate : "—"} ·{" "}
                    {trip.effectiveDriver ? trip.effectiveDriver.name : "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="border-t border-border px-5 py-3">
            <WidgetLink href="/trips" labelKey="dashboard.recentTrips.link" />
          </div>
        </Card>

        <DriverStatisticsWidget />
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd
        className={
          emphasis
            ? "text-sm font-semibold tabular-nums text-foreground"
            : "text-sm tabular-nums text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}
