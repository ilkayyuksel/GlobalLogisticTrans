import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { toClockLabel } from "@/lib/calendar/clock";
import { formatWaitingTime } from "@/lib/waiting-time";
import { toRouteLabels } from "./export-route-labels";
import { toRouteText } from "./route-label";
import { toPricedTripLines, type PricedTripLines } from "./pricing-lines";

/**
 * What one Trip becomes in each export, before any spreadsheet is involved.
 *
 * Kept apart from the workbook writing so the BUSINESS decisions — which value
 * belongs in which column, what an absent value means, how a route reads — can
 * be tested without opening a file, and so the two exports share one definition
 * of each of them.
 *
 * Nothing here calculates money. Every amount comes from a stored pricing line;
 * see `pricing-lines.ts`.
 */

/** A cell with nothing in it. Never "null", "N/A" or an invented value. */
export const EMPTY_CELL = "";

export interface PricingExportRow {
  /** `YYYY-MM-DD`, or null. The workbook turns it into a real date cell. */
  readonly planningDate: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly containerType: string;
  readonly bookingNumber: string;
  readonly containerNumber: string;
  readonly startPoint: string;
  readonly trip: string;
  readonly endPoint: string;
  readonly basePrice: number | null;
  /** The configured percentage, as a fraction for Excel's percent format. */
  readonly fuelPercentage: number | null;
  readonly fuelAmount: number | null;
  readonly backload: number | null;
  readonly toll: number | null;
  readonly tunnel: number | null;
  readonly others: number | null;
  readonly waitingTime: number | null;
  /** The confirmed cost. Its own column, which used to hold the waiting time. */
  readonly ek: number | null;
  readonly remarks: string;
}

export interface BasicExportRow {
  /**
   * The group this Trip belongs to, or null.
   *
   * Not a column: it decides the ROW's background, so every cell of one
   * Combination carries the same colour — see `combinationColorIndex`, which
   * the Ritten list's own group tag uses. Presentation only; the export invents
   * no grouping and reads no membership of its own.
   */
  readonly tripGroupId: string | null;
  readonly licensePlate: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly bookingNumber: string;
  readonly containerType: string;
  readonly containerNumber: string;
  readonly trip: string;
  readonly costs: string;
  readonly info: string;
}

/**
 * The route, as an operator says it: where it starts, where it ends.
 *
 * ── THE CANONICAL ROUTE, NOT A LOCAL ONE ────────────────────────────────────
 * The two ends come from `trip.route`, which the backend derives from the
 * Trip's DIRECTION, its terminal and its destination city. So a delivery reads
 * `Quay 869 → Kallo` and a collection reads `Warneton → Quay 869`, the terminal
 * is already canonical, and the spreadsheet says exactly what the Ritten list
 * says. It used to be assembled here as terminal-then-city whatever the
 * direction, which described half the Trips backwards.
 *
 * No identifier appears, and no route is invented: a Trip missing either end
 * simply shows the end it has.
 */
export function toRouteLabel(trip: Trip): string {
  return toRouteText(trip, EMPTY_CELL);
}

/**
 * The Custom Properties assigned to a Trip, by their configured names.
 *
 * The names an administrator chose, in the order the backend returns them —
 * which is the operator's own display order. Nothing is renamed and no id
 * appears.
 */
export function toRemarks(trip: Trip): string {
  return trip.customProperties.map((property) => property.name).join(", ");
}

