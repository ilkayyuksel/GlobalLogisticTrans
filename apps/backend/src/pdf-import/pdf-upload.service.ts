import { BadRequestException, Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { MANUAL_UPLOAD_PROVENANCE } from "../pdf-documents/pdf-document.service";
import {
  PdfImportFileResultDto,
  PdfImportResponseDto,
  cancelledFileResult,
  importedFileResult,
  refusedFileResult,
} from "./dto/pdf-import-response.dto";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import {
  UploadFailure,
  UploadFailureCode,
  describeImportFailure,
} from "./upload-failure";
import { UploadedPdfFile } from "./uploaded-pdf-file";

/**
 * Every PDF begins with this marker.
 *
 * Checked in the bytes rather than in the declared content type, because the
 * content type is whatever the client chose to write. A renamed spreadsheet
 * announcing itself as a PDF is refused here instead of failing later inside
 * the parser, where the reason would be far less clear.
 */
const PDF_HEADER = "%PDF-";

/**
 * Writers occasionally emit a byte-order mark or a stray newline before the
 * header, and readers are expected to tolerate it, so the marker is looked for
 * near the start rather than exactly at offset zero.
 */
const PDF_HEADER_SEARCH_BYTES = 1024;

/**
 * Manual upload of transport-order PDFs.
 *
 * This service owns one decision: which uploaded files are worth handing to the
 * importer, and how each file's outcome is reported. It does not parse, store,
 * create Trips or price anything — `PdfTripImporter` does all of that, exactly
 * as it does for the mailbox, so a manually uploaded order and an emailed one
 * become the same rows by the same route.
 *
 * Files are processed one after another and each is reported on its own. A
 * batch is a batch of independent documents: the second file's failure says
 * nothing about the first, and wrapping them together would either roll back
 * good imports or hide bad ones.
 */
@Injectable()
export class PdfUploadService {
  constructor(
    private readonly importer: PdfTripImporter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PdfUploadService.name);
  }

  /**
   * Imports each uploaded file and reports one result per file.
   *
   * Only one thing fails the request itself: sending no files at all. That is a
   * malformed request rather than a document problem, and there is no file to
   * report it against.
   */
  async importUploadedFiles(
    files: readonly UploadedPdfFile[],
  ): Promise<PdfImportResponseDto> {
    if (files.length === 0) {
      throw new BadRequestException(
        'No files were uploaded. Send one or more PDFs in the "files" field of a multipart/form-data request.',
      );
    }

    const results: PdfImportFileResultDto[] = [];

    // Sequential on purpose. Each import writes a file and runs a database
    // transaction; running a batch concurrently would multiply both for no gain
    // on an upload of a handful of documents, and would interleave the log.
    for (const file of files) {
      results.push(await this.importOne(file));
    }

    this.logger.log("Manual PDF upload finished", {
      fileCount: files.length,
      importedFileCount: results.filter((result) => result.ok).length,
    });

    return { results };
  }

  private async importOne(
    file: UploadedPdfFile,
  ): Promise<PdfImportFileResultDto> {
    const refusal = this.refuse(file);

    if (refusal !== null) {
      this.logger.warn("Uploaded file refused before import", {
        originalFilename: file.originalname,
        byteCount: file.size,
        errorCode: refusal.code,
      });

      return refusedFileResult(file.originalname, refusal);
    }

    try {
      // A copy, not the multipart buffer itself: buffers from the request are
      // pooled, and the parser is entitled to take ownership of what it is
      // given.
      const imported = await this.importer.import(
        new Uint8Array(file.buffer),
        file.originalname,
        { provenance: MANUAL_UPLOAD_PROVENANCE },
      );

      // A cancelled document was handled, not imported: it creates no Trip, so
      // it is reported for what it did rather than as an import of nothing.
      if (imported.cancellations.length > 0) {
        this.logger.log("Uploaded cancellation processed", {
          originalFilename: file.originalname,
          byteCount: file.size,
          outcomes: imported.cancellations.map((entry) => entry.outcome),
        });

        return cancelledFileResult(file.originalname, imported.cancellations);
      }

      this.logger.log("Uploaded transport order imported", {
        originalFilename: file.originalname,
        byteCount: file.size,
        tripIds: imported.trips.map((trip) => trip.id),
        combination: imported.combination,
      });

      return importedFileResult(
        file.originalname,
        imported.trips,
        imported.combination,
      );
    } catch (error: unknown) {
      return this.recordFailure(file, error);
    }
  }

  /**
   * Reports one file's import failure without letting it fail the request.
   *
   * An anticipated refusal — an unreadable document, a booking that already
   * exists — is a warning: the system worked and the document did not. Anything
   * unrecognised is an error with its stack, because that is a defect, and it
   * must be diagnosable even though the client is told only that something went
   * wrong.
   */
  private recordFailure(
    file: UploadedPdfFile,
    error: unknown,
  ): PdfImportFileResultDto {
    const failure = describeImportFailure(error);

    if (failure.expected) {
      this.logger.warn("Uploaded transport order could not be imported", {
        originalFilename: file.originalname,
        errorCode: failure.code,
        reason: error instanceof Error ? error.message : String(error),
      });
    } else {
      this.logger.error("Uploaded transport order failed unexpectedly", {
        originalFilename: file.originalname,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    return refusedFileResult(file.originalname, failure);
  }

  /**
   * Why this file must not reach the importer, or null when it may.
   *
   * Size is not checked here: the limit is enforced while the request is still
   * being read, so an oversized file never becomes an `UploadedPdfFile` at all.
   */
  private refuse(file: UploadedPdfFile): UploadFailure | null {
    if (file.size === 0 || file.buffer.length === 0) {
      return {
        code: UploadFailureCode.EMPTY_FILE,
        message: `"${file.originalname}" is empty.`,
        expected: true,
      };
    }

    if (!hasPdfHeader(file.buffer)) {
      return {
        code: UploadFailureCode.NOT_A_PDF,
        message: `"${file.originalname}" is not a PDF file.`,
        expected: true,
      };
    }

    return null;
  }
}

function hasPdfHeader(content: Buffer): boolean {
  return (
    content.subarray(0, PDF_HEADER_SEARCH_BYTES).indexOf(PDF_HEADER) !== -1
  );
}
