import { Controller, Get, Param, Query, StreamableFile } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { PdfDocumentIdParamDto } from "./dto/pdf-document-id-param.dto";
import { PDF_MIME_TYPE, PdfDocumentService } from "./pdf-document.service";

/**
 * The bytes of a stored transport order.
 *
 * ONE endpoint, and it returns content — never metadata. There is deliberately
 * no `GET /pdf-documents/:id`: a PdfDocument row describes where a file lives
 * and what its hash is, and none of that is a client's business. The document's
 * meaningful facts already travel on the Trips that came from it.
 *
 * Viewing and downloading are the same resource with a different disposition,
 * so `?download=true` is a query parameter rather than a second route. The
 * browser decides how to render it from the header alone.
 */
@ApiTags("PDF documents")
@Controller("pdf-documents")
export class PdfDocumentController {
  constructor(private readonly pdfDocumentService: PdfDocumentService) {}

  /*
   * The content type is set on the StreamableFile rather than with @Header,
   * and that distinction matters: a header declared on the route applies to
   * FAILURES too, which would label a JSON error response as a PDF and leave a
   * client unable to read the reason.
   */
  @Get(":id/content")
  @ApiOperation({
    summary: "Read a stored transport order",
    description:
      "Streams the PDF as it was imported. Add download=true to have the browser save it instead of displaying it; the file is offered under the name it arrived with. The storage path is never exposed, and no client ever reads the filesystem.",
  })
  @ApiQuery({
    name: "download",
    required: false,
    description:
      "true offers the file as a download; anything else displays it inline.",
  })
  @ApiOkResponse({
    description: "The PDF bytes.",
    content: { [PDF_MIME_TYPE]: { schema: { type: "string", format: "binary" } } },
  })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No PDF document with that id." })
  @ApiGoneResponse({
    description:
      "The document exists but its stored file is missing from storage.",
  })
  async getContent(
    @Param() params: PdfDocumentIdParamDto,
    @Query("download") download?: string,
  ): Promise<StreamableFile> {
    const { content, originalFilename } =
      await this.pdfDocumentService.readContent(params.id);

    return new StreamableFile(content, {
      type: PDF_MIME_TYPE,
      disposition: `${download === "true" ? "attachment" : "inline"}; filename="${toSafeFilename(originalFilename)}"`,
    });
  }
}

/**
 * A filename safe to put in a header.
 *
 * The stored name arrived from an email attachment or an upload, so it is
 * untrusted text: a quote or a newline in it would let the sender write their
 * own header fields. Everything outside a conservative set is replaced, and the
 * name is only ever a label — the file is located by its id.
 */
function toSafeFilename(originalFilename: string): string {
  const cleaned = originalFilename.replace(/[^A-Za-z0-9._-]/g, "_");

  return cleaned.length > 0 ? cleaned : "transport-order.pdf";
}
