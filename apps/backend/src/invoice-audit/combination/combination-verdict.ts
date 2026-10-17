import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceCombination,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import type { ExcelCombinationPair, ExcelCombinations } from "./excel-combination-pairs";

/**
 * Whether the Excel's Combination is the system's — decided per PAIR.
 *
 * ── ONE LEG PROVES NOTHING ──────────────────────────────────────────────────
 * Both rows must each be matched to one finished Trip, two different Trips.
 * Then the system's own grouping decides (the Backload follows membership):
 *
 *   same group, and that group holds exactly these two    RECOGNISED
 *   neither Trip belongs to any group                      GEEN_COMBI
 *   anything else — one grouped, two groups, a group of
 *   three, a row not matched                               REVIEW
 *
 * GEEN_COMBI is the one outcome that changes the invoice beyond a raise: both
 * lines get `GEEN COMBI` and lose their Backload. So it is only ever reached
 * from two reliably matched Trips that are demonstrably ungrouped. Whether a
 * RECOGNISED pair was also PRICED as that Combination is the price check's
 * question (`price-reliability.ts`).
 */
export function judgeCombinations(
  matches: readonly InvoiceRowMatch[],
  excel: ExcelCombinations,
  groupSizes: ReadonlyMap<string, number>,
): Map<number, InvoiceCombination> {
  const byRow = new Map(matches.map((match) => [match.row.rowNumber, match]));
  const verdicts = new Map<number, InvoiceCombination>();

  for (const pair of excel.pairs) {
    const { verdict, reason } = judgePair(
      byRow.get(pair.first.rowNumber),
      byRow.get(pair.second.rowNumber),
      groupSizes,
    );

    verdicts.set(pair.first.rowNumber, { verdict, reason, partnerRowNumber: pair.second.rowNumber });
    verdicts.set(pair.second.rowNumber, { verdict, reason, partnerRowNumber: pair.first.rowNumber });
  }

  for (const { row, reason } of excel.unpaired) {
    verdicts.set(row.rowNumber, {
      verdict: CombinationVerdict.REVIEW,
      partnerRowNumber: null,
      reason,
    });
  }

  return verdicts;
}

/** The group ids a judgement needs counted: those of the paired, matched Trips. */
export function groupIdsOf(
  matches: readonly InvoiceRowMatch[],
  pairs: readonly ExcelCombinationPair[],
): string[] {
  const paired = new Set(pairs.flatMap((pair) => [pair.first.rowNumber, pair.second.rowNumber]));

  return [
    ...new Set(
      matches
        .filter((match) => paired.has(match.row.rowNumber))
        .map((match) => match.trip?.tripGroupId ?? null)
        .filter((groupId): groupId is string => groupId !== null),
    ),
  ];
}

function judgePair(
  first: InvoiceRowMatch | undefined,
  second: InvoiceRowMatch | undefined,
  groupSizes: ReadonlyMap<string, number>,
): { verdict: CombinationVerdict; reason: string | null } {
  if (!isResolved(first) || !isResolved(second)) {
    return review("Beide regels van de combinatie moeten elk aan één afgewerkte rit gekoppeld zijn.");
  }

  if (first.trip!.id === second.trip!.id) {
    return review("Beide regels van de combinatie zijn dezelfde rit.");
  }

  const firstGroup = first.trip!.tripGroupId ?? null;
  const secondGroup = second.trip!.tripGroupId ?? null;

  if (firstGroup === null && secondGroup === null) {
    return { verdict: CombinationVerdict.GEEN_COMBI, reason: null };
  }

  if (firstGroup === null || secondGroup === null) {
    return review("Slechts één van beide ritten hoort bij een groep.");
  }

  if (firstGroup !== secondGroup) {
    return review("Beide ritten horen bij verschillende groepen.");
  }

  const size = groupSizes.get(firstGroup) ?? 0;

  return size === 2
    ? { verdict: CombinationVerdict.RECOGNISED, reason: null }
    : review(`De groep van deze ritten telt ${size} ritten in plaats van twee.`);
}

function isResolved(match: InvoiceRowMatch | undefined): match is InvoiceRowMatch {
  return (
    match !== undefined &&
    match.trip !== null &&
    (match.status === InvoiceRowStatus.MATCHED || match.status === InvoiceRowStatus.ADDED_MISSING)
  );
}

function review(reason: string): { verdict: CombinationVerdict; reason: string } {
  return { verdict: CombinationVerdict.REVIEW, reason };
}
