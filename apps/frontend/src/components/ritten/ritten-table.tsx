"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { LosritBadge } from "@/components/trips/losrit-badge";
import { PaymentBadge } from "@/components/trips/payment-badge";
import { TripStatusBadge } from "@/components/trips/trip-status-badge";
import { HoverNote } from "@/components/ui/hover-note";
import { ApiError } from "@/lib/api/client";
import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip, Vehicle } from "@/lib/api/types";
import { CopyButton } from "@/components/ui/copy-button";
import { PricingCells } from "@/components/ritten/pricing-cells";
import { toClockLabel } from "@/lib/calendar/clock";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { toFleetOptions, type FleetOption } from "@/lib/fleet-options";
import { toVehicleLabel } from "@/lib/fleet/vehicle-label";
import { useTranslation } from "@/lib/i18n/language-provider";
import { combinationClasses, combinationLabel } from "@/lib/ritten/combination";
import { toVehicleGroups } from "@/lib/ritten/vehicle-groups";
import { toCostConfirmationLabel } from "@/lib/trips/cost-confirmation";
import {
  UPDATED_FIELD_CLASS,
  changedByLatestUpdate,
  isRevised,
  type UpdatedField,
} from "@/lib/trips/latest-update";
import {
  canEdit,
  canEditDestination,
  canViewPdf,
  type RittenActions,
} from "@/lib/ritten/row-actions";
import { InlineCell, type InlineOption } from "./inline-cell";
import { WaitingTimeCell } from "./waiting-time-cell";
import type { WhatsAppStatus } from "@/lib/api/whatsapp";
import { RowLifecycleActions } from "./row-lifecycle-actions";

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
/** Likewise TAR_NUMMER_MAX_LENGTH there. A ceiling, never a format. */
const TAR_NUMMER_MAX_LENGTH = 100;
/** City and country are 200 each there; this field carries both with a comma. */
const DESTINATION_FIELD_MAX_LENGTH = 401;

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
  /*
   * What Eucon CONFIRMED for this Trip, beside the buttons rather than among
   * the prices.
   *
   * It used to live in the pricing block and disappeared with it. That was
   * wrong for what the operator does with it: a confirmation is the answer to
   * a waiting time they reported, and they check it while working the list —
   * not only when they have turned prices on to look at margins. So it is an
   * operational column now, always present, and still read-only.
   */
  "ritten.column.costConfirmation",
] as const;

/**
 * The pricing columns, to the RIGHT of every operational column.
 *
 * They are appended rather than woven in, so the columns an operator works in
 * every day never move when prices are shown. The table already scrolls
 * horizontally; these live at the end of that scroll.
 *
 * The names are the ones the Excel export already uses — Tarief, Brandstof,
 * Backload, Tol, Tunnel, Others, EK — so one vocabulary covers the screen and
 * the spreadsheet.
 */
const PRICING_COLUMN_KEYS = [
  "ritten.column.tarief",
  "ritten.column.brandstof",
  "ritten.column.backload",
  "ritten.column.tol",
  "ritten.column.tunnel",
  "ritten.column.others",
  "ritten.column.ek",
  "ritten.column.totaal",
] as const;

