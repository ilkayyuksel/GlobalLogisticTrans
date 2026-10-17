import type { AppLoggerService } from "../../logger/app-logger.service";
import type { TripExportLabelsService } from "../../trip-export/trip-export-labels.service";
import { InvoiceRemarksService } from "../remarks/invoice-remarks.service";
import { asReads, invoiceReads, type InvoiceReadsDouble } from "./invoice-reads";

const SILENT = {
  setContext: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as AppLoggerService;

/**
 * The Remarks planner, over a database that knows no Custom Property, no
 * confirmation and no TAR charge — so it adds nothing, for suites about
 * everything else. Pass `reads` and `tarCharged` to give it facts.
 */
export function noRemarks(
  reads: InvoiceReadsDouble = invoiceReads(),
  tarChargedTripIds: readonly string[] = [],
): InvoiceRemarksService {
  const exportLabels = {
    findForTrips: async (tripIds: readonly string[]) =>
      new Map(
        tripIds.map((tripId) => [tripId, { tarCharged: tarChargedTripIds.includes(tripId) }]),
      ),
  } as unknown as TripExportLabelsService;

  return new InvoiceRemarksService(asReads(reads), exportLabels, SILENT);
}
