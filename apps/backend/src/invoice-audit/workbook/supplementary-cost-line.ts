import type { InvoiceAmountCell } from "./invoice-amounts";
import type { InvoiceColumn } from "./invoice-columns";
import type { InvoiceCostLine } from "./invoice-sheet";

/**
 * Whether a row is a Cost Confirmation line: one EC charge and nothing else.
 *
 * ── WHAT THE DOCUMENTS SHOW ─────────────────────────────────────────────────
 * Week 41 R53 reads, in full: `2026-10-06 · GLT · ANRDUB2812770 · BOUSBECQUE ->
 * Quay 869 · EK 110 · EC 4220981`. R107, week 13 R41 and week 36 R36–R37 have the
 * same shape, sometimes with a container. None of them states a transport's
 * own details — time, container type, start- or endpoint, route, distance — and
 * none of them states any amount but the EK. That shape, and an `EC <nr>` in
 * Remarks naming the confirmation, is what is recognised here. Nothing is
 * guessed from the Trip column's text.
 *
 * ── WHY IT MATTERS ──────────────────────────────────────────────────────────
 * Read as an ordinary line, R107 would be "missing" a Tarief and be raised to a
 * whole transport's price; read as incomplete, R53–R54 would leave their Trip
 * looking uninvoiced and get it added a second time, EK and all. A Cost
 * Confirmation line is compared with its own confirmation, and only its EK.
 */

/** The columns a transport's own line fills and a Cost Confirmation line never does. */
export const TRANSPORT_DETAIL_COLUMNS: readonly InvoiceColumn[] = [
  "time",
  "containerType",
  "startPoint",
  "distance",
  "route",
  "endPoint",
];

/** Every amount column but the EK. */
const NON_EK_AMOUNT_COLUMNS: readonly InvoiceColumn[] = [
  "tarief",
  "fuel",
  "backload",
  "maut",
  "tolB",
  "tolFr",
  "tunnel",
  "others",
];

/** `EC 4220981` as one comma-separated part of Remarks. */
const EC_PART = /^\s*EC\s*(\d+)\s*$/i;

export interface CostLineEvidence {
  /** The text of each transport-detail column, empty when blank. */
  readonly details: Partial<Record<InvoiceColumn, string>>;
  readonly amounts: Partial<Record<InvoiceColumn, InvoiceAmountCell>>;
  readonly remarks: string;
}

export function toCostLine(evidence: CostLineEvidence): InvoiceCostLine | null {
  const ccNumbers = toCcNumbers(evidence.remarks);
  const ek = evidence.amounts.ek;

  if (ccNumbers.length === 0 || !ek?.value || ek.value.lessThanOrEqualTo(0)) {
    return null;
  }

  const statesTransportDetails = TRANSPORT_DETAIL_COLUMNS.some(
    (column) => (evidence.details[column] ?? "") !== "",
  );
  const chargesMoreThanEk = NON_EK_AMOUNT_COLUMNS.some((column) => {
    const cell = evidence.amounts[column];

    return cell !== undefined && (cell.unreadable || (cell.value !== null && !cell.value.isZero()));
  });

  return statesTransportDetails || chargesMoreThanEk ? null : { ccNumbers };
}

/** Every confirmation number Remarks name as `EC <nr>`, each once, in order. */
export function toCcNumbers(remarks: string): string[] {
  const numbers = remarks
    .split(",")
    .map((part) => EC_PART.exec(part)?.[1] ?? null)
    .filter((number): number is string => number !== null);

  return [...new Set(numbers)];
}
