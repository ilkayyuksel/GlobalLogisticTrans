"use client";

import Link from "next/link";
import { useCallback } from "react";

import { TripStatusBadge } from "@/components/trips/trip-status-badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { listTrips } from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { toClockLabel } from "@/lib/calendar/clock";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { combinationClasses, combinationLabel } from "@/lib/ritten/combination";
import { RittenDialog } from "./ritten-dialog";

/**
 * Every leg of one Combination.
 *
 * The members are FETCHED BY GROUP ID rather than collected from the rows on
 * screen. The other leg may be planned for another day, and a dialog that
 * quietly showed only the legs that happened to be on the current page would be
 * wrong exactly when it mattered.
 *
 * Each leg shows what identifies it operationally — booking, date and time,
 * terminal, destination, vehicle, the resolved driver and status — and links to
 * its own detail page. It does not repeat the detail page: this answers "what
 * is the other half of this order", not "everything about it".
 *
 * Direction is not shown: the backend does not expose it on a Trip. It lives in
 * `parserMetadata`, which is diagnostics and deliberately not part of the API.
 *
 * UNLINKING LIVES HERE. It used to sit in the row's "Acties" dropdown, which is
 * gone; this is its proper home anyway — a link is dissolved from the thing that
 * shows the link, beside the leg it removes, rather than from a menu on a row
 * that says nothing about the other half.
 */
export function CombinationDialog({
  tripGroupId,
  onUnlink,
  onClose,
}: {
  tripGroupId: string;
  /** Resolves once the backend accepted it AND the list was refetched. */
  onUnlink: (trip: Trip) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();

  const members = useAsync(
    useCallback(
      (signal: AbortSignal) => listTrips({ tripGroupId }, signal),
      [tripGroupId],
    ),
    [tripGroupId],
  );

  return (
    <RittenDialog
      title={t("ritten.group.dialogTitle")}
      titleExtra={
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${combinationClasses(tripGroupId)}`}
        >
          {combinationLabel(tripGroupId)}
        </span>
      }
      onClose={onClose}
    >
      {members.isLoading ? (
        <LoadingState label={t("ritten.group.loading")} />
      ) : null}

      {!members.isLoading && members.error ? (
        <ErrorState error={members.error} onRetry={members.reload} />
      ) : null}

      {!members.isLoading && !members.error ? (
        <ul className="divide-y divide-border">
          {members.data?.items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">
              {t("ritten.group.empty")}
            </li>
          ) : null}

          {(members.data?.items ?? []).map((trip) => (
            <li key={trip.id} className="px-4 py-3">
              <Member
                trip={trip}
                onNavigate={onClose}
                onUnlink={async () => {
                  await onUnlink(trip);
                  members.reload();
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </RittenDialog>
  );
}

function Member({
  trip,
  onNavigate,
  onUnlink,
}: {
  trip: Trip;
  onNavigate: () => void;
  onUnlink: () => Promise<void>;
}) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/trips/${trip.id}`}
          onClick={onNavigate}
          className="text-sm font-medium text-primary hover:underline"
        >
          {trip.bookingNumber}
        </Link>
        <span className="flex items-center gap-2">
          <TripStatusBadge
            status={trip.status}
            label={t(`status.${trip.status}`)}
          />
          {/*
            Removing a leg is not routine and it changes what the other legs
            mean, so it still asks — unlike completing, which is routine and
            asks nothing.
          */}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t("ritten.group.confirmUnlink"))) {
                return;
              }

              // The page reports every failure in its own feedback line, so the
              // rejection ends here rather than becoming an unhandled promise.
              void onUnlink().catch(() => undefined);
            }}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-secondary hover:bg-hover hover:text-foreground"
          >
            {t("ritten.menu.unlink")}
          </button>
        </span>
      </div>

      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
        <Detail label={t("ritten.column.date")}>
          {formatCalendarDate(trip.planningDate)}
          {trip.startTime ? ` · ${toClockLabel(trip.startTime)}` : ""}
        </Detail>
        <Detail label={t("ritten.column.terminal")}>
          {trip.terminal ?? empty}
        </Detail>
        <Detail label={t("ritten.column.address")}>
          {trip.destinationCity}, {trip.destinationCountry}
        </Detail>
        <Detail label={t("ritten.column.licensePlate")}>
          {trip.vehicle ? trip.vehicle.licensePlate : t("ritten.value.noVehicle")}
        </Detail>
        {/* Resolved by the backend; never worked out here. */}
        <Detail label={t("ritten.column.driver")}>
          {trip.effectiveDriver
            ? trip.effectiveDriver.name
            : t("ritten.value.noDriver")}
        </Detail>
      </dl>
    </>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-secondary">{children}</dd>
    </div>
  );
}
