import type { BookingCorrection, ContainerCorrection, DateCorrection } from "../matching/invoice-row-match";
import type { AddedRow } from "../missing/added-rows";
import {
  DifferenceKind,
  type CellWrite,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { isShownRed, isWritable } from "./amount-cell-writer";
import type { FuelHeaderChange } from "./fuel-header";
import { toColumnLetter } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * Every change the corrected document may contain, decided BEFORE anything is
 * written — the plan the written file is held against
 * (`workbook-integrity-check.ts`).
 *
 * ── FROM THE DECISIONS, NOT FROM THE WRITER ─────────────────────────────────
 * It is built from what the examination decided — the pricing outcomes, the
 * corrections, the added lines, the Fuel header — and never from what the
 * writer reports having done. A writer that wrote one cell too many, or one
 * too few, is caught precisely because the plan does not ask it.
 *
 * All addresses are in the coordinates of the WRITTEN document: rows at or
 * below the opening for added lines have moved down by their number.
 */
export interface ChangePlan {
  /** Where added lines open room, and how many; null when none are added. */
  readonly opening: { readonly fromRow: number; readonly count: number } | null;
  /** Cells whose content this check sets, by address. */
  readonly cells: ReadonlyMap<string, PlannedCell>;
  /** Existing rows painted yellow, from column 1 to `lastColumnNumber`. */
  readonly yellowRows: ReadonlySet<number>;
  readonly lastColumnNumber: number;
  /** The totals row and summary block: their cached results and zero format may change. */
  readonly totalsRows: ReadonlySet<number>;
  readonly addedRows: readonly PlannedAddedRow[];
  /** Where an added line states the numbers it is recognised by. */
  readonly identityColumns: {
    readonly bookingNumber: number | undefined;
    readonly containerNumber: number | undefined;
  };
  /** Whether the totals' structure was sound before writing, and must be after. */
  readonly structureSound: boolean;
}

/** What a planned cell must hold once written. */
export type PlannedContent =
  | { readonly kind: "TEXT"; readonly text: string }
  /** A calendar day, `YYYY-MM-DD`, in whichever form the cell already held one. */
  | { readonly kind: "DATE"; readonly date: string }
  | { readonly kind: "WRITE"; readonly write: CellWrite };

export interface PlannedCell {
  readonly reason: string;
  readonly content: PlannedContent;
  /** Its text turns red; otherwise its font stays the customer's. */
  readonly red: boolean;
}

export interface PlannedAddedRow {
  readonly rowNumber: number;
  readonly tripId: string;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
  readonly yellow: boolean;
}

export interface ChangePlanInput {
  readonly sheet: InvoiceSheet;
  readonly pricing: ReadonlyMap<number, InvoiceRowPricing>;
  readonly yellowRowNumbers: readonly number[];
  readonly containerCorrections: ReadonlyMap<number, ContainerCorrection>;
  readonly bookingCorrections: ReadonlyMap<number, BookingCorrection>;
  readonly dateCorrections: ReadonlyMap<number, DateCorrection>;
  readonly remarks: ReadonlyMap<number, string>;
  readonly fuelHeader: FuelHeaderChange | null;
  readonly added: readonly AddedRow[];
  readonly firstAddedRowNumber: number | null;
  readonly structureSound: boolean;
}

export function planChanges(input: ChangePlanInput): ChangePlan {
  const { sheet } = input;
  const opening =
    input.firstAddedRowNumber !== null && input.added.length > 0
      ? { fromRow: input.firstAddedRowNumber, count: input.added.length }
      : null;
  const moved = (rowNumber: number) =>
    opening !== null && rowNumber >= opening.fromRow ? rowNumber + opening.count : rowNumber;
  const cells = new Map<string, PlannedCell>();
  const plan = (column: number | undefined, rowNumber: number, cell: PlannedCell) => {
    if (column !== undefined) {
      cells.set(`${toColumnLetter(column)}${moved(rowNumber)}`, cell);
    }
  };

  planAmounts(input, plan);
  planTexts(input, plan);
  planFuelHeader(input.fuelHeader, (address, text) =>
    cells.set(movedAddress(address, moved), {
      reason: "Fuel-kop",
      content: { kind: "TEXT", text },
      red: false,
    }),
  );

  return {
    opening,
    cells,
    yellowRows: new Set(input.yellowRowNumbers.map(moved)),
    lastColumnNumber: sheet.lastColumnNumber,
    totalsRows: new Set(
      [...(sheet.totalsRowNumber === null ? [] : [sheet.totalsRowNumber]), ...sheet.summaryRowNumbers].map(
        moved,
      ),
    ),
    addedRows: input.added.map((row, index) => ({
      rowNumber: (opening?.fromRow ?? 0) + index,
      tripId: row.trip.id,
      bookingNumber: row.trip.bookingNumber,
      containerNumber: row.trip.containerNumber,
      yellow: !row.reliability.reliable,
    })),
    identityColumns: {
      bookingNumber: sheet.columns.bookingNumber,
      containerNumber: sheet.columns.containerNumber,
    },
    structureSound: input.structureSound,
  };
}

/** How a written difference reads in a report: `Tarief verhoogd`. */
const CHANGE_WORDS: Partial<Record<DifferenceKind, string>> = {
  [DifferenceKind.RAISE]: "verhoogd",
  [DifferenceKind.REMOVE]: "verwijderd",
  [DifferenceKind.KEEP_AMOUNT]: "bedrag vastgezet",
};

type PlanCell = (column: number | undefined, rowNumber: number, cell: PlannedCell) => void;

/** The amounts the pricing check decided — exactly the writes of writable lines. */
function planAmounts(input: ChangePlanInput, plan: PlanCell): void {
  for (const row of input.sheet.rows) {
    const outcome = input.pricing.get(row.rowNumber);

    if (!outcome || !isWritable(outcome)) {
      continue;
    }

    for (const difference of outcome.differences) {
      if (difference.write === null || difference.correctionRowNumber === null || !difference.column) {
        continue;
      }

      plan(input.sheet.columns[difference.column], difference.correctionRowNumber, {
        reason: `${difference.component} ${CHANGE_WORDS[difference.kind] ?? difference.kind}`,
        content: { kind: "WRITE", write: difference.write },
        red: isShownRed(difference.kind),
      });
    }
  }
}

/** Corrected numbers and dates and completed Remarks — always in red. */
function planTexts(input: ChangePlanInput, plan: PlanCell): void {
  const { columns } = input.sheet;
  const texts: [number | undefined, string, ReadonlyMap<number, string>][] = [
    [columns.containerNumber, "containernummer gecorrigeerd", mapText(input.containerCorrections, (c) => c.tripContainerNumber)],
    [columns.bookingNumber, "boekingsnummer gecorrigeerd", mapText(input.bookingCorrections, (c) => c.tripBookingNumber)],
    [columns.remarks, "Remarks aangevuld", input.remarks],
  ];

  for (const [column, reason, byRow] of texts) {
    for (const [rowNumber, text] of byRow) {
      plan(column, rowNumber, { reason, content: { kind: "TEXT", text }, red: true });
    }
  }

  for (const [rowNumber, correction] of input.dateCorrections) {
    plan(columns.planningDate, rowNumber, {
      reason: "datum gecorrigeerd",
      content: { kind: "DATE", date: correction.tripPlanningDate },
      red: true,
    });
  }
}

function planFuelHeader(
  change: FuelHeaderChange | null,
  plan: (address: string, text: string) => void,
): void {
  for (const text of change === null ? [] : [change.header, change.label]) {
    if (text !== null) {
      plan(text.address, text.after);
    }
  }
}

function mapText<T>(byRow: ReadonlyMap<number, T>, toText: (value: T) => string): Map<number, string> {
  return new Map([...byRow].map(([rowNumber, value]) => [rowNumber, toText(value)]));
}

/** `K131` as it will be addressed once the rows below the opening moved. */
function movedAddress(address: string, moved: (rowNumber: number) => number): string {
  const match = /^([A-Z]+)(\d+)$/.exec(address);

  return match === null ? address : `${match[1]}${moved(Number(match[2]))}`;
}
