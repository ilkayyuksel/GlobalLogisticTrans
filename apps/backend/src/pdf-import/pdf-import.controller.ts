import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from "@nestjs/swagger";

import { PdfImportResponseDto } from "./dto/pdf-import-response.dto";
import { PdfUploadService } from "./pdf-upload.service";
import { UploadedPdfFile } from "./uploaded-pdf-file";

/**
 * Manual upload of transport-order PDFs.
 *
 * The one public way into the import. It receives files and returns what each
 * one produced; every decision after that — parsing, storage, Trips, groups —
 * belongs to `PdfUploadService` and `PdfTripImporter`, which the mailbox uses
 * unchanged.
 *
 * There is deliberately no GET, no upload history and no status endpoint. The
 * result of an upload is the Trips it created, and those are already readable
 * at /trips; a second record of the same event would be a second truth to keep
 * in step with the first.
 */
@ApiTags("Imports")
@Controller("pdf-import")
export class PdfImportController {
  constructor(private readonly pdfUploadService: PdfUploadService) {}

  @Post()
  // 200 rather than 201: the request always reports per file, and a batch in
  // which every document was refused created nothing.
  @HttpCode(HttpStatus.OK)
  /*
   * Any field name is accepted because "files" and "files[]" are both ordinary
   * encodings of an array field, and a client that picks the other one deserves
   * a result rather than a rejected field. The count and size limits that
   * matter are configured centrally, on the multipart module.
   */
  @UseInterceptors(AnyFilesInterceptor())
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Import transport-order PDFs",
    description:
      "Uploads one or more transport-order PDFs and imports each of them. Every file is processed independently: one unreadable document does not affect the others, so the request succeeds and reports per file. A file that describes a Combination produces two Trips under one TripGroup, each keeping its own booking number. Imported Trips are OPEN and unpriced — pricing happens when a Trip is closed. Re-uploading a document that was already imported is refused as a duplicate booking rather than creating the Trips twice.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
          description:
            "One or more PDF files. Each is validated on its actual content, not on the declared content type.",
        },
      },
      required: ["files"],
    },
  })
  @ApiOkResponse({
    type: PdfImportResponseDto,
    description: "One result per uploaded file, successful or not.",
  })
  @ApiBadRequestResponse({
    description:
      "The request carried no files, or more files than one upload may contain.",
  })
  @ApiPayloadTooLargeResponse({
    description:
      "A file exceeded PDF_UPLOAD_MAX_SIZE_MB. The limit is applied while the request is being read, so the whole upload is refused.",
  })
  importPdfs(
    // Absent rather than empty when the request carries no file part at all;
    // the service reports that as a malformed request.
    @UploadedFiles() files?: UploadedPdfFile[],
  ): Promise<PdfImportResponseDto> {
    return this.pdfUploadService.importUploadedFiles(files ?? []);
  }
}
