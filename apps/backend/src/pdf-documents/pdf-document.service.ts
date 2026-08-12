import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImportSource, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "./pdf-document.repository";
import { removeStoredPdf, storePdf } from "./pdf-storage";

/** Every PDF this system imports is a transport order. */
export const PDF_MIME_TYPE = "application/pdf";

/**
 * A PDF written to disk, with the row that would describe it.
 *
 * The row is data, not a record: the import persists it inside the same
 * transaction as the Trips, so nothing is committed here.
 */
export interface PreparedPdfDocument {
  readonly document: Prisma.PdfDocumentUncheckedCreateInput;
  /** Passed back to `discard` if the import then fails. */
  readonly absolutePath: string;
  /**
   * True when an earlier import already recorded these exact bytes.
   *
   * Storage is content-addressed, so the second import of a document writes to
   * the path the first one is still using. Discarding that file would strip the
   * evidence from a Trip that imported successfully days ago, so this flag is
   * what keeps cleanup from reaching beyond the import that failed.
   */
  readonly bytesAlreadyOwned: boolean;
}

/**
 * The PdfDocument domain.
 *
 * Small on purpose. A PdfDocument is not something a user manages — it is the
 * record of a file that arrived — so there is no CRUD API, no update and no
 * delete endpoint. The service owns one thing: getting a PDF safely onto disk
 * and describing it, so that no caller has to know where files live or how they
 * are named.
 */
@Injectable()
export class PdfDocumentService {
  constructor(
    private readonly repository: PdfDocumentRepository,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PdfDocumentService.name);
  }

  /**
   * Writes the PDF and builds the row describing it.
   *
   * Every field is derived from the bytes themselves, never from the sender:
   * the size and hash are measured, the mime type is fixed, and the filename is
   * recorded as data only — it never influences the path. `uploadedAt` is left
   * to the column default so the database stays the single clock.
   */
  async store(
    content: Uint8Array,
    originalFilename: string,
    parserVersion: string,
  ): Promise<PreparedPdfDocument> {
    const stored = await storePdf(this.storageDirectory(), content);
    const existing = await this.repository.findByFileHash(stored.fileHash);

    this.logger.log("Transport order PDF stored", {
      fileHash: stored.fileHash,
      fileSizeBytes: stored.fileSizeBytes,
      previouslyImportedDocumentId: existing ? existing.id : null,
    });

    return {
      document: {
        importSource: ImportSource.MANUAL_UPLOAD,
        originalFilename,
        storagePath: stored.storagePath,
        fileSizeBytes: BigInt(stored.fileSizeBytes),
        fileHash: stored.fileHash,
        mimeType: PDF_MIME_TYPE,
        parserVersion,
      },
      absolutePath: stored.absolutePath,
      bytesAlreadyOwned: existing !== null,
    };
  }

  /**
   * Removes a file written for an import that then failed.
   *
   * A database transaction cannot roll back the filesystem, so this is the
   * compensating half. It does nothing when the bytes were already on disk for
   * an earlier import, and it never throws — the caller is already reporting a
   * real failure, and a cleanup error must not replace that diagnosis.
   */
  async discard(prepared: PreparedPdfDocument): Promise<void> {
    if (prepared.bytesAlreadyOwned) {
      return;
    }

    await removeStoredPdf(prepared.absolutePath);

    this.logger.warn("Stored PDF discarded after a failed import", {
      fileHash: prepared.document.fileHash,
    });
  }

  private storageDirectory(): string {
    // Non-null: the environment is validated at boot, and PDF_STORAGE_DIR
    // carries a default, so it is always present by the time anything imports.
    return this.configService.getOrThrow<string>("PDF_STORAGE_DIR");
  }
}
