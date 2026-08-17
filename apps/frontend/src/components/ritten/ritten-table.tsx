"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { TripStatusBadge } from "@/components/trips/trip-status-badge";
import { ApiError } from "@/lib/api/client";
import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip, Vehicle } from "@/lib/api/types";
import { toClockLabel } from "@/lib/calendar/clock";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { toFleetOptions, type FleetOption } from "@/lib/fleet-options";
import { useTranslation } from "@/lib/i18n/language-provider";
import { combinationClasses, combinationLabel } from "@/lib/ritten/combination";
import { toVehicleGroups } from "@/lib/ritten/vehicle-groups";
import {
  canEdit,
  canViewPdf,
  type RittenActions,
} from "@/lib/ritten/row-actions";
import { InlineCell, type InlineOption } from "./inline-cell";
import { WaitingTimeCell } from "./waiting-time-cell";
import { RowActionMenu } from "./row-action-menu";

/**
 * The Ritten table, with its editable cells.
 *
 * Every cell reads a field the Trip response already carried — including the
 * vehicle and the RESOLVED effective driver — so a table of any length costs
 * exactly the one request that fetched it.
 *
 * ── HOW EDITING WORKS ───────────────────────────────────────────────────────
 * Five cells are editable, and they are exactly the five `UpdateTripDto`
 * accepts that have a column here. Start and end time are NOT among them: the
 * backend documents both as parser-controlled and refuses them.
 *
 * Each cell hands its owner a string; the row below turns that into the field's
 * payload, and that is where the null semantics live — the backend documents
 * "send null to clear" per field, and an empty string means something else
 * entirely. Nothing is painted optimistically: the page refetches and the row
 * re-renders from what the backend actually stored.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** From the backend's create-trip.dto.ts, to catch a mistake before a round trip. */
const CONTAINER_NUMBER_MAX_LENGTH = 100;

const COLUMN_KEYS = [
  "ritten.select.row",
  "ritten.column.group",
  "ritten.column.status",
  "ritten.column.licensePlate",
  "ritten.column.date",
  "ritten.column.start",
  "ritten.column.end",
  "ritten.column.container",
  "ritten.column.containerType",
  "ritten.column.booking",
  "ritten.column.terminal",
  "ritten.column.address",
  "ritten.column.custom",
  "ritten.column.waitingTime",
  "ritten.column.pdf",
  "ritten.column.actions",
] as const;

export interface RittenTableProps {
  trips: readonly Trip[];
  actions: RittenActions;
  /** Active vehicles, fetched once for the page. */
  vehicles: readonly Vehicle[];
  /** The Trip a mutation is currently running for. */
  busyTripId: string | null;
  /** CLOSED Trips found to have no pricing snapshot after closing. */
  pricingAttentionTripIds: ReadonlySet<string>;
  /** The Trips ticked on the current page. */
  selectedTripIds: ReadonlySet<string>;
  onToggleSelection: (tripId: string) => void;
}

