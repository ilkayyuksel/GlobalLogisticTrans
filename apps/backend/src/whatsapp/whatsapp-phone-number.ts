/**
 * A stored driver phone number, as WhatsApp can address it.
 *
 * ── WHAT THE DATABASE ACTUALLY HOLDS ────────────────────────────────────────
 * Belgian mobile numbers in international form, written the way people write
 * them: `+32 470 11 22 33`. They ALREADY carry the country code — checked
 * against the stored data, not assumed — so there is nothing to guess here and
 * no default prefix to invent. A number without a `+` is refused rather than
 * decorated with one, because "0470 11 22 33" is a Belgian number to a Belgian
 * reader and an unanswerable question to this function.
 *
 * ── THE STORED VALUE IS NEVER REWRITTEN ─────────────────────────────────────
 * This produces an ADDRESS for one send. `driver.phone_number` keeps the form
 * an operator typed, because that is the form they will recognise in the Driver
 * screen, and normalising the column would quietly change data that no one
 * asked to change.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The shortest and longest a real international number can be.
 *
 * E.164 allows at most fifteen digits including the country code. The lower
 * bound is deliberately loose: it exists to reject a truncated entry such as
 * `+32`, not to model every country's numbering plan, which this system has no
 * business knowing.
 */
const MINIMUM_DIGITS = 8;
const MAXIMUM_DIGITS = 15;

/** Spaces, dots, dashes and brackets are how people write numbers legibly. */
const FORMATTING = /[\s.\-()/]/g;

export interface PhoneNumberResult {
  /** Digits only, country code first — what WhatsApp addresses by. */
  readonly whatsAppNumber: string | null;
  readonly reason: PhoneNumberRefusal | null;
}

export const PhoneNumberRefusal = {
  MISSING: "MISSING",
  /** No `+`, so which country it belongs to is genuinely unknown. */
  NOT_INTERNATIONAL: "NOT_INTERNATIONAL",
  /** Letters, an extension, or too few or too many digits. */
  NOT_A_NUMBER: "NOT_A_NUMBER",
} as const;

export type PhoneNumberRefusal =
  (typeof PhoneNumberRefusal)[keyof typeof PhoneNumberRefusal];

/**
 * Turns a stored number into a WhatsApp address, or says why it cannot.
 *
 * Returns a result rather than throwing: "this driver's number is unusable" is
 * an ordinary answer that the caller reports to an operator, not an exceptional
 * condition.
 */
export function toWhatsAppNumber(
  storedPhoneNumber: string | null,
): PhoneNumberResult {
  const trimmed = (storedPhoneNumber ?? "").trim();

  if (trimmed === "") {
    return refused(PhoneNumberRefusal.MISSING);
  }

  const compact = trimmed.replace(FORMATTING, "");

  /*
   * `00` is the other way of writing a leading `+` — it is what a phone keypad
   * produces for an international call, and it appears in address books for
   * exactly that reason. Both mean "a country code follows".
   */
  const international = compact.startsWith("+")
    ? compact.slice(1)
    : compact.startsWith("00")
      ? compact.slice(2)
      : null;

  if (international === null) {
    return refused(PhoneNumberRefusal.NOT_INTERNATIONAL);
  }

  if (!/^\d+$/.test(international)) {
    return refused(PhoneNumberRefusal.NOT_A_NUMBER);
  }

  if (
    international.length < MINIMUM_DIGITS ||
    international.length > MAXIMUM_DIGITS
  ) {
    return refused(PhoneNumberRefusal.NOT_A_NUMBER);
  }

  return { whatsAppNumber: international, reason: null };
}

function refused(reason: PhoneNumberRefusal): PhoneNumberResult {
  return { whatsAppNumber: null, reason };
}
