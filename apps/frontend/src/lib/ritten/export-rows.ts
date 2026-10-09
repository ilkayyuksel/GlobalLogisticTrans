import {
  NO_LABELS,
  type TripExportLabels,
} from "@/lib/api/trip-export-labels";
import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { toRouteLabels } from "./export-route-labels";
import { toRouteText } from "./route-label";
import {
  toPricedTripLines,
  type PricedTripLines,
} from "./pricing-lines";

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
  /**
   * The group this Trip belongs to, or null.
   *
   * Not a column: it decides the ROW's background, exactly as it does in the
   * BASIS sheet and in the Ritten list, so one Combination is one colour
   * wherever it is shown. See `combinationFillArgb`.
   */
  readonly tripGroupId: string | null;
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
  /** What the fuel cost. The rate behind it is not a column of this sheet. */
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

/*
 * ── THE WORDS ARE THE BACKEND'S ─────────────────────────────────────────────
 * The Remarks text, the waiting-time label and whether TAR was charged are
 * composed by the server (`trip-export-labels.ts`, served at
 * `GET /trip-export/labels`) and only PLACED here. The invoice check writes the
 * same Trips into the customer's workbook from the server, and one vocabulary
 * with one owner is what keeps the two from ever saying different things.
 */

export function toPricingRow(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  labels: TripExportLabels = NO_LABELS,
): PricingExportRow {
  const lines: PricedTripLines = toPricedTripLines(snapshot);
  /** What the Trip is worth NOW, corrections included. See `corrected`. */
  const effective = trip.pricing ?? undefined;
  /*
   * The two ends of the Trip in the operator's own vocabulary, decided by the
   * persisted direction and the Combination relationship — never by a terminal
   * name, a date or a row order. See `export-route-labels.ts`.
   */
  const route = toRouteLabels(trip);

  return {
    tripGroupId: trip.tripGroupId,
    planningDate: trip.planningDate,
    startTime: trip.startTime,
    endTime: trip.endTime,
    containerType: trip.containerType ?? EMPTY_CELL,
    bookingNumber: trip.bookingNumber ?? EMPTY_CELL,
    containerNumber: trip.containerNumber ?? EMPTY_CELL,
    startPoint: route.startPoint,
    trip: toRouteLabel(trip),
    endPoint: route.endPoint,
    basePrice: corrected(lines.basePrice, effective?.tarief),
    /*
     * What the fuel cost, with a corrected Tarief already followed through:
     * fuel is a percentage OF the Tarief, so the backend recalculates it from
     * the corrected figure and both travel together. No rate is printed — the
     * sheet is a price list, and the amount is the price.
     */
    fuelAmount: corrected(lines.fuel, effective?.brandstof),
    backload: corrected(lines.combination, effective?.backload),
    toll: corrected(lines.toll, effective?.tol),
    tunnel: corrected(lines.tunnel, effective?.tunnel),
    /*
     * Both from the stored lines alone, deliberately. The effective read groups
     * the waiting time into its own `others`, and this sheet prints the two in
     * separate columns — taking `others` from there would silently fold one
     * into the other.
     */
    others: lines.others,
    waitingTime: lines.waitingTime,
    // The Wachttijd column beside it stays informational. See `toEkAmount`.
    ek: toEkAmount(lines, effective?.ek),
    remarks: labels.remarks,
  };
}

/**
 * The Trip's EK, or null when it has none.
 *
 * The backend's EFFECTIVE figure: the charged waiting time, or else the
 * confirmations' sum — one source, decided by the backend, never added up or
 * chosen here. A stored line of either kind says EK applies at all, so a Trip
 * with a waiting time and no confirmation still shows its EK, and a Trip with
 * confirmations and no charged waiting time shows theirs.
 *
 * Shared by both sheets, so the price list and the dispatch sheet cannot
 * disagree about what a Trip's EK is.
 */
export function toEkAmount(
  lines: PricedTripLines,
  effectiveEk: string | undefined,
): number | null {
  return corrected(lines.waitingTime ?? lines.ek, effectiveEk);
}

