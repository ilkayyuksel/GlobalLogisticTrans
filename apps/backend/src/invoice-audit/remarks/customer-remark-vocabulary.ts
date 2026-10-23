import { RemarkKind, type RemarkPart } from "./remark-parts";

/**
 * What this system knows about a Trip that belongs in Remarks, in the
 * customer's own words — never this system's export words.
 *
 * ── THE WORDS, AND WHERE THEY COME FROM ─────────────────────────────────────
 *   a Custom Property   its name in lower case (`Flat` → `flat`), also when
 *                       it costs nothing; the documents show `flat`, `stop`,
 *                       `chassis` exactly so
 *   TAR                 `tar`, when the Engine charged it or it is assigned
 *   a confirmation      `EC <nr>`, every one the Trip holds
 *   the waiting time    `wachtuur H:MM tot H:MM`, the customer's commonest
 *                       form (`wachtuur 9:00 tot 11:30`)
 *   no Combination      `GEEN COMBI`
 *   Extra notities      the operator's note on the Trip, as written, last
 *
 * No translation is invented: a property name is written as its name, in
 * lower case — also when this invoice has never used the word, which is no
 * reason for a note (owner, October 2026). A waiting window is written the
 * same way whether it ends on its own day or the next — the stored window is
 * what pricing used, and `waiting_time_ends_next_day` only says which day its
 * end is on. A waiting time with no complete window — a duration alone, or a
 * missing begin or end — has no spelling: it is not written, and reported.
 * Over ST is never written here (owner, October 2026).
 */
export interface RemarkFacts {
  readonly propertyNames: readonly string[];
  readonly tarCharged: boolean;
  readonly ccNumbers: readonly string[];
  readonly waiting: WaitingFacts | null;
  readonly geenCombi: boolean;
  /** The Trip's Extra notities (`internal_notes`); absent or null when none. */
  readonly extraNotes?: string | null;
}

export interface WaitingFacts {
  /** A time of day, as the database stores it: on 1970-01-01, in UTC. */
  readonly start: Date | null;
  readonly end: Date | null;
  readonly endsNextDay: boolean;
  readonly minutes: number | null;
}

export interface CustomerRemarkParts {
  readonly parts: readonly RemarkPart[];
  /** What is true of the Trip but has no customer spelling, for the preview. */
  readonly unexpressed: readonly string[];
}

const TAR = "tar";
const GEEN_COMBI = "GEEN COMBI";

export function toCustomerRemarkParts(facts: RemarkFacts): CustomerRemarkParts {
  const names = [...new Set(facts.propertyNames.map((name) => name.trim().toLowerCase()))]
    .filter((name) => name !== "");
  const parts: RemarkPart[] = names
    .filter((name) => name !== TAR)
    .map((text) => ({ kind: RemarkKind.PROPERTY, text }));
  const unexpressed: string[] = [];

  if (facts.tarCharged || names.includes(TAR)) {
    parts.push({ kind: RemarkKind.TAR, text: TAR });
  }

  for (const ccNumber of new Set(facts.ccNumbers)) {
    parts.push({ kind: RemarkKind.COST_CONFIRMATION, text: `EC ${ccNumber}`, ccNumber });
  }

  const waiting = toWaitingPart(facts.waiting);

  if (waiting !== null) {
    parts.push({ kind: RemarkKind.WAITING, text: waiting });
  } else if (hasWaitingTime(facts.waiting)) {
    unexpressed.push(WAITING_NOT_WRITTEN_NOTE);
  }

  if (facts.geenCombi) {
    parts.push({ kind: RemarkKind.GEEN_COMBI, text: GEEN_COMBI });
  }

  // One line of Remarks: a note typed over several lines is joined by spaces.
  const note = facts.extraNotes?.replace(/\s+/g, " ").trim() ?? "";

  if (note !== "") {
    parts.push({ kind: RemarkKind.NOTE, text: note });
  }

  return { parts, unexpressed };
}

/** The note for a waiting time no Remarks part can state. */
export const WAITING_NOT_WRITTEN_NOTE =
  "De wachttijd heeft geen venster binnen één dag en wordt daarom niet geschreven.";

/**
 * `wachtuur 7:30 tot 11:30` — and `wachtuur 22:00 tot 1:30` for a window ending
 * the next day, read exactly as `waiting-window.ts` reads it for pricing. Null
 * when the window is incomplete: no begin or no end.
 */
function toWaitingPart(waiting: WaitingFacts | null): string | null {
  if (waiting === null || !waiting.start || !waiting.end) {
    return null;
  }

  return `wachtuur ${toClock(waiting.start)} tot ${toClock(waiting.end)}`;
}

/** Whether the Trip records any waiting time at all — a window or a duration. */
function hasWaitingTime(waiting: WaitingFacts | null): boolean {
  if (waiting === null) {
    return false;
  }

  return waiting.start !== null || waiting.end !== null || (waiting.minutes ?? 0) > 0;
}

/** `7:30` — the hour without a leading zero, as the customer writes it. */
function toClock(time: Date): string {
  return `${time.getUTCHours()}:${String(time.getUTCMinutes()).padStart(2, "0")}`;
}