export interface RittenTableProps {
  trips: readonly Trip[];
  actions: RittenActions;
  /** Active vehicles, fetched once for the page. */
  vehicles: readonly Vehicle[];
  /** The Trip a mutation is currently running for. */
  busyTripId: string | null;
  /** The Trips ticked on the current page. */
  selectedTripIds: ReadonlySet<string>;
  onToggleSelection: (tripId: string) => void;
  /**
   * Whether the pricing columns are shown at all.
   *
   * When false they are not rendered — not blanked, not masked. A column of
   * asterisks still tells the room that a price exists and roughly how it is
   * shaped; an absent column tells them nothing, which is the point.
   */
  showPricing: boolean;
  /** Whether WhatsApp can deliver, for the send button. One value per page. */
  whatsAppStatus: WhatsAppStatus;
  /** Opens the delete confirmation. A row never deletes anything itself. */
  onDeleteTrip: (trip: Trip) => void;
  /** Opens the reopen confirmation, for a CANCELLED Trip. */
  onReopenTrip: (trip: Trip) => void;
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
                className={[
                  "whitespace-nowrap px-3 py-2 font-medium",
                  // The container column reserves the width its values need;
                  // see the cell below for why they must not wrap.
                  key === "ritten.column.container" ? "min-w-[9.5rem]" : "",
                ].join(" ")}
              >
                {/* The selection column is a control, not a heading. */}
                <span className={key === "ritten.select.row" ? "sr-only" : ""}>
                  {t(key)}
                </span>
              </th>
            ))}
            {props.showPricing
              ? PRICING_COLUMN_KEYS.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-right font-medium"
                  >
                    {t(key)}
                  </th>
                ))
              : null}
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
                colSpan={
                  COLUMN_KEYS.length +
                  (props.showPricing ? PRICING_COLUMN_KEYS.length : 0)
                }
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
  selectedTripIds,
  onToggleSelection,
  showPricing,
  whatsAppStatus,
  onDeleteTrip,
  onReopenTrip,
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
        /*
         * A finished transport is marked, and marked in the row.
         *
         * The tint says one thing only: this Trip has been carried out. It is
         * deliberately a whole-row wash of the WARNING token at low opacity,
         * because it describes the row rather than any single value — which is
         * what keeps it distinguishable from a field-level highlight, and why
         * it never darkens the text it sits behind.
         *
         * Selection wins while it applies: the operator is acting on those
         * rows now, and that is the more urgent fact.
         */
        selectedTripIds.has(trip.id)
          ? "bg-primary/10"
          : trip.status === "CLOSED"
            ? "bg-warning/10 hover:bg-warning/20"
            : "hover:bg-hover",
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
        <span className="flex flex-wrap items-center gap-1">
          <TripStatusBadge
            status={trip.status}
            label={t(`status.${trip.status}`)}
          />
          {/*
            LOSRIT sits BESIDE the status, never instead of it: it says what
            kind of transport this is, not what has happened to it. A LOSRIT is
            OPEN, CLOSED or CANCELLED like any other Trip.
          */}
          <LosritBadge trip={trip} onRemove={actions.removeLosrit} />
          {/*
            BETAALD / NIET BETAALD, beside the status for the same reason LOSRIT
            is: it is a separate classification, not a lifecycle state. The
            badge IS the toggle — one click, saved immediately, no dialog.
          */}
          <PaymentBadge
            trip={trip}
            isDisabled={isBusy}
            onToggle={actions.changePayment}
          />
        </span>
        {/*
          "Bijgewerkt" is DERIVED, and beside the status rather than instead of
          it: the lifecycle is still OPEN. It says a document changed this Trip
          after it was planned, which is what the yellow fields below detail.
        */}
        {isRevised(trip) ? (
          <span className="mt-1 block text-[11px] font-medium text-warning">
            {t("ritten.status.revised")}
          </span>
        ) : null}
        {/*
          There is deliberately NO "this Trip has no price" marker here.
          Completing a Trip whose route is not configured is legitimate finished
          work, and saying so beside the status read as a failure of the
          completion. The absence of a price shows where prices show — the
          pricing cells stay empty — and Opnieuw verwerken remains available.
        */}
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

      <td className="px-3 py-2 tabular-nums text-secondary">
        <UpdatedValue trip={trip} field="startTime">
          <TransportTimeCell
            trip={trip}
            field="startTime"
            label={t("ritten.edit.startTime")}
            isBusy={isBusy}
            onSave={save}
          />
        </UpdatedValue>
      </td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        <UpdatedValue trip={trip} field="endTime">
          <TransportTimeCell
            trip={trip}
            field="endTime"
            label={t("ritten.edit.endTime")}
            isBusy={isBusy}
            onSave={save}
          />
        </UpdatedValue>
      </td>

      {/*
        ── ONE LINE, ALWAYS ──────────────────────────────────────────────────
        A container number is a single identifier that happens to contain a
        space and a slash: `CNEU 452297/0`. In a narrow column the browser
        breaks it at BOTH — after the space, and after the slash, which leaves a
        line ending in a stray "/" that reads like a typo or an escape
        character. Two lines also make a column of them impossible to scan.

        `whitespace-nowrap` on the cell, and a minimum width that fits the
        format, so it never wraps. The STORED VALUE IS UNTOUCHED: nothing is
        stripped, replaced or normalised here — the fix is that the text is
        allowed the room it needs.
        ──────────────────────────────────────────────────────────────────────
      */}
      <td className="w-[9.5rem] min-w-[9.5rem] whitespace-nowrap px-3 py-2 text-secondary">
        <UpdatedValue trip={trip} field="containerNumber">
          <InlineCell
            label={t("ritten.edit.containerNumber")}
            displayValue={trip.containerNumber ?? empty}
            editValue={trip.containerNumber ?? ""}
            maxLength={CONTAINER_NUMBER_MAX_LENGTH}
            isDisabled={!isEditable || isBusy}
            // Empty means "clear it", which the backend spells null.
            onSave={(value) =>
              save({
                containerNumber: value.trim() === "" ? null : value.trim(),
              })
            }
          />
        </UpdatedValue>
        {/*
          UNDERNEATH the number rather than in front of it, so the value still
          begins where the eye scans down the column. Absent when there is no
          container: a copy button for nothing would copy an empty string.

          It sits OUTSIDE `InlineCell`, so opening the editor and copying stay
          separate actions — the cell keeps its own click behaviour untouched.
        */}
        {trip.containerNumber ? (
          <span className="mt-0.5 flex">
            <CopyButton
              value={trip.containerNumber}
              label={t("ritten.copy.containerNumber")}
            />
          </span>
        ) : null}
      </td>

      <td className="px-3 py-2 text-secondary">
        <UpdatedValue trip={trip} field="containerType">
          {trip.containerType}
        </UpdatedValue>
      </td>

      {/*
        The booking number, with the Trip's internal notes on hover and on
        focus.

        The LINK is untouched: same target, same styling, same keyboard
        behaviour. `HoverNote` wraps it rather than replacing it, so navigating
        to the Trip works exactly as it did and the note is additional rather
        than in the way.

        The note travels on the Trip the list already returned, so showing it
        costs no request — not one per row, and not one on hover.
      */}
      <td className="px-3 py-2">
        <HoverNote
          label={t("ritten.notes.label")}
          note={trip.internalNotes}
        >
          <Link
            href={`/trips/${trip.id}`}
            className="font-medium text-primary hover:underline"
          >
            {trip.bookingNumber}
          </Link>
        </HoverNote>
        {/*
          SIBLINGS of the link, not children of it: a button inside an anchor is
          not something a browser or a screen reader can make sense of, and the
          navigation must keep working exactly as it did.

          Copy stays exactly where it was; the notes pencil sits beside it. The
          pencil is offered even on a row with no booking number — a Trip always
          has notes — which is why only the copy button is conditional.
        */}
        <span className="mt-0.5 flex items-center gap-1">
          {trip.bookingNumber ? (
            <CopyButton
              value={trip.bookingNumber}
              label={t("ritten.copy.bookingNumber")}
            />
          ) : null}

          {/*
            Opens the SAME `internalNotes` the detail page edits. It is the note
            the hover panel above already shows, so this needs no request of its
            own — and after a save the row is patched from the response, which
            is what makes the hover current immediately.
          */}
          <button
            type="button"
            onClick={() => actions.openNotes(trip)}
            disabled={!isEditable || isBusy}
            title={t("ritten.notes.edit")}
            aria-label={`${t("ritten.notes.edit")} ${trip.bookingNumber ?? ""}`.trim()}
            className="inline-flex items-center rounded p-0.5 text-muted hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <PencilIcon />
          </button>
        </span>

        {/*
          TAR-nummer, directly under the booking number it belongs beside.

          An ordinary editable cell — the same `InlineCell` every other free-text
          field on this row uses, so it opens, saves and cancels identically. It
          carries no format and no uniqueness check: the backend accepts whatever
          is typed, and turns a whitespace-only entry into null so "empty" has
          one meaning. Clearing the box is therefore how a TAR-nummer is removed.

          Below the link and the copy button rather than inside them, so the
          navigation and the copy action keep working exactly as they did.
        */}
        <span className="mt-0.5 flex">
          <InlineCell
            label={t("ritten.edit.tarNummer")}
            displayValue={trip.tarNummer ?? empty}
            editValue={trip.tarNummer ?? ""}
            maxLength={TAR_NUMMER_MAX_LENGTH}
            isDisabled={!isEditable || isBusy}
            // Empty means "clear it", which the backend spells null.
            onSave={(value) =>
              save({ tarNummer: value.trim() === "" ? null : value.trim() })
            }
          />
        </span>
      </td>

      <td className="px-3 py-2 text-secondary">
        <UpdatedValue trip={trip} field="terminal">
          {trip.terminal ?? empty}
        </UpdatedValue>
      </td>
      <td className="px-3 py-2 text-secondary">
        <UpdatedValue trip={trip} field="destinationCity">
          <DestinationCell trip={trip} isBusy={isBusy} onSave={save} />
        </UpdatedValue>
      </td>

      {/*
        THERE IS NO ROUTE COLUMN, and that is deliberate.

        The Trip still HAS a canonical route: the backend derives it, Excel
        prints it, and pricing matches on it. It is simply not shown here. The
        two ends it is built from — the terminal and the destination — are
        already columns of their own and are the fields an operator actually
        edits, so a third column restating them directionally added width to
        every row without adding an answer.

        Removing the column removed the RENDERING only. `Trip.route` and the
        shared backend calculation are untouched; see `lib/ritten/route-label`,
        which the Excel export still uses.
      */}

      <td className="px-3 py-2">
        <CustomPropertiesCell trip={trip} actions={actions} />
      </td>

      {/*
        The window it was read off, with the duration under it. All three are
        stored now; the backend derives the duration from the two times.
      */}
      <td className="px-3 py-2 tabular-nums text-secondary">
        <WaitingTimeCell
          trip={trip}
          isDisabled={!isEditable || isBusy}
          onSave={save}
        />
      </td>

      <td className="px-3 py-2">
        <PdfCell trip={trip} actions={actions} isBusy={isBusy} />
      </td>

      <td className="px-3 py-2">
        <RowLifecycleActions
          trip={trip}
          actions={actions}
          isBusy={isBusy}
          whatsAppStatus={whatsAppStatus}
          onDelete={onDeleteTrip}
          onReopen={onReopenTrip}
        />
      </td>

      <CostConfirmationCell trip={trip} actions={actions} isBusy={isBusy} />

      {showPricing ? (
        <PricingCells
          /*
           * The pricing the Trip carries. Either what the list delivered or
           * what a write answered with — the page lays one over the other
           * before a row ever reaches here, so this cell has one source and
           * computes nothing.
           */
          pricing={trip.pricing}
          isDisabled={isBusy}
          onSaveOverride={(componentCode, amount) =>
            actions.savePricingOverride(trip.id, componentCode, amount)
          }
          onResetOverride={(componentCode) =>
            actions.resetPricingOverride(trip.id, componentCode)
          }
        />
      ) : null}
    </tr>
  );
}

