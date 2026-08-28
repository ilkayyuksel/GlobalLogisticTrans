/**
 * Which container types carry the Flat property, and what it is called.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A 20FL is a flat rack and a 20ST is a platform: neither is a box, both need
 * the same extra handling, and the business charges for it every time. So the
 * charge is not something an operator remembers to tick — the container type
 * already says it, and the system assigns the "Flat" property itself.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Kept as a pure module with no dependencies, because three layers need the
 * same answer: the Trip domain when it writes an assignment, the assignment
 * domain when it refuses a removal, and the tests of both. A predicate nobody
 * has to inject cannot drift between them.
 */

/**
 * The property this rule assigns, by the name it is configured under.
 *
 * Deliberately a NAME rather than an id. The property is configuration — an
 * administrator created it, and it carries a price that changes — so an id
 * literal here would be a copy of a database row inside the source, wrong the
 * first time the property is recreated in another environment. The name is
 * unique among active properties, which is what makes the lookup exact.
 *
 * It is not, however, configurable: this rule is about Flat specifically. A
 * setting would suggest an administrator may point it at another property, and
 * "20FL means whatever is configured today" is not the business rule.
 */
export const FLAT_CUSTOM_PROPERTY_NAME = "Flat";

/**
 * The container types that require it.
 *
 * An exact list, never a prefix or a substring: `20STUFF` and `20FLX` are not
 * flat racks, and a `startsWith` test would quietly charge for them. New types
 * appear regularly — the parser deliberately validates their SHAPE rather than
 * a closed list — so anything not named here is simply a container type this
 * rule says nothing about.
 */
const CONTAINER_TYPES_REQUIRING_FLAT: readonly string[] = [
  "20FL",
  "20ST",
  // The forty-foot flats, added once the business confirmed they carry Flat
  // exactly as the twenty-foot ones do. `40OSX` and `40F` are deliberately not
  // here — the match is exact, so neither is affected by this.
  "40FL",
  "40OS",
];

/**
 * Whether a Trip with this container type must carry the Flat property.
 *
 * The comparison trims and ignores case, which is the whole of the
 * normalisation the Trip domain applies: the parser returns the document's own
 * text and a manually created Trip is only trimmed, so `20fl` typed by hand is
 * the same container type as `20FL` printed on an order. It is still an exact
 * match on the code itself.
 *
 * A Trip with no container type — an ordinary state for one created by hand
 * before the details are known — requires nothing.
 */
export function requiresFlatProperty(containerType: string | null): boolean {
  // Falsy rather than `=== null`: an empty string is no more a container type
  // than a missing one, and this predicate is called from three layers.
  if (!containerType) {
    return false;
  }

  const normalised = containerType.trim().toUpperCase();

  return CONTAINER_TYPES_REQUIRING_FLAT.includes(normalised);
}
