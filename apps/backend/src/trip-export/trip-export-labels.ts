/**
 * The words an export prints about a Trip, beside its amounts.
 *
 * ── THE ONE PLACE THIS VOCABULARY LIVES ─────────────────────────────────────
 * The Remarks text (`Aan/Afkoppelen | TAR | Wachttijd 08:30-14:00 | CC4139505`),
 * the waiting-time label and whether TAR was charged used to be assembled in the
 * browser's Excel export. The invoice check now writes Trips into the
 * customer's own workbook from the server, and it must say the same thing in
 * the same words — so the vocabulary moved here, once, and the browser asks for
 * it (`GET /trip-export/labels`) instead of composing it.
 *
 * ── PURE, AND READING ONLY WHAT WAS STORED ───────────────────────────────────
 * No database, no clock, no configuration lookup: the caller hands in the Trip
 * as the API describes it, its stored pricing snapshot and the id of the TAR
 * property. Every word is either the operator's own text or the Engine's own
 * stored answer; nothing here decides whether something was charged.
 */

/** The Trip, as far as its export words are concerned — the Trip DTO's shape. */
export interface LabelledTrip {
  readonly customProperties: readonly { readonly id: string; readonly name: string }[];
  /** `HH:MM:SS`, as the Trip DTO carries it. */
  readonly waitingTimeStart: string | null;
  readonly waitingTimeEnd: string | null;
  /** Whether the end is on the day after the begin. */
  readonly waitingTimeEndsNextDay: boolean;
  readonly waitingTimeMinutes: number | null;
  /** The LATEST confirmation, as the Ritten list shows it. */
  readonly costConfirmation: { readonly ccNumber: string } | null;
}

/** A stored pricing snapshot, as far as its export words are concerned. */
export interface LabelledSnapshot {
  readonly items: readonly {
    readonly pricingComponentCode: string;
    readonly customPropertyId: string | null;
    readonly description: string;
  }[];
}

/** What an export prints about one Trip. */
export interface TripExportLabels {
  /** The Remarks column: properties, TAR, the waiting window and every CC. */
  readonly remarks: string;
  /** `Wachttijd 07:00-10:00`, or the duration, or null when none was recorded. */
  readonly waitingLabel: string | null;
  /** Whether the Engine charged TAR, read from the stored snapshot. */
  readonly tarCharged: boolean;
}

/** The word for waiting time when the caller names none: the documents' own. */
export const DEFAULT_WAITING_WORD = "Wachttijd";

/** The words for a window ending the day after it began: the documents' own. */
export const DEFAULT_NEXT_DAY_WORD = "volgende dag";

/** The component code of the stored EK line, as the backend spells it. */
const COST_CONFIRMATION_CODE = "COST_CONFIRMATION";

/** Between the operator's own remarks and each confirmation reference. */
const REMARKS_SEPARATOR = " | ";

/** The word the sheet carries for a charged TAR. Never the number. */
const TAR_MARK = "TAR";

/**
 * The Cost Confirmation references on the stored EK line.
 *
 * The Engine writes them there itself — `Cost confirmation 4139505`, or
 * `Cost confirmations 4139505, 4156173` when a Trip was confirmed in
 * instalments — so the line that carries the money also says which documents
 * produced it. See `cost-confirmation.calculator.ts`.
 */
const CONFIRMATION_REFERENCES = /^Cost confirmations?\s+(.+)$/i;

const MINUTES_PER_HOUR = 60;

/** Everything an export prints about one Trip, in one answer. */
export function toTripExportLabels(
  trip: LabelledTrip,
  snapshot: LabelledSnapshot | null,
  automaticPropertyId: string | null,
  waitingWord: string = DEFAULT_WAITING_WORD,
  nextDayWord: string = DEFAULT_NEXT_DAY_WORD,
): TripExportLabels {
  return {
    remarks: toPricingRemarks(
      trip,
      snapshot,
      automaticPropertyId,
      waitingWord,
      nextDayWord,
    ),
    waitingLabel: toWaitingLabel(trip, waitingWord, nextDayWord),
    tarCharged: wasTarChargedIn(snapshot, automaticPropertyId),
  };
}

/**
 * The Remarks column: everything about a Trip that is not an amount.
 *
 * ── WHAT IT GATHERS, AND IN WHICH ORDER ─────────────────────────────────────
 * The operator's own Custom Properties first, then three things the sheet used
 * to leave unsaid:
 *
 *   TAR        the word, never the number. Whether it was charged comes from
 *              the stored snapshot — the Engine's own answer, same-day rule
 *              included — so an automatic charge is named even though nobody
 *              ticked it. A Trip that carries TAR as an assigned property
 *              already shows it, and it is not said twice.
 *   Wachttijd  the window an operator read off a clock, or the duration when no
 *              window was recorded. It appears whenever the Trip HAS a waiting
 *              time, whether or not it was charged: the money column beside it
 *              says what it cost, and a free half hour is still a half hour the
 *              driver stood there.
 *   CC         every confirmation reference, as `toCostConfirmationLabels`
 *              reads them off the EK line.
 *
 * Nothing replaces what was already there, and nothing is invented: each part
 * is either the operator's own text or the Engine's own stored answer.
 */
