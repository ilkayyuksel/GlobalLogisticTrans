import { ConfigService } from "@nestjs/config";
import { ImportSource } from "@prisma/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "./pdf-document.repository";
import { PDF_MIME_TYPE, PdfDocumentService } from "./pdf-document.service";
import { hashPdf } from "./pdf-storage";

const CONTENT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PARSER_VERSION = "1.0.0";

describe("PdfDocumentService", () => {
  let storageDirectory: string;
  let repository: { findByFileHash: jest.Mock; create: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: PdfDocumentService;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-pdf-service-"));

    repository = {
      findByFileHash: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    const configService = {
      getOrThrow: jest.fn().mockReturnValue(storageDirectory),
    };

    service = new PdfDocumentService(
      repository as unknown as PdfDocumentRepository,
      configService as unknown as ConfigService,
      logger as unknown as AppLoggerService,
    );
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe("store", () => {
    it("writes the file and describes it", async () => {
      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );

      await expect(readFile(prepared.absolutePath)).resolves.toEqual(
        Buffer.from(CONTENT),
      );
      expect(prepared.document).toMatchObject({
        importSource: ImportSource.MANUAL_UPLOAD,
        originalFilename: "order.pdf",
        mimeType: PDF_MIME_TYPE,
        fileHash: hashPdf(CONTENT),
        fileSizeBytes: BigInt(CONTENT.byteLength),
        parserVersion: PARSER_VERSION,
      });
    });

    it("records the original filename as data, not as the path", async () => {
      const prepared = await service.store(
        CONTENT,
        "../../.env",
        PARSER_VERSION,
      );

      expect(prepared.document.originalFilename).toBe("../../.env");
      expect(prepared.document.storagePath).toBe(`${hashPdf(CONTENT)}.pdf`);
    });

    it("persists nothing, because the import owns the transaction", async () => {
      await service.store(CONTENT, "order.pdf", PARSER_VERSION);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("leaves uploadedAt to the database default", async () => {
      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );

      expect(prepared.document.uploadedAt).toBeUndefined();
    });

    it("notices that an earlier import already owns these bytes", async () => {
      repository.findByFileHash.mockResolvedValue({ id: "existing" });

      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );

      expect(prepared.bytesAlreadyOwned).toBe(true);
    });

    it("logs the hash and size, never the filename's contents", async () => {
      await service.store(CONTENT, "order.pdf", PARSER_VERSION);

      expect(logger.log).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ fileHash: hashPdf(CONTENT) }),
      );
    });
  });

  describe("discard", () => {
    it("removes a file this import wrote", async () => {
      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );

      await service.discard(prepared);

      await expect(readFile(prepared.absolutePath)).rejects.toThrow();
    });

    /**
     * Storage is content-addressed, so re-importing a document writes to the
     * path the first import is still using. Deleting it would strip the
     * evidence from a Trip that imported successfully long ago.
     */
    it("keeps the file when an earlier import still references it", async () => {
      repository.findByFileHash.mockResolvedValue({ id: "existing" });

      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );
      await service.discard(prepared);

      await expect(readFile(prepared.absolutePath)).resolves.toEqual(
        Buffer.from(CONTENT),
      );
    });

    it("does not throw when the file has already gone", async () => {
      const prepared = await service.store(
        CONTENT,
        "order.pdf",
        PARSER_VERSION,
      );

      await service.discard(prepared);

      await expect(service.discard(prepared)).resolves.toBeUndefined();
    });
  });
});
