import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { formatWaitingTime } from "@/lib/waiting-time";
import { toRouteLabels } from "./export-route-labels";
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
  readonly remarks: string;
}

export interface BasicExportRow {
  readonly isCompleted: boolean;
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
 * Built from the Trip's own stored values — the terminal it was collected from
 * or returned to, and the destination city. No identifier appears, and no route
 * is invented: a Trip missing either end simply shows the end it has.
 */
export function toRouteLabel(trip: Trip): string {
  const from = trip.terminal ?? EMPTY_CELL;
  const to = trip.destinationCity ?? EMPTY_CELL;

  if (from === EMPTY_CELL && to === EMPTY_CELL) {
    return EMPTY_CELL;
  }

  return from === EMPTY_CELL || to === EMPTY_CELL
    ? `${from}${to}`
    : `${from} -> ${to}`;
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
 * The words behind those numbers, in the same order.
 *
 * Only the FIXED Custom Properties are named: a route-priced one is not part of
 * the Kosten sum, so naming it here would explain a number that is not there.
 */
export function toInfoLabel(
  trip: Trip,
  lines: PricedTripLines,
  fixedPropertyIds: ReadonlySet<string>,
  waitingLabel: string | null,
): string {
  const names = trip.customProperties
    .filter((property) => fixedPropertyIds.has(property.id))
    .map((property) => property.name);

  if (lines.waitingTime !== null && waitingLabel) {
    names.push(waitingLabel);
  }

  return names.join(", ");
}

/** Which Custom Properties are fixed-price — the ones with no component. */
export function toFixedPropertyIds(
  properties: readonly CustomProperty[],
): Set<string> {
  return new Set(
    properties
      .filter((property) => property.pricingComponentId === null)
      .map((property) => property.id),
  );
}

export function toBasicRow(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  fixedPropertyIds: ReadonlySet<string>,
  waitingWord: string,
): BasicExportRow {
  const lines = toPricedTripLines(snapshot);
  const waiting = formatWaitingTime(trip.waitingTimeMinutes);

  return {
    // The Trip's own status, read not written: an export never changes one.
    isCompleted: trip.status === "CLOSED",
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
      fixedPropertyIds,
      waiting ? `${waitingWord} ${waiting}` : null,
    ),
  };
}
