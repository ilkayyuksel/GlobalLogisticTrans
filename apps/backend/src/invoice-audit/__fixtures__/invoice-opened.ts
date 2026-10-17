import type { AppLoggerService } from "../../logger/app-logger.service";
import { InvoiceSheetReader, type OpenedInvoiceWorkbook } from "../workbook/invoice-sheet.reader";
import { buildInvoiceWorkbook, type InvoiceFixtureOptions } from "./invoice-workbook";

const MONDAY = new Date(Date.UTC(2026, 2, 23));

const SILENT = {
  setContext: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as AppLoggerService;

/**
 * Three lines on rows 2–4 with Fuel as `10%*L<row>`, totals on 5, a blank line,
 * and the summary block on 7–16 (its Fuel label on K8) — the shape of every
 * real week, at a size a test can reason about. Opened as the check opens it.
 */
export async function openThreeLineWeek(
  options: Partial<InvoiceFixtureOptions> = {},
): Promise<OpenedInvoiceWorkbook> {
  const line = (bookingNumber: string, containerNumber: string) => ({
    planningDate: MONDAY,
    bookingNumber,
    containerNumber,
    tarief: 135,
    fuel: "formula" as const,
  });
  const file = await buildInvoiceWorkbook({
    lines: [
      line("DUBANR2718284", "EUCU 4581604"),
      line("BELANR2720016", "EUCU 2451828"),
      line("ANRDUB2725107", "TLLU 1595717"),
    ],
    ...options,
  });

  return new InvoiceSheetReader(SILENT).open(file, "week 13 - 2026 GLT.xlsx");
}
