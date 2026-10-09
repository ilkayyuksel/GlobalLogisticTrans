import type { Language } from "@/lib/i18n/translations";

/**
 * Custom Values in alphabetical order, the same way on every screen that lists
 * them for a person to find one.
 *
 * ── WHAT ORDER, PRECISELY ───────────────────────────────────────────────────
 * The language's own alphabet, through `Intl.Collator` for the language the
 * screen is shown in:
 *
 *   letter case is ignored         `extra` sits beside `Extra`
 *   accents follow their letter     `Éénmalig` sits with the E's
 *   Turkish letters keep their place in Turkish: ç after c, ı before i, ş after s
 *   numbers count as numbers        `Wacht 2` before `Wacht 10`
 *
 * Names that compare equal on those terms fall back to a full comparison, then
 * to the id, so the order never depends on the order the data arrived in.
 *
 * ── WHAT IT LEAVES ALONE ────────────────────────────────────────────────────
 * It returns a sorted COPY and changes nothing about the values themselves.
 * The backend's `displayOrder` — the order properties were created in — still
 * decides everything that is not a list to pick from: the Excel columns and
 * the Custom Values shown on a Ritten row keep it.
 */
export function sortAlphabetically<TItem>(
  items: readonly TItem[],
  nameOf: (item: TItem) => string,
  idOf: (item: TItem) => string,
  language: Language,
): TItem[] {
  const byLetters = new Intl.Collator(language, {
    sensitivity: "base",
    numeric: true,
  });
  const exactly = new Intl.Collator(language, { numeric: true });

  return [...items].sort(
    (left, right) =>
      byLetters.compare(nameOf(left), nameOf(right)) ||
      exactly.compare(nameOf(left), nameOf(right)) ||
      idOf(left).localeCompare(idOf(right)),
  );
}
