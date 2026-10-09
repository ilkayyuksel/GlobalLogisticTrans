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
  /**
   * Every Cost Confirmation reference of the Trip, `CC4139505`, newest first.
   *
   * The same references the Remarks text ends with, on their own: the BASIS
   * sheet composes its INFO column from parts rather than printing Remarks,
   * and without them a Trip whose EK came from its confirmations showed the
   * money nowhere and the documents behind it nowhere either.
   */
  readonly costConfirmations: readonly string[];
}

/** The word for waiting time when the caller names none: the documents' own. */
export const DEFAULT_WAITING_WORD = "Wachttijd";

/** The words for a window ending the day after it began: the documents' own. */
export const DEFAULT_NEXT_DAY_WORD = "volgende dag";

/** Between the operator's own remarks and each confirmation reference. */
const REMARKS_SEPARATOR = " | ";

/** The word the sheet carries for a charged TAR. Never the number. */
const TAR_MARK = "TAR";

const MINUTES_PER_HOUR = 60;

/**
 * Everything an export prints about one Trip, in one answer.
 *
 * `snapshot` is the Trip's CURRENT pricing — null for a Trip that has none, an
 * OPEN one included — and decides only what describes a charge (TAR).
 * `confirmationNumbers` are the Trip's Cost Confirmation records, newest
 * first, whatever its status: which documents Eucon sent is a fact about the
 * Trip, not about its price.
 */
export function toTripExportLabels(
  trip: LabelledTrip,
  snapshot: LabelledSnapshot | null,
  automaticPropertyId: string | null,
  confirmationNumbers: readonly string[],
  waitingWord: string = DEFAULT_WAITING_WORD,
  nextDayWord: string = DEFAULT_NEXT_DAY_WORD,
): TripExportLabels {
  return {
    remarks: toPricingRemarks(
      trip,
      snapshot,
      automaticPropertyId,
      confirmationNumbers,
      waitingWord,
      nextDayWord,
    ),
    waitingLabel: toWaitingLabel(trip, waitingWord, nextDayWord),
    tarCharged: wasTarChargedIn(snapshot, automaticPropertyId),
    costConfirmations: toCostConfirmationLabels(confirmationNumbers),
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
 *   CC         every confirmation reference the Trip holds, from its records —
 *              see `toCostConfirmationLabels`.
 *
 * Nothing replaces what was already there, and nothing is invented: each part
 * is either the operator's own text or the Engine's own stored answer.
 */
export function toPricingRemarks(
  trip: LabelledTrip,
  snapshot: LabelledSnapshot | null,
  automaticPropertyId: string | null,
  confirmationNumbers: readonly string[],
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

  parts.push(...toCostConfirmationLabels(confirmationNumbers));

  return parts.filter((part) => part !== "").join(REMARKS_SEPARATOR);
}

/**
 * Every confirmation reference of the Trip, `CC4139505`, newest first, each once.
 *
 * ── WHY THE RECORDS AND NOT THE PRICING SNAPSHOT ────────────────────────────
 * These used to be read off the stored EK line, with the Trip's LATEST
 * confirmation as the fallback. That tied a fact about the Trip — which
 * documents Eucon sent for it — to whether its price is shown: a reopened Trip,
 * whose snapshot is history rather than its price, kept only its latest
 * reference. The numbers now come from the confirmation records themselves,
 * so every one appears whatever the Trip's status, and reading them prices
 * nothing.
 *
 * The records cannot name another Trip's document: they are the Trip's own
 * rows. Duplicates cannot reach the database — `(trip_id, cc_number)` is
 * unique — and are removed here all the same, so a caller cannot print one
 * twice.
 */
export function toCostConfirmationLabels(
  confirmationNumbers: readonly string[],
): string[] {
  return [...new Set(confirmationNumbers)].map(toCostConfirmationLabel);
}

/** `CC4139505` — the prefix the Ritten list prints a confirmation with. */
function toCostConfirmationLabel(ccNumber: string): string {
  return `CC${ccNumber}`;
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