/**
 * A stored amount with the operator's correction applied, when there is one.
 *
 * ── WHY BOTH SOURCES, AND WHICH DECIDES WHAT ────────────────────────────────
 * The stored snapshot decides WHETHER a component applies: no line, no figure,
 * and an empty cell rather than a zero — a Trip that was never charged toll and
 * one charged nothing for it are different facts.
 *
 * What a component is WORTH now can differ from what was stored: Tarief, Tol
 * and Tunnel may be corrected by hand, the corrections live in their own table,
 * and the backend applies them on top of the stored lines at read time. It also
 * recalculates the fuel with them, because fuel is a percentage OF the Tarief —
 * which is why an overridden Tarief must never be printed beside a fuel amount
 * calculated from the old one.
 *
 * So `trip.pricing` — the same figures the Ritten list shows — supplies the
 * amount, and this file calculates nothing. A Trip that has never been priced
 * has no effective pricing at all, and the stored lines answer alone.
 */
function corrected(
  stored: number | null,
  effective: string | undefined,
): number | null {
  if (stored === null || effective === undefined) {
    return stored;
  }

  const amount = Number(effective);

  return Number.isFinite(amount) ? amount : stored;
}

/**
 * The costs an operator reads at a glance: "35.00 + 50.00 + 25.00".
 *
 * The Combination surcharge, the fixed Custom Properties and the EK, which is
 * what this column was asked for. Base price, fuel, toll and tunnel are
 * deliberately absent — they belong to the pricing export, and mixing them in
 * here would make the sum mean something nobody asked about.
 *
 * The amounts are stored ones, joined; they are never added together.
 *
 * ── EK, NOT ONLY THE WAITING TIME ───────────────────────────────────────────
 * This printed the waiting-time line, which is the EK only when a waiting time
 * was charged. A Trip whose EK came from its Cost Confirmations — no charged
 * waiting time — printed nothing at all, so the money Eucon confirmed appeared
 * nowhere on the sheet. `ekAmount` is the EK whichever its source; for a
 * charged waiting time it is the same figure as before. It defaults to the
 * stored lines' own answer for a caller without the effective pricing.
 *
 * ── IN THE ORDER INFO NAMES THEM ────────────────────────────────────────────
 * The office reads the two columns side by side, amount under word —
 * `35.00+82.50 | AFKOPPELEN+wachtuur` in the reference sheet. The property
 * amounts were printed in STORED order — and every property line has the same
 * calculation order, so the API sorts them by their random item id, which made
 * the order of the amounts against the words a matter of chance.
 * `namedPropertyIds` is the order INFO names the operator's properties in;
 * their amounts come first, in that order, and the charges INFO does not name
 * one by one (TAR, Flat) follow.
 */
export function toCostsLabel(
  lines: PricedTripLines,
  ekAmount: number | null = lines.waitingTime ?? lines.ek,
  namedPropertyIds: readonly string[] = [],
): string {
  /*
   * ── THE COMBINATION SURCHARGE COMES FIRST, AND IT WAS MISSING ─────────────
   * The column is called COMBI EN KOST, and the office sheet this export
   * reproduces (`docs/07-excels/29-06-2026.xlsx`) prints each leg of a
   * Combination with its surcharge there — `50.00`, or `50.00+137.50` when the
   * leg also waited. This function listed only the Custom Properties and the
   * waiting time, so a Combination leg the Engine had priced at €50 left the
   * sheet with an empty cell.
   *
   * The amount is the Engine's own stored COMBINATION line, per Trip — each
   * leg carries its own — and nothing here decides whether a Trip is part of a
   * Combination. No line, no amount.
   */
  const amounts: number[] =
    lines.combination === null ? [] : [lines.combination];

  amounts.push(...inNamedOrder(lines, namedPropertyIds));

  if (ekAmount !== null) {
    amounts.push(ekAmount);
  }

  return amounts.map((amount) => amount.toFixed(2)).join(" + ");
}