/**
 * Where this Trip is going.
 *
 * ── EDITABLE ONLY ON A TRIP CREATED BY HAND ─────────────────────────────────
 * The destination used to be read-only everywhere, described as
 * parser-controlled — which is only true where a parser exists. A Trip entered
 * by hand has no document, so a city typed wrongly at creation could never be
 * corrected: the transport stayed planned to the wrong place for the rest of
 * its life.
 *
 * An imported Trip still belongs to its document. A later UPDATE re-reads the
 * destination from the PDF, so anything typed here would be silently
 * overwritten — and the backend refuses it outright. The cell is therefore
 * read-only exactly where a save could not succeed, rather than offering an
 * edit that ends in a 409.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * City and country are one address and are edited as one field: moving a Trip
 * from Bousbecque to Venlo without its country would leave the two disagreeing.
 * "City, Country" is the same text the column already showed.
 */
function DestinationCell({
  trip,
  isBusy,
  onSave,
}: {
  trip: Trip;
  isBusy: boolean;
  onSave: (payload: UpdateTripPayload) => Promise<void>;
}) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");
  const parts = [trip.destinationCity, trip.destinationCountry].filter(
    (part): part is string => Boolean(part),
  );
  const display = parts.length > 0 ? parts.join(", ") : empty;

  if (!canEditDestination(trip)) {
    return <>{display}</>;
  }

  return (
    <InlineCell
      label={t("ritten.edit.destination")}
      displayValue={display}
      editValue={parts.join(", ")}
      maxLength={DESTINATION_FIELD_MAX_LENGTH}
      isDisabled={isBusy}
      onSave={(value) => onSave(toDestination(value))}
    />
  );
}