export function toPricingRemarks(
  trip: LabelledTrip,
  snapshot: LabelledSnapshot | null,
  automaticPropertyId: string | null,
  waitingWord: string = DEFAULT_WAITING_WORD,
  nextDayWord: string = DEFAULT_NEXT_DAY_WORD,
): string {
  const names = trip.customProperties.map((property) => property.name);
  const parts = [...names];

  // Charged by the Engine rather than chosen by anybody, so it is named here —
  // unless the Trip also carries it as an assignment, which already says it.
  if (wasTarChargedIn(snapshot, automaticPropertyId) && !names.includes(TAR_MARK)) {
    parts.push(TAR_MARK);
  }

  const waiting = toWaitingLabel(trip, waitingWord, nextDayWord);

  if (waiting !== null) {
    parts.push(waiting);
  }

  parts.push(...toCostConfirmationLabels(trip, snapshot));

  return parts.filter((part) => part !== "").join(REMARKS_SEPARATOR);
}

/**
 * Every confirmation reference belonging to THIS Trip, newest first.
 *
 * ── WHY THE SNAPSHOT AND NOT A SEARCH ───────────────────────────────────────
 * The references are read off the Trip's own stored pricing, which is the only
 * source that cannot name somebody else's document: a snapshot belongs to one
 * Trip, and the Engine put those references on it from the confirmations it
 * actually priced. Nothing is matched on a booking number here.
 *
 * A Trip confirmed several times therefore keeps every reference. Duplicates
 * cannot arise: the backend refuses a second confirmation carrying a
 * `cc_number` it already holds, so one document counts once however often it
 * arrives.
 *
 * The Trip's own `costConfirmation` is the fallback, and it is the LATEST one
 * only — the Ritten list's display rule. It answers for a Trip whose snapshot
 * predates the confirmation, which is the one case the stored line cannot.
 */
export function toCostConfirmationLabels(
  trip: LabelledTrip,
  snapshot: LabelledSnapshot | null,
): string[] {
  const stored = referencesOnSnapshot(snapshot);
  const references =
    stored.length > 0
      ? stored
      : trip.costConfirmation
        ? [trip.costConfirmation.ccNumber]
        : [];

  return [...new Set(references)].map(toCostConfirmationLabel);
}

/** `CC4139505` — the prefix the Ritten list prints a confirmation with. */
function toCostConfirmationLabel(ccNumber: string): string {
  return `CC${ccNumber}`;
}

function referencesOnSnapshot(snapshot: LabelledSnapshot | null): string[] {
  const line = snapshot?.items.find(
    (item) => item.pricingComponentCode === COST_CONFIRMATION_CODE,
  );

  const references = line ? CONFIRMATION_REFERENCES.exec(line.description) : null;

  if (references === null) {
    return [];
  }

  return references[1]
    .split(",")
    .map((reference) => reference.trim())
    .filter((reference) => reference !== "");
}

/**
 * The waiting time as the printed sheet says it: `Wachttijd 07:00-10:00`, or
 * `Wachttijd 10:00-12:00 (volgende dag)` when the end is on the next day —
 * without that, a sheet would show a two-hour window billed as sixteen.
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
  trip: LabelledTrip,
  waitingWord: string = DEFAULT_WAITING_WORD,
  nextDayWord: string = DEFAULT_NEXT_DAY_WORD,
): string | null {
  const begin = toClockLabel(trip.waitingTimeStart);
  const end = toClockLabel(trip.waitingTimeEnd);

  if (begin && end) {
    const window = `${waitingWord} ${begin}-${end}`;

    return trip.waitingTimeEndsNextDay ? `${window} (${nextDayWord})` : window;
  }

  const duration = formatWaitingTime(trip.waitingTimeMinutes);

  return duration ? `${waitingWord} ${duration}` : null;
}

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
  snapshot: LabelledSnapshot | null,
  automaticPropertyId: string | null,
): boolean {
  if (snapshot === null || automaticPropertyId === null) {
    return false;
  }

  return snapshot.items.some((item) => item.customPropertyId === automaticPropertyId);
}

/** `07:00` from the DTO's `07:00:00`. */
function toClockLabel(clockTime: string | null): string | null {
  return clockTime ? clockTime.slice(0, 5) : null;
}

/**
 * How a stored waiting time reads: `1 u 30 min`, `2 u`, `45 min`, `0 min`.
 *
 * The same compact form every screen shows a waiting time in. Zero is written
 * out as `0 min`, because an empty-looking label would be indistinguishable from
 * one that was never filled in.
 */
function formatWaitingTime(totalMinutes: number | null): string | null {
  if (totalMinutes === null) {
    return null;
  }

  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return minutes === 0 ? `${hours} u` : `${hours} u ${minutes} min`;
}
