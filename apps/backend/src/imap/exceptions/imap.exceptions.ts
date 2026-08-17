/**
 * Mailbox failures, using the codes `error_codes.md` already defines.
 *
 * The catalogue is the contract: IMAP_001–IMAP_006 exist so a log line can be
 * searched for without knowing which class produced it. Inventing new codes
 * here would strand that catalogue.
 *
 * Like the Pricing Engine's and the PDF importer's, these do not extend Nest's
 * HTTP exceptions. A scan is driven by a scheduler as often as by a request, so
 * an HTTP status would be a guess about one of two callers.
 *
 * No message carries a password, an email body or attachment content.
 */

export const ImapErrorCode = {
  CONNECTION_FAILED: "IMAP_001",
  AUTHENTICATION_FAILED: "IMAP_002",
  DUPLICATE_EMAIL: "IMAP_003",
  NO_PDF_ATTACHMENT: "IMAP_004",
  ATTACHMENT_DOWNLOAD_FAILED: "IMAP_005",
  MAILBOX_ACCESS_FAILED: "IMAP_006",
  /**
   * Not in `error_codes.md`, because the catalogue describes ways a mailbox can
   * fail and this is the feature being switched off. Named rather than
   * numbered, so it cannot be mistaken for a documented mailbox failure.
   */
  DISABLED: "IMAP_DISABLED",
} as const;

export type ImapErrorCode = (typeof ImapErrorCode)[keyof typeof ImapErrorCode];

export abstract class ImapException extends Error {
  protected constructor(
    readonly code: ImapErrorCode,
    message: string,
  ) {
    super(message);
    // Without this the class name is lost through the transpiled prototype
    // chain, and `instanceof` checks in the scan service would fail.
    this.name = new.target.name;
  }
}

/**
 * A scan was asked for while mailbox ingestion is switched off.
 *
 * Refused before anything connects. Without this the endpoint would try to
 * reach an unconfigured host and report a connection failure, sending an
 * operator to check a mailbox when the real answer is a feature flag.
 */
export class ImapDisabledException extends ImapException {
  constructor() {
    super(
      ImapErrorCode.DISABLED,
      "Mailbox ingestion is disabled. Set ENABLE_IMAP=true and supply the IMAP settings to scan.",
    );
  }
}

/**
 * The mailbox could not be reached or opened.
 *
 * Fatal to the whole scan rather than to one email: without a connection there
 * is nothing to iterate, and marking anything processed would be a lie.
 */
export class ImapConnectionException extends ImapException {
  constructor(
    code: ImapErrorCode,
    readonly host: string,
    reason: string,
  ) {
    super(code, `Mailbox at ${host} is unavailable: ${reason}`);
  }
}

/**
 * The email carried no PDF, or carried more than one.
 *
 * Both are refusals of the same shape: `businessrules.md` states a supported
 * email contains exactly one PDF attachment, so anything else is a document
 * this system cannot interpret. Two PDFs are refused rather than half-imported,
 * because picking one arbitrarily would silently drop a real transport order.
 */
export class UnexpectedAttachmentCountException extends ImapException {
  constructor(
    readonly messageId: string,
    readonly pdfAttachmentCount: number,
  ) {
    super(
      ImapErrorCode.NO_PDF_ATTACHMENT,
      pdfAttachmentCount === 0
        ? `Email ${messageId} carries no PDF attachment.`
        : `Email ${messageId} carries ${pdfAttachmentCount} PDF attachments; exactly one is expected, and choosing between them would risk dropping an order.`,
    );
  }
}

/** The attachment was listed by the server but could not be retrieved. */
export class AttachmentDownloadException extends ImapException {
  constructor(
    readonly messageId: string,
    readonly filename: string,
    reason: string,
  ) {
    super(
      ImapErrorCode.ATTACHMENT_DOWNLOAD_FAILED,
      `Attachment "${filename}" of email ${messageId} could not be downloaded: ${reason}`,
    );
  }
}