/**
 * One end of the TRANSPORT window.
 *
 * ── NOT THE WAITING TIME ────────────────────────────────────────────────────
 * These are the hours the transport itself is planned for, as the order states
 * them. The waiting time is a different thing entirely — entered as its own two
 * clock times in its own column and stored as `waitingTimeMinutes` — and
 * nothing here reads or writes it.
 *
 * ── EDITABLE ON ANY TRIP, LIKE THE DATE BESIDE IT ───────────────────────────
 * These were briefly treated like the destination and refused on an imported
 * Trip. They are not: Begin and Eind are planning an operator adjusts as a day
 * unfolds, exactly like the planning date in the next column. A later UPDATE
 * document may still revise them, and until one does the operator's value
 * stands — an edit here is an operator edit and writes no revision history.
 *
 * There is deliberately NO check that the end follows the start. A transport
 * running past midnight is ordinary, and a single-time order — "21/08/2026
 * 15:00" — carries 15:00 in both fields; refusing that here would refuse
 * planning the parser itself produces. Each field moves on its own.
 * ────────────────────────────────────────────────────────────────────────────
 */
function TransportTimeCell({
  trip,
  field,
  label,
  isBusy,
  onSave,
}: {
  trip: Trip;
  field: "startTime" | "endTime";
  label: string;
  isBusy: boolean;
  onSave: (payload: UpdateTripPayload) => Promise<void>;
}) {
  const t = useTranslation();
  const empty = t("ritten.value.empty");
  const stored = trip[field];
  const display = stored ? (toClockLabel(stored) as string) : empty;

  if (!canEdit(trip)) {
    return <>{display}</>;
  }

  return (
    <InlineCell
      label={label}
      displayValue={display}
      // `HH:MM` is what an <input type="time"> exchanges; the backend sends
      // `HH:MM:SS`.
      editValue={stored ? (toClockLabel(stored) as string) : ""}
      kind="time"
      // Saved the moment the field is left: a time an operator has finished
      // typing is the decision, and a Save button after it is a second click
      // for something already said.
      savesOnBlur
      isDisabled={isBusy}
      // An emptied box means "no time recorded", which the backend spells null.
      onSave={(value) =>
        onSave({ [field]: value.trim() === "" ? null : value.trim() })
      }
    />
  );
}

