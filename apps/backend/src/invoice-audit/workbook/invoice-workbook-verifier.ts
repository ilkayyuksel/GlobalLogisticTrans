import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

import { AppLoggerService } from "../../logger/app-logger.service";
import { InvoiceWorkbookIntegrityException } from "../exceptions/invoice-audit.exceptions";
import type { ChangePlan } from "./change-plan";
import { InvoiceSheetReader } from "./invoice-sheet.reader";
import { checkTotalsResults } from "./totals-results";
import { checkTotalsStructure } from "./totals-structure";
import { findUnplannedChanges } from "./workbook-integrity-check";

/**
 * The last gate before a corrected invoice leaves this system.
 *
 * ── THE BYTES, NOT THE OBJECTS ──────────────────────────────────────────────
 * Both the received file and the written one are read FRESH from their bytes,
 * by a new ExcelJS each, so what is checked is exactly what the customer would
 * open — not the in-memory workbook the writer worked on. Then:
 *
 *   1. every difference must be in the change plan (`workbook-integrity-check.ts`);
 *   2. a document whose totals were sound must still be: every component total
 *      covers the added lines, the grand total adds them up, the summary reads
 *      the moved totals row (`totals-structure.ts`, on the written document);
 *   3. every total shows what its lines add up to (`totals-results.ts`).
 *
 * Anything else refuses the whole file — `InvoiceWorkbookIntegrityException` —
 * so no file, no success and no payment can follow from it.
 */
@Injectable()
export class InvoiceWorkbookVerifier {
  constructor(
    private readonly reader: InvoiceSheetReader,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceWorkbookVerifier.name);
  }

  async verify(
    fileName: string,
    received: Buffer,
    written: Buffer,
    sheetName: string,
    plan: ChangePlan,
  ): Promise<void> {
    const [original, corrected] = await Promise.all([load(received), load(written)]);
    const problems = [
      ...findUnplannedChanges(original, corrected, sheetName, plan),
      ...(await this.totalsProblems(fileName, written, plan)),
    ];

    if (problems.length > 0) {
      this.logger.error("Corrected invoice failed its integrity check", {
        fileName,
        problemCount: problems.length,
        problems,
      });

      throw new InvoiceWorkbookIntegrityException(problems);
    }

    this.logger.log("Corrected invoice verified against its plan", {
      fileName,
      plannedCells: plan.cells.size,
      yellowRows: plan.yellowRows.size,
      rowsAdded: plan.opening?.count ?? 0,
    });
  }

  private async totalsProblems(fileName: string, written: Buffer, plan: ChangePlan): Promise<string[]> {
    if (!plan.structureSound) {
      return [];
    }

    const { worksheet, sheet } = await this.reader.open(written, fileName);
    const structure = checkTotalsStructure(worksheet, sheet).problems;
    // The cached totals are rewritten only when an amount or a line changed;
    // otherwise they are the customer's own, and theirs to keep.
    const refreshed =
      plan.opening !== null || [...plan.cells.values()].some((cell) => cell.content.kind === "WRITE");

    return [...structure, ...(refreshed ? checkTotalsResults(worksheet, sheet) : [])];
  }
}

async function load(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

  return workbook;
}
