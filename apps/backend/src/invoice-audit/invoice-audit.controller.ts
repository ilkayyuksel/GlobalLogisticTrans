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
 * ── NEITHER OF THESE PAYS ANYTHING ──────────────────────────────────────────
 * `check` READS and previews. The customer's workbook goes up, the result comes
 * back, and nothing in this system or in that file changes — an operator can
 * run it as often as they like, on anything, without consequence.
 *
 * `apply` answers with the corrected document — the same reading, written into
 * the customer's own file. It changes nothing in this system either.
 *
 * Settling is a third, separate confirmation: `InvoicePaymentController`.
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
      "Reads an uploaded .xlsx weekly invoice and previews its correction: per line, the Trip it was matched to, the price comparison and the cells the corrected document would write; the lines marked yellow; the transports added; the totals before and after; and which transports a payment confirmation may settle. Nothing is written: no Trip is marked paid, and the uploaded file is neither stored nor modified.",
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
   * The corrected document.
   *
   * ── IT IS THEIR FILE, CORRECTED ───────────────────────────────────────────
   * Not a new export: the uploaded workbook itself, with the price cells a
   * difference named written into it, the transports it forgot added below it,
   * and the lines nobody could resolve marked yellow. Its columns, formats,
   * hidden columns, formulas, totals row and summary block are the customer's
   * own and are not rebuilt.
   *
   * ── AND IT PAYS NOTHING ───────────────────────────────────────────────────
   * Producing the file is not a decision about money. Settling is confirmed
   * separately, on `POST invoice-audit/payment`.
   *
   * The file is answered as bytes rather than in the envelope, so the browser
   * can save it. What it did travels in headers beside it; the detail is the
   * `check` endpoint's own answer.
   */
  @Post("apply")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Produce the corrected weekly invoice",
    description:
      "Writes the previewed corrections into the uploaded workbook itself — raised amounts, corrected numbers and completed Remarks in red, the finished unpaid transports the invoice does not state as added lines, the lines needing review in yellow — and answers with the file. Nothing in this system changes: no Trip is marked paid.",
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
      "The corrected .xlsx workbook. What the run wrote travels in the X-Invoice-* headers: rows added, cells corrected and rows marked.",
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
