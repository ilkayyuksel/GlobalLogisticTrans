import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from "@nestjs/swagger";

import { InvoiceAuditResultDto } from "./dto/invoice-audit.dto";
import {
  InvoiceAuditService,
  type UploadedInvoiceFile,
} from "./invoice-audit.service";

/**
 * The weekly invoice check, and its final processing.
 *
 * ── TWO ENDPOINTS, AND THE DIFFERENCE IS THE POINT ──────────────────────────
 * `check` READS. The customer's workbook goes up, the result comes back, and
 * nothing in this system or in that file changes — an operator can run it as
 * often as they like, on anything, without consequence.
 *
 * `apply` DOES IT. The same reading, then the corrected document and the
 * payments it implies, in that order: the file is produced and serialised
 * first, and only once those bytes exist is anything marked paid. It answers
 * with the file, so the browser makes one request rather than a correction call
 * followed by a hundred payment calls.
 *
 * There is no GET and no history. The result of a check is the file the
 * operator is holding plus what this answered about it; storing a copy would be
 * a second record of the same week.
 */
@ApiTags("Invoice audit")
@Controller("invoice-audit")
export class InvoiceAuditController {
  constructor(private readonly invoiceAudit: InvoiceAuditService) {}

  @Post("check")
  // Nothing is created: this reads a document and answers about it.
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Check a customer weekly invoice against the Trips in this system",
    description:
      "Reads an uploaded .xlsx weekly invoice and reports, per line, whether this system holds a CLOSED Trip for it. A line is identified by exactly three values — Planning date, Bookingnr and Container nr. — with the container compared in its normalised form, and there is no fallback to fewer of them. Nothing is written: no price is corrected, no Trip is marked paid, and the uploaded file is neither stored nor modified.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description:
            "The weekly invoice, as .xlsx. Validated on its actual content, not on the declared content type.",
        },
      },
      required: ["file"],
    },
  })
  @ApiOkResponse({ type: InvoiceAuditResultDto })
  @ApiBadRequestResponse({
    description:
      "No file, a file that is not an .xlsx workbook, or a workbook whose header row does not offer the required columns — the missing ones are named in the details.",
  })
  @ApiPayloadTooLargeResponse({
    description: "The workbook is larger than the configured upload limit.",
  })
  check(
    @UploadedFile() file: UploadedInvoiceFile | undefined,
  ): Promise<InvoiceAuditResultDto> {
    return this.invoiceAudit.check(file);
  }

  /**
   * The final processing: the corrected document, and the payments it settles.
   *
   * ── IT IS THEIR FILE, CORRECTED ───────────────────────────────────────────
   * Not a new export: the uploaded workbook itself, with the price cells a
   * difference named written into it, the transports it forgot added below it,
   * and the lines nobody could resolve marked yellow. Its columns, formats,
   * hidden columns, formulas, totals row and summary block are the customer's
   * own and are not rebuilt.
   *
   * ── AND IT SETTLES WHAT THE INVOICE COVERS ────────────────────────────────
   * Every line that matched exactly one CLOSED Trip and whose pricing was
   * reconciled marks that Trip paid — a corrected price included, because the
   * correction is the answer. The transports ADDED below are not paid: they
   * were not on the document the customer sent.
   *
   * The file is answered as bytes rather than in the envelope, so the browser
   * can save it. What it did travels in headers beside it, which is what the
   * screen reports; the detail is the `check` endpoint's own answer.
   */
  @Post("apply")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Process a weekly invoice: correct it, complete it, and settle it",
    description:
      "Writes the differences into the uploaded workbook itself — only the amount cells of lines matched to exactly one CLOSED Trip, with the effective pricing of that Trip as the correct figure — adds the finished unpaid transports of the same period the invoice does not state, marks the unresolved lines yellow, and then marks the matched Trips paid. The file is produced and serialised BEFORE anything is paid, so a document that cannot be produced settles nothing. No row is moved, no Trip changes status, and nothing but `isPaid` is written.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  @ApiOkResponse({
    description:
      "The corrected .xlsx workbook. What the run did travels in the X-Invoice-* headers: paid Trips, Trips already paid, rows added, cells corrected and rows marked.",
  })
  @ApiBadRequestResponse({
    description: "The same refusals the check answers with.",
  })
  async apply(
    @UploadedFile() file: UploadedInvoiceFile | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const applied = await this.invoiceAudit.apply(file);

    /*
     * Set HERE rather than as a decorator on the method: a decorator would put
     * the spreadsheet type on a REFUSAL too, and a refusal is the ordinary JSON
     * envelope. It is only a workbook once there is a workbook.
     */
    response.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    /*
     * The customer's own file name, with a word saying what happened to it. It
     * is quoted and stripped of any path by the service, so it can only ever be
     * a name.
     */
    response.setHeader(
      "content-disposition",
      `attachment; filename="${toCorrectedName(applied.fileName)}"`,
    );

    /*
     * What the run did, beside the file it produced. Counts only — a header is
     * not the place for a document, and the detail is what `check` answers.
     * `Access-Control-Expose-Headers` is what lets a browser on another origin
     * read them at all.
     */
    const counts: Record<string, number> = {
      "X-Invoice-Paid-Trips": applied.paidTrips,
      "X-Invoice-Already-Paid": applied.alreadyPaid,
      "X-Invoice-Rows-Added": applied.rowsAdded,
      "X-Invoice-Rows-Marked": applied.rowsMarked,
      "X-Invoice-Cells-Corrected": applied.cellsWritten,
    };

    for (const [header, value] of Object.entries(counts)) {
      response.setHeader(header, String(value));
    }

    response.setHeader(
      "access-control-expose-headers",
      ["content-disposition", ...Object.keys(counts)].join(", "),
    );

    return new StreamableFile(applied.workbook);
  }
}

/** `week 13 - 2026 GLT.xlsx` becomes `week 13 - 2026 GLT - gecorrigeerd.xlsx`. */
function toCorrectedName(fileName: string): string {
  const extension = ".xlsx";
  const base = fileName.toLowerCase().endsWith(extension)
    ? fileName.slice(0, -extension.length)
    : fileName;

  return `${base} - gecorrigeerd${extension}`;
}
