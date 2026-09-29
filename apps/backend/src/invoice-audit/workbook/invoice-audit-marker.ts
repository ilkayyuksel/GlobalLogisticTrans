import ExcelJS from "exceljs";

/**
 * Which lines of a document this system added itself.
 *
 * ── WHY A DOCUMENT HAS TO REMEMBER THIS ─────────────────────────────────────
 * A transport the invoice forgot is written in below it and deliberately left
 * unpaid: nobody has paid for a line the customer never sent. But the corrected
 * document now STATES that transport, so uploading it again would read it as an
 * ordinary invoice line and settle it — money marked received because we added
 * the line ourselves.
 *
 * ── AND WHY THE ANSWER LIVES IN THE FILE ────────────────────────────────────
 * The protection belongs to this document, not to the transport. Next week the
 * customer may invoice that same transport for real, and then it must be paid
 * exactly like any other line. A flag on the Trip would outlive the document and
 * block that forever; a record in the file cannot, because a new invoice is a
 * new file.
 *
 * ── WHY A HIDDEN SHEET, AND NOT SOMETHING SMALLER ───────────────────────────
 * The alternatives were weighed and rejected:
 *
 *   * "every row below the totals was added by us" — a position is not a fact
 *     about origin. The customer writes rows wherever they like, and a document
 *     with anything after its summary block would have its own lines silently
 *     exempted from payment.
 *   * a marker column — forbidden, and rightly: the 21 columns are the
 *     customer's document.
 *   * a cell comment — visible, with a red corner on a line the customer never
 *     wrote.
 *   * a workbook property — one string for the whole file, which cannot say
 *     WHICH rows, and shows in Excel's own File → Info.
 *
 * A worksheet marked `veryHidden` is invisible in Excel's interface — it cannot
 * even be unhidden from the menu — survives being opened and saved, and can
 * hold a row per added line. It is the smallest thing that answers the question
 * being asked: which rows of THIS document did we add, and for which transport.
 */

/** The sheet's name. Prefixed so it cannot collide with a customer's own tab. */
export const AUDIT_MARKER_SHEET = "_trano_invoice_audit";

/** One line this system added to a document. */
export interface AuditMarkedRow {
  /** The row it occupies in the worksheet. */
  readonly rowNumber: number;
  readonly tripId: string;
  /** The identity the row was written with, so an edited row loses the mark. */
  readonly planningDate: string;
  readonly bookingNumber: string;
  readonly normalizedContainerNumber: string;
}

const HEADER = [
  "rowNumber",
  "tripId",
  "planningDate",
  "bookingNumber",
  "containerNumber",
] as const;

/**
 * The lines a previous run of this check added to this document.
 *
 * An empty map for every document that has never been through it — a customer's
 * own invoice, or one produced by anything else.
 */
export function readAuditMarkers(
  workbook: ExcelJS.Workbook,
): ReadonlyMap<number, AuditMarkedRow> {
  const sheet = workbook.getWorksheet(AUDIT_MARKER_SHEET);
  const markers = new Map<number, AuditMarkedRow>();

  if (!sheet) {
    return markers;
  }

  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    // The header of the marker sheet itself.
    if (number === 1) {
      return;
    }

    const rowNumber = Number(row.getCell(1).value);

    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      return;
    }

    markers.set(rowNumber, {
      rowNumber,
      tripId: text(row.getCell(2).value),
      planningDate: text(row.getCell(3).value),
      bookingNumber: text(row.getCell(4).value),
      normalizedContainerNumber: text(row.getCell(5).value),
    });
  });

  return markers;
}

/**
 * Records which lines this system added, replacing whatever was recorded before.
 *
 * The caller passes the WHOLE set — the lines a previous run added and the ones
 * this run is adding — because the sheet is rewritten rather than appended to.
 * That keeps one record of one document, whatever order the runs happened in.
 */
export function writeAuditMarkers(
  workbook: ExcelJS.Workbook,
  markers: readonly AuditMarkedRow[],
): void {
  if (markers.length === 0) {
    return;
  }

  const existing = workbook.getWorksheet(AUDIT_MARKER_SHEET);

  if (existing) {
    workbook.removeWorksheet(existing.id);
  }

  const sheet = workbook.addWorksheet(AUDIT_MARKER_SHEET);

  /*
   * Not merely hidden: a hidden sheet is one right-click away from being shown,
   * and this is bookkeeping rather than something to read. Excel offers no way
   * to unhide it from the interface at all.
   */
  sheet.state = "veryHidden";
  sheet.addRow([...HEADER]);

  for (const marker of [...markers].sort((a, b) => a.rowNumber - b.rowNumber)) {
    sheet.addRow([
      marker.rowNumber,
      marker.tripId,
      marker.planningDate,
      marker.bookingNumber,
      marker.normalizedContainerNumber,
    ]);
  }
}

function text(value: ExcelJS.CellValue): string {
  return value === null || value === undefined ? "" : String(value).trim();
}
