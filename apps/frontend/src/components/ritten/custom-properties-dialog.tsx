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
import type {
  EffectivePricing,
  Trip,
  TripCustomProperty,
  TripCustomPropertyMutation,
} from "@/lib/api/types";
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
 * No price is shown or computed HERE. A property's configured price is not what
 * it contributed to this Trip — that is a line in the pricing snapshot, which is
 * the only place a priced amount is authoritative.
 *
 * The write does answer with the Trip's recalculated pricing, and that answer
 * is passed straight up to the row behind this dialog. It is never displayed in
 * here and never interpreted: assigning a property is a planning decision, and
 * the money belongs in the Ritten pricing columns.
 *
 * ── A PROPERTY THE CONTAINER TYPE REQUIRES ──────────────────────────────────
 * Some assignments cannot be removed: a 20FL and a 20ST always carry Flat, and
 * the backend refuses to unassign it. The remove action is disabled for those,
 * with the reason beside it — a button that is always refused is worse than no
 * button.
 *
 * WHICH assignments those are is the backend's answer, carried on each one as
 * `isRequired`. Nothing here looks at a container type; the rule lives in one
 * place and this renders what it decided.
 * ────────────────────────────────────────────────────────────────────────────
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
   * The row behind this dialog shows its own compact list and its own pricing
   * columns, so this dialog reloading its own data is not enough to update it.
   * What travels up is what the BACKEND answered — the recalculated pricing
   * from the write, and the assignments re-read in the backend's display order
   * — never what this component believes it just did. The page patches that one
   * row; nothing refetches the list, so the operator keeps their filter, page,
   * period, selection and scroll position.
   */
  onChanged: (update: {
    /**
     * The Trip's complete effective pricing after the change, as the write
     * answered — or null when the Trip could not be priced, which is an
     * ordinary state rather than a failure of the assignment.
     *
     * Applied by the caller either way. Null blanks the row's amounts, because
     * the previous ones describe the Trip before this change and showing them
     * as current would be a stale figure nothing reveals.
     */
    pricing: EffectivePricing | null;
    /** Every assignment the Trip now carries, in the backend's display order. */
    assigned: TripCustomProperty[];
  }) => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loaded = useAsync(
    useCallback(
      (signal: AbortSignal) => listTripCustomProperties(trip.id, signal),
      [trip.id],
    ),
    [trip.id],
  );

  /*
   * The set as it stands after a change made in this dialog.
   *
   * It shadows the first load rather than replacing the hook: one read answers
   * both this list and the row behind it, so a tick costs a single request. The
   * ORDER is the backend's — nothing here sorts, because display order is a
   * configured rule and a second implementation of it would eventually disagree.
   */
  const [changed, setChanged] = useState<TripCustomProperty[] | null>(null);
  const assignments = changed ?? loaded.data ?? [];

  const assignable = useAsync(
    useCallback(
      (signal: AbortSignal) => listAssignableCustomProperties(signal),
      [],
    ),
    [],
  );

  const assignedIds = new Set(
    assignments.map((item) => item.customPropertyId),
  );
  const hasRequired = assignments.some((assignment) => assignment.isRequired);
  /*
   * Already assigned, or not the operator's to assign at all. The second is the
   * backend's classification, read rather than recomputed: Toll and Tunnel come
   * from the route configuration, TAR from the Pricing Engine and Flat from the
   * container type, so offering them would invite a choice the API refuses.
   *
   * Waiting time is deliberately unaffected — it is a Trip field with its own
   * editor on the row, not a property in this list.
   */
  const available = (assignable.data ?? []).filter(
    /*
     * `isAssignable` is the BACKEND's answer, not a rule restated here. It is
     * narrower than "not system-managed": TAR is system-owned and still
     * offered, because an operator may add an EXTRA TAR charge on top of the
     * automatic one, while Toll, Tunnel and Flat stay closed.
     */
    (property) => !assignedIds.has(property.id) && property.isAssignable,
  );

  /**
   * One assignment change, then the two authoritative answers it produced.
   *
   * The write already returned the Trip's recalculated pricing. The assignment
   * SET is read again rather than patched locally: display order is the
   * backend's, and a list this component reordered for itself would be the same
   * rule in two places.
   */
  async function run(
    id: string,
    operation: () => Promise<TripCustomPropertyMutation>,
  ) {
    setBusyId(id);
    setError(null);

    try {
      const { pricing } = await operation();
      const items = await listTripCustomProperties(trip.id);

      setChanged(items);
      onChanged({ pricing, assigned: items });
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

      {loaded.isLoading ? (
        <LoadingState label={t("ritten.custom.loading")} />
      ) : null}

      {!loaded.isLoading && loaded.error ? (
        <ErrorState error={loaded.error} onRetry={loaded.reload} />
      ) : null}

      {!loaded.isLoading && !loaded.error ? (
        <div className="px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("ritten.custom.assigned")}
          </h3>

          {assignments.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("ritten.custom.empty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {assignments.map((assignment) => (
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

                  {assignment.isRequired ? (
                    <span className="shrink-0 text-xs text-muted">
                      {t("ritten.custom.required")}
                    </span>
                  ) : (
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
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Said once, before anything is attempted, rather than as a refusal. */}
          {hasRequired ? (
            <p className="mt-2 text-[11px] text-muted">
              {t("ritten.custom.requiredHint")}
            </p>
          ) : null}

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