/**
 * Splits "Venlo, Netherlands" into the two columns the backend stores.
 *
 * Only the FIRST comma separates them: a city may contain one — "Saint Laurent
 * Blangy, Pas-de-Calais, France" is a city and a country, not three fields —
 * so everything after the first comma is the country. Text with no comma is a
 * city alone, and the country is cleared rather than left behind pointing at a
 * place the Trip no longer goes to.
 */
export function toDestination(value: string): UpdateTripPayload {
  const separator = value.indexOf(",");

  if (separator === -1) {
    const city = value.trim();

    return {
      destinationCity: city === "" ? null : city,
      destinationCountry: null,
    };
  }

  const city = value.slice(0, separator).trim();
  const country = value.slice(separator + 1).trim();

  return {
    destinationCity: city === "" ? null : city,
    destinationCountry: country === "" ? null : country,
  };
}

/**
 * What Eucon has confirmed for this Trip, if anything.
 *
 * The number and the amount together, because either alone is ambiguous: an
 * amount with no CC number cannot be traced, and a number with no amount says
 * nothing. There is at most ONE — a Trip's waiting time is confirmed once.
 *
 * Read-only, and always visible: it does not follow the pricing toggle, because
 * an operator checks a confirmation while working the list rather than while
 * looking at margins. An empty marker means nothing has been confirmed, which
 * is not the same as an amount of zero — and a Trip with none shows no button
 * either, rather than a disabled icon pointing at a document that does not
 * exist.
 *
 * ── THE BUTTON OPENS THE CONFIRMATION, NOT THE ORDER ────────────────────────
 * `confirmation.pdfDocumentId` is the confirmation's OWN document. The Trip's
 * own `pdfDocumentId` is the transport order it came from, and the two are
 * never the same file — opening the order here would show an operator a
 * transport order where they asked to see the money.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It costs no request of its own. The confirmation travels on the Trip the list
 * endpoint already returned — id included — so a page of fifty rows is still
 * one call, and the button needs nothing fetched to decide whether to appear.
 */
