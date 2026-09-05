/**
 * When a TAR-nummer counts as stated.
 *
 * ── ONE RULE, BECAUSE FOUR LAYERS ASK IT ────────────────────────────────────
 * "Is this TAR-nummer meaningful?" is asked by the DTO that stores it, by the
 * group rule that shares it, by the WhatsApp caption that prints it and — since
 * this phase — by the Pricing Engine that charges for it. Four copies of
 * `value.trim().length > 0` is four chances for one of them to drift, and the
 * one that drifts decides whether money is charged.
 *
 * Kept as a pure module with no dependencies, exactly like
 * `flat-container-rule.ts`, so every layer can import the answer and none has
 * to inject it.
 *
 * ── WHITESPACE IS ABSENCE ───────────────────────────────────────────────────
 * `null`, `undefined`, `""`, `"   "` and `"\t"` all mean the same thing: this
 * Trip states no TAR-nummer. The DTO already stores a whitespace-only entry as
 * null, and this trims again rather than trusting that — the value also reaches
 * these callers from rows written before that rule existed, and from a database
 * an administrator can edit directly.
 *
 * ── IT SAYS NOTHING ABOUT WHAT A TAR-NUMMER LOOKS LIKE ──────────────────────
 * No format, no length, no pattern. The business writes whatever their
 * counterparty gave them; the only question here is whether they wrote
 * anything.
 */

/** Whether this Trip states a TAR-nummer at all. */
export function hasTarNummer(value: string | null | undefined): boolean {
  return meaningfulTarNummer(value) !== null;
}

/**
 * The stated TAR-nummer without its padding, or null when none was stated.
 *
 * Returning the trimmed value rather than a boolean is what lets a caller both
 * decide AND print without trimming a second time.
 */
export function meaningfulTarNummer(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
