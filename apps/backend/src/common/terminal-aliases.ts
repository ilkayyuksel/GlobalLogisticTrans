/**
 * Terminal aliases the owner confirmed: spellings that name ONE terminal.
 *
 * ── ONLY WHAT WAS CONFIRMED ─────────────────────────────────────────────────
 * Every group below was confirmed by the owner (October 2026). Nothing is
 * inferred: a spelling that merely looks alike, another quay number, or a
 * place that contains the word "Quay" or "Kaai" is NOT an alias. A new group
 * is added here, and only here, once it is confirmed — the route matcher
 * reads this list for every trigger, so nothing else changes.
 *
 * ── WHOLE VALUES, TERMINAL SIDE ONLY ────────────────────────────────────────
 * An alias is compared against the WHOLE value, after safe normalisation (case,
 * surrounding and repeated spaces, harmless punctuation) — never as a word
 * inside a longer value. And the matcher applies it only to the terminal end
 * of a road, never to the city.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface TerminalAliasGroup {
  /** The spelling the group stands for. */
  readonly canonical: string;
  /** Every confirmed spelling, the canonical one included. */
  readonly aliases: readonly string[];
}

export const TERMINAL_ALIAS_GROUPS: readonly TerminalAliasGroup[] = [
  {
    canonical: "Quay 869",
    // `K869` confirmed by the owner, October 2026.
    aliases: ["Quay 869", "Quay", "PSA Quay", "PSA Quay 869", "Kaai", "K869"],
  },
];

const HARMLESS_PUNCTUATION = /[-_.,'’/()[\]]/g;
const WHITESPACE_RUN = /\s+/g;

/** The comparison form of a terminal spelling: case, spaces and punctuation. */
function aliasKey(value: string): string {
  return value
    .toLowerCase()
    .replace(HARMLESS_PUNCTUATION, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

const CANONICAL_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  TERMINAL_ALIAS_GROUPS.flatMap((group) =>
    group.aliases.map((alias) => [aliasKey(alias), group.canonical] as const),
  ),
);

/**
 * The canonical terminal a value is a confirmed alias of, or null when it is
 * none — in which case the caller keeps the value as it is.
 */
export function canonicalTerminalAlias(value: string): string | null {
  return CANONICAL_BY_ALIAS.get(aliasKey(value)) ?? null;
}