export function toPricingRow(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  fuelPercentage: number | null,
): PricingExportRow {
  const lines: PricedTripLines = toPricedTripLines(snapshot);
  /*
   * The two ends of the Trip in the operator's own vocabulary, decided by the
   * persisted direction and the Combination relationship — never by a terminal
   * name, a date or a row order. See `export-route-labels.ts`.
   */
  const route = toRouteLabels(trip);

  return {
    planningDate: trip.planningDate,
    startTime: trip.startTime,
    endTime: trip.endTime,
    containerType: trip.containerType ?? EMPTY_CELL,
    bookingNumber: trip.bookingNumber ?? EMPTY_CELL,
    containerNumber: trip.containerNumber ?? EMPTY_CELL,
    startPoint: route.startPoint,
    trip: toRouteLabel(trip),
    endPoint: route.endPoint,
    basePrice: lines.basePrice,
    /*
     * The percentage comes from configuration and the amount from the stored
     * line. Showing the percentage without a stored surcharge would suggest a
     * charge that was never made, so it appears only when the line does.
     */
    fuelPercentage: lines.fuel === null ? null : fuelPercentage,
    fuelAmount: lines.fuel,
    backload: lines.combination,
    toll: lines.toll,
    tunnel: lines.tunnel,
    others: lines.others,
    waitingTime: lines.waitingTime,
    ek: lines.ek,
    remarks: toRemarks(trip),
  };
}

/**
 * The costs an operator reads at a glance: "35.00 + 50.00 + 25.00".
 *
 * Only the fixed Custom Properties and the waiting time, which is what this
 * column was asked for. Base price, fuel, toll and tunnel are deliberately
 * absent — they belong to the pricing export, and mixing them in here would
 * make the sum mean something nobody asked about.
 *
 * The amounts are stored ones, joined; they are never added together.
 */
export function toCostsLabel(lines: PricedTripLines): string {
  const amounts = [...lines.customPropertyAmounts];

  if (lines.waitingTime !== null) {
    amounts.push(lines.waitingTime);
  }

  return amounts.map((amount) => amount.toFixed(2)).join(" + ");
}

/**
 * A loose trip, in the one word the office uses for it.
 *
 * LOSRIT belongs in INFO and nowhere else. It is an operational note about the
 * work — this Trip carries no container of its own — and NOT a lifecycle state,
 * so it never becomes a status or a column of its own in a workbook.
 */
export const LOOSE_TRIP_MARK = "LOSRIT";

/**
 * The waiting time as the printed sheet says it: `Wachttijd 07:00-10:00`.
 *
 * ── THE WINDOW, NOT A NEW CALCULATION ───────────────────────────────────────
 * These are the two clock times an operator actually read and the system
 * actually stored. Nothing here works out a duration and nothing here bills:
 * `waitingTimeMinutes` remains the stored value pricing charges from, and this
 * only says where it came from.
 *
 * A Trip whose waiting time was entered before the window was recorded has no
 * two times to show, so it falls back to the duration it does have. Inventing a
 * window for it would put hours on a page that nobody ever read off a clock.
 */
export function toWaitingLabel(
  trip: Trip,
  waitingWord: string,
): string | null {
  const begin = toClockLabel(trip.waitingTimeStart);
  const end = toClockLabel(trip.waitingTimeEnd);

  if (begin && end) {
    return `${waitingWord} ${begin}-${end}`;
  }

  const duration = formatWaitingTime(trip.waitingTimeMinutes);

  return duration ? `${waitingWord} ${duration}` : null;
}

/**
 * The words behind those numbers, in the same order.
 *
 * ── WHICH PROPERTIES ARE NAMED ──────────────────────────────────────────────
 * The ones an operator ASSIGNED, and only those. Two kinds are left out, for
 * two different reasons:
 *
 *   ROUTE-PRICED (Toll, Tunnel) — not part of the Kosten sum at all, so naming
 *     one here would explain a number that is not there;
 *   SYSTEM-MANAGED (TAR, Flat)  — not an operator's decision. Flat is written
 *     by the container-type rule and TAR by the Engine itself, so listing them
 *     among the properties somebody chose would misrepresent who decided what.
 *     Their amounts are still in Kosten; this column is about choices.
 *
 * Both exclusions come from the catalog rather than from a list of names here —
 * see `toManualPropertyIds`.
 */
