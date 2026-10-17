import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate } from "../../common/dates";
import { AppLoggerService } from "../../logger/app-logger.service";
import type {
  BookingCorrection,
  ContainerCorrection,
} from "../matching/invoice-row-matching.service";
import type { AddedRow } from "../missing/added-rows";
import type { InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { isWritable, releaseBorrowedFormulas, writeRowAmounts } from "./amount-cell-writer";
import { markRowsYellow, writeTextInRed } from "./cell-marking";
import { writeFuelHeader, type FuelHeaderChange } from "./fuel-header";
import { writeAuditMarkers } from "./invoice-audit-marker";
import {
  toAddedRowTemplate,
  toFirstAddedRowNumber,
  type AddedRowTemplate,
} from "./added-row-template";
import { writeAddedRow } from "./invoice-row-appender";
import { openRowsAt } from "./invoice-row-inserter";
import type { InvoiceSheet } from "./invoice-sheet";
import { refreshTotals } from "./totals-refresher";

/** Everything beside the amounts that the corrected document carries. */
export interface WorkbookCorrections {
  /**
   * The lines for finished transports the invoice never mentioned. Only given
   * when the document's totals can take them — see `totals-structure.ts`.
   */
  readonly added?: readonly AddedRow[];
  /** A new Fuel header and label — see `fuel-header.ts`. */
  readonly fuelHeader?: FuelHeaderChange | null;
  /** Lines marked yellow: somebody has to look at them. */
  readonly problemRowNumbers?: readonly number[];
  readonly containerCorrections?: ReadonlyMap<number, ContainerCorrection>;
  readonly bookingCorrections?: ReadonlyMap<number, BookingCorrection>;
  /** Remarks completed by this check, as the cell will hold them. */
  readonly remarks?: ReadonlyMap<number, string>;
}

export interface WorkbookCorrectionOutcome {
  readonly cellsWritten: number;
  readonly rowsCorrected: number;
  readonly rowsAdded: number;
  readonly firstAddedRowNumber: number | null;
  readonly rowsMarked: number;
  readonly containersCorrected: number;
  readonly bookingsCorrected: number;
  readonly remarksCompleted: number;
  readonly fuelHeaderChanged: boolean;
}

/**
 * Writes the corrections into the customer's own workbook.
 *
 * ── THE DOCUMENT IS THEIRS, AND IT STAYS THEIRS ─────────────────────────────
 * This writes into the workbook that was READ, never into a new one. Its
 * columns, widths, euro formats, hidden Maut and Tol FR, per-row formulas,
 * totals row and summary block are therefore not preserved by effort — they are
 * simply never touched. The only cells this writes are the ones the check
 * planned: amounts (`amount-cell-writer.ts`), corrected numbers and completed
 * Remarks in red, the yellow of a problem line (`cell-marking.ts`), the added
 * lines, and the cached results those changes made stale (`totals-refresher.ts`).
 *
 * ── NO ROW IS MOVED THROUGH `spliceRows` ────────────────────────────────────
 * These workbooks carry shared formulas and ExcelJS cannot move rows through
 * them. Added lines open room with `openRowsAt`, which rewrites every formula
 * for the move itself.
 */
@Injectable()
export class InvoiceSheetWriter {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(InvoiceSheetWriter.name);
  }

  /**
   * Applies every planned correction, and answers what it wrote.
   *
   * A line that was not compared — no CLOSED Trip, an unfinished one, several —
   * carries no planned write and therefore cannot be written to: the check is
   * the only source of what may change.
   */
  apply(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    pricing: ReadonlyMap<number, InvoiceRowPricing>,
    corrections: WorkbookCorrections = {},
  ): WorkbookCorrectionOutcome {
    /*
     * Read before ANYTHING is written: the added lines take the look the
     * customer's lines have as they were sent, not as this check marked them.
     */
    const template = toAddedRowTemplate(worksheet, sheet);
    const amounts = this.writeAmounts(worksheet, sheet, pricing);
    const containersCorrected = writeTextInRed(
      worksheet,
      sheet.columns.containerNumber,
      mapValues(corrections.containerCorrections, (correction) => correction.tripContainerNumber),
    );
    const bookingsCorrected = writeTextInRed(
      worksheet,
      sheet.columns.bookingNumber,
      mapValues(corrections.bookingCorrections, (correction) => correction.tripBookingNumber),
    );
    const remarksCompleted = writeTextInRed(
      worksheet,
      sheet.columns.remarks,
      corrections.remarks ?? new Map(),
    );
    /*
     * Everything addressed by the row numbers the check reported happens
     * BEFORE the added lines open space above the totals row; after that, a
     * row below the opening is on another number.
     */
    const problemRows = markRowsYellow(
      worksheet,
      corrections.problemRowNumbers ?? [],
      sheet.lastColumnNumber,
    );

    if (corrections.fuelHeader) {
      writeFuelHeader(worksheet, corrections.fuelHeader);
    }

    const added = this.appendMissing(
      workbook,
      worksheet,
      sheet,
      template && corrections.fuelHeader
        ? { ...template, fuelPercentage: new Prisma.Decimal(corrections.fuelHeader.percentage) }
        : template,
      corrections.added ?? [],
    );
    // An added line whose price is not relied on stands there for review.
    const rowsMarked =
      problemRows +
      markRowsYellow(
        worksheet,
        (corrections.added ?? []).flatMap((row, index) =>
          added.firstAddedRowNumber !== null && !row.reliability.reliable
            ? [added.firstAddedRowNumber + index]
            : [],
        ),
        sheet.lastColumnNumber,
      );

    if (amounts.cellsWritten > 0 || added.rowsAdded > 0) {
      refreshTotals(worksheet, sheet, added.rowsAdded);

      /*
       * Excel recalculates everything on open. The cached results this writer
       * could compute are already correct; this is what covers the ones it
       * deliberately did not touch.
       */
      workbook.calcProperties.fullCalcOnLoad = true;
    }

    const outcome = {
      ...amounts,
      ...added,
      rowsMarked,
      containersCorrected,
      bookingsCorrected,
      remarksCompleted,
      fuelHeaderChanged: Boolean(corrections.fuelHeader),
    };

    this.logger.log("Invoice workbook corrected", { ...outcome });

    return outcome;
  }

  private writeAmounts(
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    pricing: ReadonlyMap<number, InvoiceRowPricing>,
  ): { cellsWritten: number; rowsCorrected: number } {
    const released = releaseBorrowedFormulas(worksheet, sheet, pricing);

    if (released.masters > 0) {
      this.logger.log("Shared formulas released before correcting", released);
    }

    let cellsWritten = 0;
    let rowsCorrected = 0;

    for (const row of sheet.rows) {
      const outcome = pricing.get(row.rowNumber);

      if (!outcome || !isWritable(outcome)) {
        continue;
      }

      const written = writeRowAmounts(worksheet, sheet.columns, outcome);

      cellsWritten += written;
      rowsCorrected += written > 0 ? 1 : 0;
    }

    return { cellsWritten, rowsCorrected };
  }

  /**
   * Writes the finished transports the invoice never mentioned, directly below
   * its last line and directly above its totals.
   *
   * ── ROOM IS MADE, NOT FOUND ───────────────────────────────────────────────
   * The totals row and everything below it move down by the number of added
   * lines — see `openRowsAt`, which does it without `spliceRows` and rewrites
   * every formula for the move. The totals' ranges grow over the added lines,
   * the summary block follows the totals it reads, and no line the customer
   * wrote changes its row, because all of them are above the opening.
   */
  private appendMissing(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    sheet: InvoiceSheet,
    template: AddedRowTemplate | null,
    missing: readonly AddedRow[],
  ): { rowsAdded: number; firstAddedRowNumber: number | null } {
    if (missing.length === 0) {
      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    if (template === null) {
      // A document with no line of its own offers no convention to follow, and
      // this will not invent one. Reported, never guessed at.
      this.logger.warn("Missing transports were not added: the invoice has no line to follow", {
        missing: missing.length,
      });

      return { rowsAdded: 0, firstAddedRowNumber: null };
    }

    const firstAddedRowNumber = toFirstAddedRowNumber(sheet);

    openRowsAt(worksheet, firstAddedRowNumber, missing.length);

    missing.forEach((trip, index) => {
      writeAddedRow(worksheet, sheet, template, trip, firstAddedRowNumber + index);
    });

    /*
     * ── THE DOCUMENT REMEMBERS WHAT WE WROTE INTO IT ──────────────────────
     * Together with whatever an earlier run recorded, so a document processed
     * twice still knows all of its added lines. Without this the next upload
     * would read them as the customer's own and settle transports nobody
     * invoiced — see `invoice-audit-marker.ts`.
     *
     * A line an earlier run added BELOW the opening has just moved down with
     * everything else, and its record moves with it. A record left on the old
     * number would stop recognising its line, and the next upload would pay it.
     */
    writeAuditMarkers(workbook, [
      ...[...sheet.addedByAudit.values()].map((marker) =>
        marker.rowNumber >= firstAddedRowNumber
          ? { ...marker, rowNumber: marker.rowNumber + missing.length }
          : marker,
      ),
      ...missing.map((trip, index) => ({
        rowNumber: firstAddedRowNumber + index,
        tripId: trip.trip.id,
        planningDate: trip.trip.planningDate ? toIsoDate(trip.trip.planningDate) : "",
        bookingNumber: trip.trip.bookingNumber ?? "",
        normalizedContainerNumber: normalizeContainerNumber(trip.trip.containerNumber) ?? "",
      })),
    ]);

    this.logger.log("Missing transports added to the invoice", {
      rowsAdded: missing.length,
      firstAddedRowNumber,
      recordedRows: sheet.addedByAudit.size + missing.length,
    });

    return { rowsAdded: missing.length, firstAddedRowNumber };
  }
}

/** A map's values turned into the text a cell will hold. */
function mapValues<T>(
  map: ReadonlyMap<number, T> | undefined,
  toText: (value: T) => string,
): Map<number, string> {
  return new Map([...(map ?? new Map<number, T>())].map(([rowNumber, value]) => [rowNumber, toText(value)]));
}
