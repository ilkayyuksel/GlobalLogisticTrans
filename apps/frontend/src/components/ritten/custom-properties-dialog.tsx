"use client";

import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import {
  assignCustomProperty,
  listAssignableCustomProperties,
  listTripCustomProperties,
  removeCustomPropertyAssignment,
} from "@/lib/api/fleet";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { RittenDialog } from "./ritten-dialog";

/**
 * The Custom Properties on one Trip.
 *
 * Opened per Trip, which is what makes this affordable: the API reads
 * assignments one Trip at a time, so a column that showed them for every row
 * would be one request per row. Here it is one request for the Trip the user
 * actually asked about.
 *
 * Assignment is one request per property, because that is what the API models —
 * an assignment is a row with its own id. For the handful a Trip carries that
 * is the right trade, and a bulk endpoint would be a backend change made for a
 * problem nobody has yet.
 *
 * ASSIGNED PROPERTIES THAT HAVE SINCE BEEN DEACTIVATED STAY VISIBLE, marked
 * inactive. They are still on the Trip and still in its pricing history;
 * hiding them would misrepresent what was agreed. They simply cannot be
 * assigned again, which is the backend's rule, not one invented here.
 *
 * No price is shown or computed. A property's configured price is not what it
 * contributed to this Trip — that is a line in the pricing snapshot, which is
 * the only place a priced amount is authoritative.
 */
export function CustomPropertiesDialog({
  trip,
  onChanged,
  onClose,
}: {
  trip: Trip;
  /**
   * Called after the backend accepted an assignment or a removal.
   *
   * The row behind this dialog shows its own compact list, built from the Trip
   * the LIST endpoint returned — so this dialog reloading its own data is not
   * enough to update it. The page refetches instead of the row being patched
   * here: what appears must be what the backend holds, not what this component
   * believes it just did.
   */
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const assigned = useAsync(
    useCallback(
      (signal: AbortSignal) => listTripCustomProperties(trip.id, signal),
      [trip.id],
    ),
    [trip.id],
  );

  const assignable = useAsync(
    useCallback(
      (signal: AbortSignal) => listAssignableCustomProperties(signal),
      [],
    ),
    [],
  );

  const assignedIds = new Set(
    (assigned.data ?? []).map((item) => item.customPropertyId),
  );
  const available = (assignable.data ?? []).filter(
    (property) => !assignedIds.has(property.id),
  );

  async function run(id: string, operation: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);

    try {
      await operation();
      // The authoritative set, re-read rather than patched locally — here for
      // this dialog, and through `onChanged` for the row underneath it.
      assigned.reload();
      onChanged();
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RittenDialog
      title={`${t("ritten.custom.title")} — ${trip.bookingNumber}`}
      onClose={onClose}
    >
      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground">
          {userFacingMessage(error)}
        </p>
      ) : null}

      {assigned.isLoading ? (
        <LoadingState label={t("ritten.custom.loading")} />
      ) : null}

      {!assigned.isLoading && assigned.error ? (
        <ErrorState error={assigned.error} onRetry={assigned.reload} />
      ) : null}

      {!assigned.isLoading && !assigned.error ? (
        <div className="px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("ritten.custom.assigned")}
          </h3>

          {assigned.data?.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("ritten.custom.empty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {(assigned.data ?? []).map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    {assignment.customProperty.name}
                    {assignment.customProperty.isActive ? null : (
                      <Badge tone="neutral">{t("ritten.value.inactive")}</Badge>
                    )}
                  </span>

                  <button
                    type="button"
                    disabled={busyId === assignment.id}
                    onClick={() =>
                      void run(assignment.id, () =>
                        removeCustomPropertyAssignment(assignment.id),
                      )
                    }
                    className="shrink-0 text-xs font-medium text-secondary hover:text-danger disabled:opacity-50"
                  >
                    {t("ritten.custom.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
            {t("ritten.custom.available")}
          </h3>

          {assignable.isLoading ? (
            <LoadingState label={t("ritten.custom.loading")} />
          ) : null}

          {!assignable.isLoading && available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("ritten.custom.noneAvailable")}
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {available.map((property) => (
                <li key={property.id}>
                  <button
                    type="button"
                    disabled={busyId === property.id}
                    onClick={() =>
                      void run(property.id, () =>
                        assignCustomProperty(trip.id, property.id),
                      )
                    }
                    className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-hover disabled:opacity-50"
                  >
                    + {property.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </RittenDialog>
  );
}
