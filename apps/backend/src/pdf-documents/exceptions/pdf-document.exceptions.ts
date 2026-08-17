import { GoneException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for reading a stored transport order.
 *
 * Neither message names a path. The storage layout is the backend's alone: a
 * client asks for a document by id and receives bytes or a reason, never a
 * location it could try to reach itself.
 */

export class PdfDocumentNotFoundException extends NotFoundException {
  constructor(pdfDocumentId: string) {
    super(`PDF document "${pdfDocumentId}" does not exist.`);
  }
}

/**
 * The row is there; the file is not.
 *
 * 410 rather than 404 because the distinction is operationally real: a 404
 * means the id is wrong, this means the document was imported and its bytes
 * have since gone missing from storage — a backup or a restore problem, not a
 * typo.
 */
export class PdfContentMissingException extends GoneException {
  constructor(pdfDocumentId: string) {
    super(
      `The stored file for PDF document "${pdfDocumentId}" is missing. The document was imported, but its content is no longer in storage.`,
    );
  }
}
