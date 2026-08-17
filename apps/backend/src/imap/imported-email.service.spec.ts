import { EmailProcessingStatus, ImportType } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { MailboxMessage } from "./imap-mailbox.client";
import { ImportedEmailRepository } from "./imported-email.repository";
import { ImportedEmailService } from "./imported-email.service";

const IMPORTED_EMAIL_ID = "e1111111-1111-4111-8111-111111111111";

function mailboxMessage(
  overrides: Partial<MailboxMessage> = {},
): MailboxMessage {
  return {
    uid: 101,
    messageId: "<order-1@carrier.test>",
    senderEmail: "orders@carrier.test",
    subject: "NEW: Trucking Order 1212816",
    receivedAt: new Date("2026-08-13T06:00:00.000Z"),
    attachments: [],
    ...overrides,
  };
}

describe("ImportedEmailService", () => {
  let repository: {
    findByMessageId: jest.Mock;
    create: jest.Mock;
    updateStatus: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: ImportedEmailService;

  beforeEach(() => {
    repository = {
      findByMessageId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: IMPORTED_EMAIL_ID }),
      updateStatus: jest.fn().mockResolvedValue({ id: IMPORTED_EMAIL_ID }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new ImportedEmailService(
      repository as unknown as ImportedEmailRepository,
      logger as unknown as AppLoggerService,
    );
  });

  describe("startProcessing", () => {
    it("opens the record as PROCESSING", async () => {
      await service.startProcessing(mailboxMessage());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: EmailProcessingStatus.PROCESSING,
          importType: ImportType.NEW,
        }),
      );
    });

    it("records the message identity and receipt time", async () => {
      await service.startProcessing(mailboxMessage());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "<order-1@carrier.test>",
          senderEmail: "orders@carrier.test",
          subject: "NEW: Trucking Order 1212816",
          receivedAt: new Date("2026-08-13T06:00:00.000Z"),
        }),
      );
    });

    /**
     * The column is documented as debugging-only, and a transport order's body
     * adds nothing the PDF does not already carry.
     */
    it("never stores the email body", async () => {
      await service.startProcessing(mailboxMessage());

      const [written] = repository.create.mock.calls[0];

      expect(written.body).toBeUndefined();
    });

    it("leaves processedAt unset while work is in progress", async () => {
      await service.startProcessing(mailboxMessage());

      const [written] = repository.create.mock.calls[0];

      expect(written.processedAt).toBeUndefined();
    });
  });

  describe("recordIgnored", () => {
    it("stores the email as IGNORED with the instruction it asked for", async () => {
      await service.recordIgnored(
        mailboxMessage({ subject: "UPDATE: Booking Changed" }),
        ImportType.UPDATE,
        "UPDATE_NOT_SUPPORTED",
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: EmailProcessingStatus.IGNORED,
          importType: ImportType.UPDATE,
        }),
      );
    });

    it("logs the reason so the decision is auditable", async () => {
      await service.recordIgnored(
        mailboxMessage(),
        ImportType.NEW,
        "UNTRUSTED_SENDER",
      );

      expect(logger.log).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reason: "UNTRUSTED_SENDER" }),
      );
    });

    it("stores no body for an ignored email either", async () => {
      await service.recordIgnored(
        mailboxMessage(),
        ImportType.CANCEL,
        "CANCEL_NOT_SUPPORTED",
      );

      const [written] = repository.create.mock.calls[0];

      expect(written.body).toBeUndefined();
    });
  });

  describe("outcomes", () => {
    it("marks a processed email with the time it finished", async () => {
      await service.markProcessed(IMPORTED_EMAIL_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
        EmailProcessingStatus.PROCESSED,
        expect.any(Date),
      );
    });

    /** Nothing was processed, so processedAt must stay empty. */
    it("marks a failed email without a processed time", async () => {
      await service.markFailed(IMPORTED_EMAIL_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
        EmailProcessingStatus.FAILED,
        null,
      );
    });

    /**
     * An already-imported PDF is not an error: the Trips exist, which is the
     * correct outcome. FAILED would invite someone to "fix" a duplicate into
     * existence.
     */
    it("marks an already-imported email IGNORED rather than FAILED", async () => {
      await service.markAlreadyImported(IMPORTED_EMAIL_ID);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
        EmailProcessingStatus.IGNORED,
        expect.any(Date),
      );
    });
  });

  describe("findByMessageId", () => {
    it("asks the repository for the message id", async () => {
      await service.findByMessageId("<order-1@carrier.test>");

      expect(repository.findByMessageId).toHaveBeenCalledWith(
        "<order-1@carrier.test>",
      );
    });
  });
});