export function toInfoLabel(
  trip: Trip,
  lines: PricedTripLines,
  manualPropertyIds: ReadonlySet<string>,
  waitingLabel: string | null,
  wasTarCharged = false,
): string {
  const names: string[] = [];

  // First, because it changes what the driver is being sent to do.
  if (trip.isLooseTrip) {
    names.push(LOOSE_TRIP_MARK);
  }

  names.push(
    ...trip.customProperties
      .filter((property) => manualPropertyIds.has(property.id))
      .map((property) => property.name),
  );

  /*
   * ── TAR, AND ONLY THE WORD ──────────────────────────────────────────────
   * The NUMBER never appears here. It is business data an operator types for
   * their own reference, the sheet leaves the office, and the charge it refers
   * to is already in the pricing columns — so the word says "this Trip was
   * charged TAR" and nothing more.
   *
   * Whether it WAS charged is not decided here. `wasTarCharged` comes from the
   * stored snapshot — see `wasTarChargedIn` — so the stated number, the
   * Combination leg and the same-day rule that withholds a number already
   * charged that day are all honoured exactly as the Engine applied them.
   */
  if (wasTarCharged) {
    names.push(TAR_MARK);
  }

  if (lines.waitingTime !== null && waitingLabel) {
    names.push(waitingLabel);
  }

  /*
   * Last, because it is a sentence and the entries before it are labels. The
   * text is taken VERBATIM — no prefix, no truncation, no quoting — since the
   * sheet has no convention for one and inventing "Notitie: " would be a
   * format nobody asked for. Its own commas are part of what somebody wrote.
   */
  const notes = meaningfulText(trip.internalNotes);

  if (notes !== null) {
    names.push(notes);
  }

  return names.join(", ");
}

/** The word the sheet carries for a charged TAR. Never the number. */
const TAR_MARK = "TAR";

/**
 * Whether the Engine actually charged TAR, read from the stored snapshot.
 *
 * The snapshot is the Engine's own answer and the only honest source: it
 * already reflects the stated number, the Combination allocation and the
 * same-day rule. Recomputing any of that here would be a second opinion about
 * money, and the two would drift the first time a rule changed.
 *
 * `automaticPropertyId` is the configured TAR property. Without it — no
 * setting, or an unreadable one — no line can be recognised and nothing is
 * labelled.
 */
export function wasTarChargedIn(
  snapshot: PricingSnapshot | null,
  automaticPropertyId: string | null,
): boolean {
  if (snapshot === null || automaticPropertyId === null) {
    return false;
  }

  return snapshot.items.some(
    (item) => item.customPropertyId === automaticPropertyId,
  );
}

/**
 * Free text that says something, or null.
 *
 * The same reading `hasTarNummer` applies on the backend: whitespace is
 * absence, so a note of spaces adds no comma to the cell.
 */
function meaningfulText(value: string | null): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * The Custom Properties an operator may choose and whose amount lands in Kosten.
 *
 * Fixed-price — a route-priced property is charged through its own component —
 * AND not system-managed. `isSystemManaged` is the backend's own classification,
 * the same one that decides which properties the assignment endpoint refuses and
 * which the settings page will not delete, so this cannot drift from it. Naming
 * the properties here instead would be a second opinion about TAR and Flat.
 */
export function toManualPropertyIds(
  properties: readonly CustomProperty[],
): Set<string> {
  return new Set(
    properties
      .filter(
        (property) =>
          property.pricingComponentId === null && !property.isSystemManaged,
      )
      .map((property) => property.id),
  );
}

export function toBasicRow(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  manualPropertyIds: ReadonlySet<string>,
  waitingWord: string,
  automaticPropertyId: string | null = null,
): BasicExportRow {
  const lines = toPricedTripLines(snapshot);

  return {
    tripGroupId: trip.tripGroupId,
    licensePlate: trip.vehicle?.licensePlate ?? EMPTY_CELL,
    startTime: trip.startTime,
    endTime: trip.endTime,
    bookingNumber: trip.bookingNumber ?? EMPTY_CELL,
    containerType: trip.containerType ?? EMPTY_CELL,
    containerNumber: trip.containerNumber ?? EMPTY_CELL,
    trip: toRouteLabel(trip),
    costs: toCostsLabel(lines),
    info: toInfoLabel(
      trip,
      lines,
      manualPropertyIds,
      toWaitingLabel(trip, waitingWord),
      wasTarChargedIn(snapshot, automaticPropertyId),
    ),
  };
}
