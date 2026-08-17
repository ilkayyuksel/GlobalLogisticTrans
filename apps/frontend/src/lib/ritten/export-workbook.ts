import type { Trip } from "@/lib/api/types";
import type { Language } from "@/lib/i18n/translations";
import { TRANSLATIONS } from "@/lib/i18n/translations";
import { downloadBlob } from "@/lib/download";
import { combinationLabel } from "./combination";

/**
 * The Ritten export, as a real `.xlsx`.
 *
 * A genuine workbook, written by a spreadsheet library — not a CSV under an
 * xlsx name, which Excel opens with a warning and which loses every type.
 *
 * The sheet mirrors the operational table, minus the columns that mean nothing
 * in a file: the Custom column (not available in a list), the PDF indicator and
 * the action menu. Dates and times stay text in exactly the form the backend
 * sent them, because they are calendar values without a timezone and letting a
 * spreadsheet reinterpret them is how a planning date becomes yesterday.
 *
 * Nothing is calculated here. Pricing in particular is absent: it is the
 * backend's, and an exported total that disagreed with the snapshot would be
 * worse than no total at all.
 *
 * The spreadsheet library is imported ONLY when an export actually runs. It is
 * by far the largest dependency this application has, and a planner who never
 * presses Exporteren should never pay for it.
 */

/** Column keys reuse the table's own translation keys, so headers match. */
const COLUMNS = [
  { key: "ritten.column.group", width: 12 },
  { key: "ritten.column.status", width: 12 },
  { key: "ritten.column.licensePlate", width: 14 },
  { key: "ritten.column.driver", width: 20 },
  { key: "ritten.column.date", width: 12 },
  { key: "ritten.column.start", width: 8 },
  { key: "ritten.column.end", width: 8 },
  { key: "ritten.column.container", width: 16 },
  { key: "ritten.column.containerType", width: 10 },
  { key: "ritten.column.booking", width: 18 },
  { key: "ritten.column.terminal", width: 20 },
  { key: "ritten.column.address", width: 26 },
  { key: "ritten.column.waitingTime", width: 10 },
] as const;

const HEADER_FILL_COLOR = "FF0B1220";
const HEADER_FONT_COLOR = "FFF8FAFC";

export function exportFileName(periodStart: string, periodEnd: string): string {
  return periodStart === periodEnd
    ? `traxo-ritten-${periodStart}.xlsx`
    : `traxo-ritten-${periodStart}_${periodEnd}.xlsx`;
}

export async function buildTripWorkbook(
  trips: readonly Trip[],
  language: Language,
): Promise<ArrayBuffer> {
  const translations = TRANSLATIONS[language];
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(translations["ritten.title"]);

  sheet.columns = COLUMNS.map((column) => ({
    header: translations[column.key],
    width: column.width,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_COLOR },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const trip of trips) {
    sheet.addRow(toRow(trip, translations));
  }

  return workbook.xlsx.writeBuffer();
}

function toRow(
  trip: Trip,
  translations: (typeof TRANSLATIONS)[Language],
): (string | number | null)[] {
  return [
    trip.tripGroupId ? combinationLabel(trip.tripGroupId) : "",
    translations[`status.${trip.status}`],
    trip.vehicle ? trip.vehicle.licensePlate : "",
    // The driver the BACKEND resolved, never one worked out here.
    trip.effectiveDriver ? trip.effectiveDriver.name : "",
    trip.planningDate,
    trip.startTime ?? "",
    trip.endTime ?? "",
    trip.containerNumber ?? "",
    trip.containerType,
    trip.bookingNumber,
    trip.terminal ?? "",
    `${trip.destinationCity}, ${trip.destinationCountry}`,
    trip.waitingTimeMinutes,
  ];
}

/**
 * Hands the workbook to the browser as a download.
 *
 * Split from the building above so the sheet can be tested without a DOM. The
 * download itself is shared with the PDF download; only the media type differs.
 */
export function downloadWorkbook(buffer: ArrayBuffer, fileName: string): void {
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName,
  );
}