/** The property amounts: the named ones in their order, then the rest. */
function inNamedOrder(
  lines: PricedTripLines,
  namedPropertyIds: readonly string[],
): number[] {
  const named = namedPropertyIds.flatMap((id) =>
    lines.customPropertyLines.filter((line) => line.customPropertyId === id),
  );
  const rest = lines.customPropertyLines.filter(
    (line) =>
      line.customPropertyId === null ||
      !namedPropertyIds.includes(line.customPropertyId),
  );

  return [...named, ...rest].map((line) => line.amount);
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
  costConfirmations: readonly string[] = [],
  informationalPropertyIds: ReadonlySet<string> = NO_IDS,
): string {
  const names: string[] = [];

  // First, because it changes what the driver is being sent to do.
  if (trip.isLooseTrip) {
    names.push(LOOSE_TRIP_MARK);
  }

  /*
   * ── COMBI, BESIDE ITS AMOUNT ────────────────────────────────────────────
   * COMBI EN KOST prints the Combination surcharge first, so the word that
   * explains it comes first here. It is read from the Trip's own stored
   * COMBINATION line — the line that put the amount in that column — so the
   * word and the amount always appear together, and nothing here decides
   * whether a Trip belongs to a Combination: no line, no word.
   */
  if (lines.combination !== null) {
    names.push(COMBINATION_MARK);
  }

  const named = trip.customProperties.filter((property) =>
    manualPropertyIds.has(property.id),
  );

  // Only the properties that carry an amount here, in step with COMBI EN KOST.
  names.push(
    ...named
      .filter((property) => !informationalPropertyIds.has(property.id))
      .map((property) => property.name),
  );

  /*
   * ── TAR, AND ONLY THE WORD ──────────────────────────────────────────────
   * The NUMBER never appears here. It is business data an operator types for
   * their own reference, the sheet leaves the office, and the charge it refers
   * to is already in the pricing columns — so the word says "this Trip was
   * charged TAR" and nothing more.
   *
   * Whether it WAS charged is not decided here. `wasTarCharged` is the backend's
   * reading of the stored snapshot — see `trip-export-labels.ts` — so the stated number, the
   * Combination leg and the same-day rule that withholds a number already
   * charged that day are all honoured exactly as the Engine applied them.
   */
  if (wasTarCharged) {
    names.push(TAR_MARK);
  }

  /*
   * ── THE WINDOW IS A FACT ABOUT THE WORK, NOT ABOUT THE CHARGE ───────────
   * Read from the TRIP, never from the priced line. A driver who stood at a
   * terminal for three hours stood there whether or not the Engine billed for
   * it, and this used to require a WAITING_TIME line — so a waiting time that
   * was not charged, or one on a Trip not yet priced, left the cell empty while
   * the pricing export's own Remarks column said it. The money column beside
   * this one still answers what it COST, and that stays the stored line alone.
   */
  if (waitingLabel && recordsWaitingTime(trip)) {
    names.push(waitingLabel);
  }

  /*
   * ── THE CONFIRMATIONS, BY THEIR REFERENCE ───────────────────────────────
   * `CC4139505`, every one the Trip holds, as the backend reads them off its
   * own stored EK line. Named whether or not they are the EK: when a charged
   * waiting time is, the confirmations still exist and an operator checking a
   * Eucon statement against this sheet has to find them.
   */
  names.push(...costConfirmations);

  /*
   * ── PROPERTIES WITHOUT A PRICE: INFORMATION, AFTER EVERY PRICED WORD ─────
   * A property nobody priced is a remark, not a charge: it has no amount in
   * COMBI EN KOST. The office reads the two columns side by side, amount under
   * word, so naming it among the priced properties would hand it the next
   * property's amount. It is named here instead, after every word that has an
   * amount and before the free-text note.
   */
  names.push(
    ...named
      .filter((property) => informationalPropertyIds.has(property.id))
      .map((property) => property.name),
  );

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

/**
 * Whether the Trip records a waiting time at all.
 *
 * ── WHY ZERO IS NOT A WAITING TIME ──────────────────────────────────────────
 * `waitingTimeMinutes` is the single stored quantity — the window an operator
 * enters is converted into it, and pricing bills from it — so it is the honest
 * thing to ask. Zero is left out deliberately: `formatWaitingTime` spells it
 * `0 min` so a table cell cannot be mistaken for an empty one, but a Trip that
 * waited no minutes did not wait, and printing `Wachttijd 0 min` beside the
 * route would put a note on the sheet about something that did not happen.
 */
function recordsWaitingTime(trip: Trip): boolean {
  return (trip.waitingTimeMinutes ?? 0) > 0;
}

/** The word the sheet carries for a charged TAR. Never the number. */
const TAR_MARK = "TAR";

/** The word the sheet carries for a charged Combination surcharge (Backload). */
const COMBINATION_MARK = "COMBI";

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

/**
 * The operator's properties whose price is not configured — information only.
 *
 * Read off the catalog: `defaultPrice` null on a fixed-price property. An
 * explicit price of €0 is a price, and is not in this set.
 */
export function toUnpricedPropertyIds(
  properties: readonly CustomProperty[],
): Set<string> {
  return new Set(
    properties
      .filter(
        (property) =>
          property.pricingComponentId === null && property.defaultPrice === null,
      )
      .map((property) => property.id),
  );
}

export function toBasicRow(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  manualPropertyIds: ReadonlySet<string>,
  labels: TripExportLabels = NO_LABELS,
  unpricedPropertyIds: ReadonlySet<string> = NO_IDS,
): BasicExportRow {
  const lines = toPricedTripLines(snapshot);
  const informational = toInformationalPropertyIds(
    trip,
    snapshot,
    lines,
    manualPropertyIds,
    unpricedPropertyIds,
  );
  // The order INFO names the PRICED properties in; Kost follows it.
  const namedPropertyIds = trip.customProperties
    .filter(
      (property) =>
        manualPropertyIds.has(property.id) && !informational.has(property.id),
    )
    .map((property) => property.id);

  return {
    tripGroupId: trip.tripGroupId,
    licensePlate: trip.vehicle?.licensePlate ?? EMPTY_CELL,
    startTime: trip.startTime,
    endTime: trip.endTime,
    bookingNumber: trip.bookingNumber ?? EMPTY_CELL,
    containerType: trip.containerType ?? EMPTY_CELL,
    containerNumber: trip.containerNumber ?? EMPTY_CELL,
    trip: toRouteLabel(trip),
    costs: toCostsLabel(
      lines,
      toEkAmount(lines, trip.pricing?.ek),
      namedPropertyIds,
    ),
    info: toInfoLabel(
      trip,
      lines,
      manualPropertyIds,
      labels.waitingLabel,
      labels.tarCharged,
      labels.costConfirmations,
      informational,
    ),
  };
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Which of the Trip's named properties are information only, with no amount.
 *
 * ── THE STORED LINES DECIDE, WHEN THERE ARE ANY ─────────────────────────────
 * For a priced Trip the snapshot is the truth about money: a property with no
 * stored line contributed nothing, whatever the catalog says today — and a
 * property priced at an explicit €0 HAS a line, so it stays among the priced
 * ones with its 0.00. A Trip with no current price (OPEN, or never priced) has
 * no lines to ask, so the catalog's own answer is used: no configured price.
 */
function toInformationalPropertyIds(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  lines: PricedTripLines,
  manualPropertyIds: ReadonlySet<string>,
  unpricedPropertyIds: ReadonlySet<string>,
): Set<string> {
  const priced = new Set(
    lines.customPropertyLines.map((line) => line.customPropertyId),
  );

  return new Set(
    trip.customProperties
      .filter((property) => manualPropertyIds.has(property.id))
      .filter((property) =>
        snapshot === null
          ? unpricedPropertyIds.has(property.id)
          : !priced.has(property.id),
      )
      .map((property) => property.id),
  );
}