export function RittenTable(props: RittenTableProps) {
  const t = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1200px] text-left text-sm">
        <caption className="sr-only">{t("ritten.rows.title")}</caption>
        <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
          <tr>
            {COLUMN_KEYS.map((key) => (
              <th
                key={key}
                scope="col"
                className="whitespace-nowrap px-3 py-2 font-medium"
              >
                {/* The selection column is a control, not a heading. */}
                <span className={key === "ritten.select.row" ? "sr-only" : ""}>
                  {t(key)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {/*
          One body per truck, so a heading can name it.

          Separate <tbody> elements rather than a heading row inside one body:
          that is what the element is for, and it keeps the heading tied to the
          rows it introduces for a screen reader as well as visually.
        */}
        {toVehicleGroups(props.trips).map((group, index) => (
          <tbody key={`${group.licensePlate ?? "unassigned"}-${index}`}>
            <tr>
              <th
                scope="colgroup"
                colSpan={COLUMN_KEYS.length}
                className="border-b border-border bg-hover/40 px-3 py-1.5 text-left text-xs font-semibold text-secondary"
              >
                <span className="flex items-center gap-2">
                  {group.displayColor ? (
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: group.displayColor }}
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    />
                  ) : null}
                  {group.licensePlate ?? t("ritten.sort.noVehicle")}
                  <span className="font-normal text-muted">
                    ({group.trips.length})
                  </span>
                </span>
              </th>
            </tr>

            {group.trips.map((trip) => (
              <RittenRow key={trip.id} trip={trip} {...props} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RittenRow({
  trip,
  actions,
  vehicles,
  busyTripId,
  pricingAttentionTripIds,
  selectedTripIds,
  onToggleSelection,
}: RittenTableProps & { trip: Trip }) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");
  const isEditable = canEdit(trip);
  const isBusy = busyTripId === trip.id;

  const save = (payload: UpdateTripPayload) => actions.saveTrip(trip.id, payload);

  return (
    <tr
      className={[
        "border-b border-border align-top last:border-0",
        // A selected row stays legible: a tint, not a fill, and one that reads
        // in both themes.
        selectedTripIds.has(trip.id) ? "bg-primary/10" : "hover:bg-hover",
      ].join(" ")}
      /*
       * The vehicle's own colour, as a stripe rather than a fill: one truck
       * stays recognisable down the list without tinting text that has to
       * remain readable in both themes. The value is data, so it can only come
       * from an inline style.
       */
      style={
        trip.vehicle
          ? { boxShadow: `inset 3px 0 0 0 ${trip.vehicle.displayColor}` }
          : undefined
      }
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selectedTripIds.has(trip.id)}
          onChange={() => onToggleSelection(trip.id)}
          aria-label={`${t("ritten.select.row")} ${trip.bookingNumber}`}
          className="h-4 w-4 rounded border-border accent-primary"
        />
      </td>

      <td className="px-3 py-2">
        {trip.tripGroupId ? (
          <button
            type="button"
            onClick={() => actions.openCombination(trip.tripGroupId as string)}
            title={t("ritten.group.open")}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${combinationClasses(trip.tripGroupId)}`}
          >
            {combinationLabel(trip.tripGroupId)}
          </button>
        ) : (
          <span className="text-xs text-muted">{t("ritten.group.none")}</span>
        )}
      </td>

      <td className="px-3 py-2">
        <TripStatusBadge status={trip.status} label={t(`status.${trip.status}`)} />
        {pricingAttentionTripIds.has(trip.id) ? (
          <span
            role="status"
            className="mt-1 block max-w-40 text-[11px] font-medium text-warning"
          >
            {t("ritten.feedback.pricingAttention")}
          </span>
        ) : null}
      </td>

      <td className="px-3 py-2">
        <VehicleCell
          trip={trip}
          vehicles={vehicles}
          isEditable={isEditable && !isBusy}
          onSave={save}
        />
      </td>

      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">
        <InlineCell
          label={t("ritten.edit.planningDate")}
          displayValue={formatCalendarDate(trip.planningDate) ?? empty}
          editValue={trip.planningDate ?? ""}
          kind="date"
          isDisabled={!isEditable || isBusy}
          onSave={(value) => save({ planningDate: requireValue(value, t) })}
        />
      </td>

      {/* Parser-controlled: the backend refuses both, so they are read-only. */}
      <td className="px-3 py-2 tabular-nums text-secondary">
        {trip.startTime ? toClockLabel(trip.startTime) : empty}
      </td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        {trip.endTime ? toClockLabel(trip.endTime) : empty}
      </td>

      <td className="px-3 py-2 text-secondary">
        <InlineCell
          label={t("ritten.edit.containerNumber")}
          displayValue={trip.containerNumber ?? empty}
          editValue={trip.containerNumber ?? ""}
          maxLength={CONTAINER_NUMBER_MAX_LENGTH}
          isDisabled={!isEditable || isBusy}
          // Empty means "clear it", which the backend spells null.
          onSave={(value) =>
            save({ containerNumber: value.trim() === "" ? null : value.trim() })
          }
        />
      </td>

      <td className="px-3 py-2 text-secondary">{trip.containerType}</td>

      <td className="px-3 py-2">
        <Link
          href={`/trips/${trip.id}`}
          className="font-medium text-primary hover:underline"
        >
          {trip.bookingNumber}
        </Link>
      </td>

      <td className="px-3 py-2 text-secondary">{trip.terminal ?? empty}</td>
      <td className="px-3 py-2 text-secondary">
        {trip.destinationCity}, {trip.destinationCountry}
      </td>

      <td className="px-3 py-2">
        <CustomPropertiesCell trip={trip} actions={actions} />
      </td>

      {/*
        Hours and minutes on screen, one integer in the database. The
        conversion is `waiting-time.ts`, shared with the Trip detail page.
      */}
      <td className="px-3 py-2 tabular-nums text-secondary">
        <WaitingTimeCell
          totalMinutes={trip.waitingTimeMinutes}
          isDisabled={!isEditable || isBusy}
          onSave={(totalMinutes) => save({ waitingTimeMinutes: totalMinutes })}
        />
      </td>

      <td className="px-3 py-2">
        <PdfCell trip={trip} actions={actions} isBusy={isBusy} />
      </td>

      <td className="px-3 py-2">
        {/*
          The booking number in this row is already a link to the Trip, so a
          second "open" control here was the same navigation twice. The menu is
          what this column is for.
        */}
        <RowActionMenu trip={trip} actions={actions} isBusy={isBusy} />
      </td>
    </tr>
  );
}

/** Beyond this the cell would widen the row more than it informs it. */
const VISIBLE_CUSTOM_PROPERTIES = 2;

/**
 * What this Trip is carrying, without opening anything.
 *
 * The cell used to be a bare "beheren" link, so the only way to learn whether a
 * Trip had any Custom Properties at all was to open the dialog for it — once
 * per Trip. The names now travel with the Trip itself (the list response embeds
 * them), so the column can answer the question it was named after.
 *
 * Only the first few names fit a table cell, so the rest are counted rather
 * than wrapped. The full set is one click away, and the title attribute carries
 * it for anyone hovering.
 */
function CustomPropertiesCell({
  trip,
  actions,
}: {
  trip: Trip;
  actions: RittenActions;
}) {
  const t = useTranslation();
  const assigned = trip.customProperties;
  const visible = assigned.slice(0, VISIBLE_CUSTOM_PROPERTIES);
  const hiddenCount = assigned.length - visible.length;

  return (
    <button
      type="button"
      onClick={() => actions.openCustomProperties(trip)}
      title={
        assigned.length > 0
          ? assigned.map((property) => property.name).join(", ")
          : t("ritten.custom.open")
      }
      aria-label={`${t("ritten.custom.open")} ${trip.bookingNumber}`}
      className="flex max-w-40 flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-hover"
    >
      {assigned.length === 0 ? (
        <span className="text-xs font-medium text-primary hover:underline">
          {t("ritten.custom.open")}
        </span>
      ) : (
        <>
          {visible.map((property) => (
            <span
              key={property.id}
              className={[
                "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium",
                // A deactivated property still applies to this Trip — the
                // assignment stands — so it is muted rather than hidden.
                property.isActive
                  ? "bg-primary/10 text-primary"
                  : "bg-hover text-muted line-through",
              ].join(" ")}
            >
              {property.name}
            </span>
          ))}

          {hiddenCount > 0 ? (
            <span className="text-[11px] font-medium text-secondary">
              +{hiddenCount}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}

/**
 * The source document, as two things you can do with it.
 *
 * "Aanwezig" told an operator that a PDF exists but not how to reach it, so the
 * only way in was the action menu. These are the same two actions, one click
 * away. They stay visible but disabled when there is no document, so the column
 * keeps its shape down the list and the absence is stated rather than implied
 * by a gap.
 */
function PdfCell({
  trip,
  actions,
  isBusy,
}: {
  trip: Trip;
  actions: RittenActions;
  isBusy: boolean;
}) {
  const t = useTranslation();
  const hasPdf = canViewPdf(trip);

  return (
    <span className="flex items-center gap-1">
      <PdfButton
        label={`${t("ritten.menu.viewPdf")} ${trip.bookingNumber}`}
        isDisabled={!hasPdf || isBusy}
        onClick={() => actions.openPdf(trip)}
      >
        {/* An open document. */}
        <path d="M4 3.5h5.5L14 8v8.5H4z" />
        <path d="M9.5 3.5V8H14" />
      </PdfButton>

      <PdfButton
        label={`${t("ritten.menu.downloadPdf")} ${trip.bookingNumber}`}
        isDisabled={!hasPdf || isBusy}
        onClick={() => {
          // The page reports every failure in its own feedback line; an icon
          // has nothing to keep open, so the rejection ends here rather than
          // becoming an unhandled promise.
          void actions.downloadPdf(trip).catch(() => undefined);
        }}
      >
        {/* An arrow onto a baseline. */}
        <path d="M9 3.5v8m0 0 3-3m-3 3-3-3" />
        <path d="M4 14.5h10" />
      </PdfButton>

      {hasPdf ? null : (
        <span className="sr-only">{t("ritten.value.noPdf")}</span>
      )}
    </span>
  );
}

function PdfButton({
  label,
  isDisabled,
  onClick,
  children,
}: {
  label: string;
  isDisabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={isDisabled}
      onClick={onClick}
      className="rounded-md p-1 text-secondary hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 18 18"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

/**
 * The plate and, under it, the driver that follows from it.
 *
 * ── ONLY THE VEHICLE IS CHOSEN HERE ─────────────────────────────────────────
 * A Trip is planned onto a TRUCK. Who drives that truck is decided once, on the
 * vehicle, as a Driver assignment with a validity period — so the driver shown
 * here is read-only and always comes from `effectiveDriver`, which the backend
 * resolved from the Trip's own planning date.
 *
 * Choosing a driver per Trip is deliberately gone: it let the same truck carry
 * two different drivers on one day with nothing to say which was true, and it
 * made the assignment screen advisory rather than authoritative. Changing a
 * driver now means changing the assignment, in one place.
 * ────────────────────────────────────────────────────────────────────────────
 */
function VehicleCell({
  trip,
  vehicles,
  isEditable,
  onSave,
}: {
  trip: Trip;
  vehicles: readonly Vehicle[];
  isEditable: boolean;
  onSave: (payload: UpdateTripPayload) => Promise<void>;
}) {
  const t = useTranslation();

  const vehicleOptions = toInlineOptions(
    toFleetOptions(
      vehicles,
      (vehicle) => vehicle.licensePlate,
      trip.vehicleId,
      trip.vehicle?.licensePlate,
    ),
    t("ritten.edit.none"),
    t("ritten.value.inactive"),
  );

  return (
    <span className="block">
      <InlineCell
        label={t("ritten.edit.vehicle")}
        displayValue={
          trip.vehicle ? (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                style={{ backgroundColor: trip.vehicle.displayColor }}
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              />
              <span className="whitespace-nowrap text-foreground">
                {trip.vehicle.licensePlate}
              </span>
              {trip.vehicle.isActive ? null : (
                <span className="text-[11px] text-muted">
                  ({t("ritten.value.inactive")})
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs font-medium text-warning">
              {t("ritten.value.noVehicle")}
            </span>
          )
        }
        editValue={trip.vehicleId ?? ""}
        options={vehicleOptions}
        isDisabled={!isEditable}
        onSave={(value) => onSave({ vehicleId: value === "" ? null : value })}
      />

      {trip.effectiveDriver ? (
        <span className="mt-0.5 flex items-center gap-1.5 text-xs">
          <span className="text-secondary">{trip.effectiveDriver.name}</span>
          {trip.effectiveDriver.isActive ? null : (
            <span className="text-[11px] text-muted">
              ({t("ritten.value.inactive")})
            </span>
          )}
        </span>
      ) : (
        <span className="mt-0.5 block text-xs text-muted">
          {t("ritten.value.noDriver")}
        </span>
      )}
    </span>
  );
}

function toInlineOptions(
  options: FleetOption[],
  emptyLabel: string,
  inactiveLabel: string,
): InlineOption[] {
  return [
    { value: "", label: emptyLabel },
    ...options.map((option) => ({
      value: option.value,
      label: option.isCurrentInactive
        ? `${option.label} (${inactiveLabel})`
        : option.label,
    })),
  ];
}

/**
 * A field the backend has no null for.
 *
 * The planning date is required, so an emptied box is a mistake rather than an
 * instruction. Refusing it here keeps the cell open with a message instead of
 * sending a request that can only fail.
 */
function requireValue(value: string, t: (key: "ritten.edit.required") => string): string {
  if (value.trim() === "") {
    throw new ApiError("VALIDATION_FAILED", t("ritten.edit.required"), 400);
  }

  return value;
}
