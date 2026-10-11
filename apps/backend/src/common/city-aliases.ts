/**
 * City spellings the owner confirmed: equivalences at the CITY end of a road.
 *
 * ── ONLY WHAT WAS CONFIRMED (OCTOBER 2026) ──────────────────────────────────
 *   `Antwerp` = `Antwerpen` — a whole-value alias, below.
 *   `Saint`   = `St`        — a WORD rule inside a city name (`St Martin au
 *                             Laert` = `Saint Martin au Laert`); see
 *                             `route-pricing/location-forms.ts`.
 *   a qualifier in brackets is optional — `Melsele` may be `Melsele (Beveren)`
 *                             — but only as a controlled candidate selection
 *                             in the route matcher, never by deleting it.
 *
 * Nothing else is equivalent: `Sint` is not `St`, a village is not the town in
 * whose brackets it appears (`Muizen` / `Mechelen (Muizen)`), and no country,
 * region or municipality is inferred. A new entry is added here once the owner
 * confirms it — the matcher reads this list for every trigger.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface CityAliasGroup {
  /** The comparison form every alias in the group is read as. */
  readonly canonical: string;
  /** Every confirmed spelling, already in comparison form (lower case). */
  readonly aliases: readonly string[];
}

export const CITY_ALIAS_GROUPS: readonly CityAliasGroup[] = [
  { canonical: "antwerpen", aliases: ["antwerp", "antwerpen"] },
];

const CANONICAL_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  CITY_ALIAS_GROUPS.flatMap((group) =>
    group.aliases.map((alias) => [alias, group.canonical] as const),
  ),
);

/** The confirmed equivalent of a city name in comparison form, or the name. */
export function canonicalCityAlias(normalizedCity: string): string {
  return CANONICAL_BY_ALIAS.get(normalizedCity) ?? normalizedCity;
}
