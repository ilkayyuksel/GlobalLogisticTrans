/**
 * The Remarks cell as the customer writes it: parts separated by a comma.
 *
 * ── WHAT THE DOCUMENTS SHOW ─────────────────────────────────────────────────
 * `tar`, `flat,tar`, `tar,EC 4220979`, `flat,tar,EC 467866,wachtuur kaai 8,45 tot
 * 11:00`, `tar 869,Tar 1742 OP` — a comma without a space, lower-case words, and
 * free text an operator typed. Nothing in it is ever rewritten: what this check
 * adds goes at the END (the owner's own additions in week 36 did exactly that),
 * and a part counts as already there when the customer said the same thing in
 * their own way.
 */

export const RemarkKind = {
  /** A Custom Property, by its name in lower case: `flat`, `stop`. */
  PROPERTY: "PROPERTY",
  TAR: "TAR",
  /** A Cost Confirmation: `EC 4220981`. */
  COST_CONFIRMATION: "COST_CONFIRMATION",
  /** The waiting window: `wachtuur 7:30 tot 11:30`. */
  WAITING: "WAITING",
  GEEN_COMBI: "GEEN_COMBI",
  /** The Trip's Extra notities, as an operator wrote them: `LAAD REF KLOPT NIET`. */
  NOTE: "NOTE",
} as const;

export type RemarkKind = (typeof RemarkKind)[keyof typeof RemarkKind];

export interface RemarkPart {
  readonly kind: RemarkKind;
  /** Exactly what is written. */
  readonly text: string;
  /** For a Cost Confirmation: its number, digits only. */
  readonly ccNumber?: string;
}

const SEPARATOR = ",";

/** `EC 4220981`, `EC4220981` — one part naming one confirmation. */
const EC_PART = /^EC\s*(\d+)$/i;

/** The parts of a Remarks text, trimmed, empty ones left out. */
export function toRemarkParts(remarks: string): string[] {
  return remarks
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Whether the Remarks already say this part, in the customer's own way.
 *
 *   a property   a part equal to its name, any case (`AANKOPPELEN` is not
 *                `aan/afkoppelen`: that is a different word, see the notes)
 *   TAR          a part that BEGINS with the word `tar` — `tar 869`,
 *                `Tar 1742 OP` both say it
 *   EC           the same number, on this row or on any row of the same Trip
 *   wachtuur     any part containing the word — `wachtuur kaai 10:00 tot 11:00`
 *                is the customer's own spelling of a waiting time
 *   GEEN COMBI   exactly those words, any case
 *   a note       the whole note, anywhere in the Remarks, any case — it may
 *                hold commas of its own, so it is not looked for as one part
 */
export function isStated(
  part: RemarkPart,
  stated: readonly string[],
  ccNumbersOnTrip: ReadonlySet<string>,
): boolean {
  switch (part.kind) {
    case RemarkKind.PROPERTY:
      return stated.some((text) => text.toLowerCase() === part.text);
    case RemarkKind.TAR:
      return stated.some((text) => /^tar\b/i.test(text));
    case RemarkKind.COST_CONFIRMATION:
      return ccNumbersOnTrip.has(part.ccNumber!);
    case RemarkKind.WAITING:
      return stated.some((text) => /wachtuur/i.test(text));
    case RemarkKind.GEEN_COMBI:
      return stated.some((text) => text.toUpperCase() === part.text);
    case RemarkKind.NOTE:
      return toComparableNote(stated.join(SEPARATOR)).includes(toComparableNote(part.text));
  }
}

/** Text compared as parts: the spaces around commas and the case do not count. */
function toComparableNote(text: string): string {
  return toRemarkParts(text).join(SEPARATOR).toLowerCase();
}

/** Every confirmation number a Remarks text names as `EC <nr>`. */
export function toStatedCcNumbers(remarks: string): string[] {
  return toRemarkParts(remarks)
    .map((part) => EC_PART.exec(part)?.[1] ?? null)
    .filter((number): number is string => number !== null);
}

/**
 * The Remarks with the given parts added at the end.
 *
 * What was there stays exactly as it was; only trailing spaces give way to the
 * comma, so `tar  ` becomes `tar,GEEN COMBI` rather than `tar  ,GEEN COMBI`.
 */
export function withRemarkParts(remarks: string, texts: readonly string[]): string {
  if (texts.length === 0) {
    return remarks;
  }

  const kept = remarks.trimEnd();

  return kept === "" ? texts.join(SEPARATOR) : `${kept}${SEPARATOR}${texts.join(SEPARATOR)}`;
}
