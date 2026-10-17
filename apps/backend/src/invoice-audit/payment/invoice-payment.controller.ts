import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import {
  ConfirmInvoicePaymentDto,
  InvoicePaymentResultDto,
} from "../dto/invoice-payment.dto";
import type { UploadedInvoiceFile } from "../invoice-examination.service";
import { InvoicePaymentService } from "./invoice-payment.service";

/**
 * The separate, confirmed step that settles transports on a weekly invoice.
 *
 * Its own controller because it is its own decision: the check and the
 * corrected file change nothing in this system, and this changes exactly one
 * thing — `isPaid` on the Trips the operator chose.
 */
@ApiTags("Invoice audit")
@Controller("invoice-audit")
export class InvoicePaymentController {
  constructor(private readonly payment: InvoicePaymentService) {}

  @Post("payment")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Confirm the payment of transports on a weekly invoice",
    description:
      "Takes the ORIGINAL invoice again with the Trip ids the operator chose from the check's `payments`. The document is examined again; every chosen Trip must still be payable on it, or the whole request is refused and nothing is paid. The payable ones not yet paid are marked paid in one transaction; ones already paid are left as they are.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        tripIds: { type: "string", description: 'A JSON array of Trip ids: `["9c0f…"]`.' },
      },
      required: ["file", "tripIds"],
    },
  })
  @ApiOkResponse({ type: InvoicePaymentResultDto })
  @ApiBadRequestResponse({
    description: "The refusals of the check, or a selection that is not a list of Trip ids.",
  })
  @ApiConflictResponse({
    description:
      "A chosen Trip is not payable on this invoice (any more); the reasons travel in the details. Nothing was paid.",
  })
  confirm(
    @UploadedFile() file: UploadedInvoiceFile | undefined,
    @Body() selection: ConfirmInvoicePaymentDto,
  ): Promise<InvoicePaymentResultDto> {
    return this.payment.confirm(file, selection.tripIds);
  }
}