function CostConfirmationCell({
  trip,
  actions,
  isBusy,
}: {
  trip: Trip;
  actions: RittenActions;
  isBusy: boolean;
}) {
  const t = useTranslation();
  const confirmation = trip.costConfirmation;

  if (!confirmation) {
    return (
      <td className="whitespace-nowrap px-3 py-2 text-right text-secondary">
        {t("ritten.value.empty")}
      </td>
    );
  }

  return (
    <td className="whitespace-nowrap px-3 py-2 text-right">
      <span className="inline-flex items-center gap-1">
        <PdfButton
          label={`${t("ritten.cc.viewPdf")} ${toCostConfirmationLabel(confirmation)}`}
          isDisabled={isBusy}
          onClick={() => actions.openCostConfirmationPdf(trip)}
        >
          {/* An open document. */}
          <path d="M4 3.5h5.5L14 8v8.5H4z" />
          <path d="M9.5 3.5V8H14" />
        </PdfButton>

        <span className="text-[11px] text-muted">
          {toCostConfirmationLabel(confirmation)}
        </span>{" "}
        <span className="font-medium tabular-nums text-foreground">
          {confirmation.amount}
        </span>
      </span>
    </td>
  );
}

/**
 * A value the latest UPDATE document moved.
 *
 * The mark is on the VALUE rather than the row: a row wash already means
 * "completed", and the two must stay tellable apart. An unchanged value renders
 * exactly as it did before — no wrapper, no spacing shift — so the marker is
 * the only difference an operator sees.
 *
 * Whether a field changed is the backend's answer, carried on the Trip. This
 * compares nothing.
 */
function UpdatedValue({
  trip,
  field,
  children,
}: {
  trip: Trip;
  field: UpdatedField;
  children: ReactNode;
}) {
  const t = useTranslation();

  if (!changedByLatestUpdate(trip, field)) {
    return <>{children}</>;
  }

  return (
    <span className={UPDATED_FIELD_CLASS} title={t("ritten.status.revisedField")}>
      {children}
    </span>
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
 *
 * ── A TRIP WITH NONE SAYS NOTHING ───────────────────────────────────────────
 * It shows the same empty marker every other column uses. It used to read
 * "Custom waarden beheren", which was an instruction sitting in a data column:
 * down a list it looked like a value, and a column of identical blue prompts
 * said nothing about which Trips actually carry anything.
 *
 * The cell stays clickable, and its accessible name still says what opening it
 * does — nothing about managing Custom Properties is removed, here or on the
 * Trip detail page. Only the visible prompt is gone.
 * ────────────────────────────────────────────────────────────────────────────
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
        <span className="text-secondary">{t("ritten.value.empty")}</span>
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
 *
 * ── THE PLATE SAVES ITSELF ──────────────────────────────────────────────────
 * Picking a truck persists immediately: there is no Save step, because a choice
 * from a list is already the whole decision. The driver underneath follows from
 * the backend's own resolution after the refetch — it is never worked out here,
 * and no VehicleAssignment is touched by planning a Trip onto a truck.
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
      // The plate AND today's driver — the same `currentDriver` the Voertuigen
      // list shows, so the two can never name different people.
      toVehicleLabel,
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
        // Choosing a truck IS the decision; there is nothing further to confirm.
        savesOnSelect
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

/**
 * A pencil over a line: the shape every application uses for "edit".
 *
 * Sized and stroked to match `CopyButton`, which sits directly beside it — two
 * controls of visibly different weight on one line read as two different kinds
 * of thing, and these are the same kind.
 */
function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 3.5a1.77 1.77 0 0 1 2.5 2.5L7.5 14.5 4 16l1.5-3.5Z" />
      <path d="M12 5 15 8" />
    </svg>
  );
}
