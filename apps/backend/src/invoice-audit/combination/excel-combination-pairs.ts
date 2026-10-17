import type { InvoiceSheetRow } from "../workbook/invoice-sheet";

/**
 * The Combinations the customer's Excel itself marks.
 *
 * ── THE CONVENTION, AS EVERY REAL WEEK WRITES IT ────────────────────────────
 * In all 13 pairs of week 41 (and every pair of weeks 13 and 36): the first leg
 * — out of the terminal — has `COMBINATION ` as its Endpoint, the second leg —
 * back to the terminal — has it as its Startpoint, the second is the row
 * directly below the first, and both rows state the same container.
 *
 * ── HOW A PAIR IS FOUND, AND WHEN IT IS NOT ─────────────────────────────────
 * A first leg pairs with the row directly below it when that is a second leg
 * with the same container. Failing that, with the ONE second leg in the
 * document stating its container. Anything else — no partner, several, a row
 * marked as both legs, a second leg two first legs claim — is not a pair and is
 * reported for review. A container alone never makes a pair: containers are
 * reused (week 41: CNEU 4692827 on R2 and on R109).
 */
const MARKER = "COMBINATION";

export interface ExcelCombinationPair {
  readonly first: InvoiceSheetRow;
  readonly second: InvoiceSheetRow;
}

export interface UnpairedCombinationRow {
  readonly row: InvoiceSheetRow;
  readonly reason: string;
}

export interface ExcelCombinations {
  readonly pairs: readonly ExcelCombinationPair[];
  readonly unpaired: readonly UnpairedCombinationRow[];
}

export function findExcelCombinations(rows: readonly InvoiceSheetRow[]): ExcelCombinations {
  const ordered = rows
    .filter((row) => row.costLine === null)
    .sort((left, right) => left.rowNumber - right.rowNumber);
  const firsts = ordered.filter((row) => isMarker(row.endPoint) && !isMarker(row.startPoint));
  const seconds = ordered.filter((row) => isMarker(row.startPoint) && !isMarker(row.endPoint));
  const unpaired: UnpairedCombinationRow[] = ordered
    .filter((row) => isMarker(row.startPoint) && isMarker(row.endPoint))
    .map((row) => ({ row, reason: "the row is marked as both legs of a Combination" }));

  const claims = new Map<InvoiceSheetRow, InvoiceSheetRow[]>();

  for (const first of firsts) {
    const partner = partnerOf(first, ordered, seconds);

    if (typeof partner === "string") {
      unpaired.push({ row: first, reason: partner });
    } else {
      claims.set(partner, [...(claims.get(partner) ?? []), first]);
    }
  }

  const pairs: ExcelCombinationPair[] = [];

  for (const second of seconds) {
    const claimedBy = claims.get(second) ?? [];

    if (claimedBy.length === 1) {
      pairs.push({ first: claimedBy[0], second });
    } else if (claimedBy.length === 0) {
      unpaired.push({ row: second, reason: "no first leg of this Combination was found" });
    } else {
      const reason = `rows ${claimedBy.map((row) => row.rowNumber).join(", ")} all claim the same second leg`;

      unpaired.push({ row: second, reason }, ...claimedBy.map((row) => ({ row, reason })));
    }
  }

  return { pairs, unpaired };
}

/** The second leg a first leg pairs with, or why it has none. */
function partnerOf(
  first: InvoiceSheetRow,
  ordered: readonly InvoiceSheetRow[],
  seconds: readonly InvoiceSheetRow[],
): InvoiceSheetRow | string {
  const next = ordered[ordered.indexOf(first) + 1];

  if (next !== undefined && seconds.includes(next) && sameContainer(first, next)) {
    return next;
  }

  const sharing = seconds.filter((second) => sameContainer(first, second));

  if (sharing.length === 1) {
    return sharing[0];
  }

  return sharing.length === 0
    ? `no second leg with container ${first.containerNumber} was found`
    : `several second legs state container ${first.containerNumber}`;
}

function sameContainer(left: InvoiceSheetRow, right: InvoiceSheetRow): boolean {
  return left.normalizedContainerNumber !== "" &&
    left.normalizedContainerNumber === right.normalizedContainerNumber;
}

function isMarker(text: string): boolean {
  return text.trim().toUpperCase() === MARKER;
}
