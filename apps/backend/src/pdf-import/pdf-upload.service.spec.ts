import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ImportSource, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import { DuplicateBookingNumberException } from "../trips/exceptions/trip.exceptions";
import { UnreadablePdfException } from "./exceptions/pdf-import.exceptions";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import { PdfUploadService } from "./pdf-upload.service";
import { UploadedPdfFile } from "./uploaded-pdf-file";

/**
 * The upload path's own decisions: which files reach the importer, and how each
 * file's outcome is reported.
 *
 * The importer is a double here on purpose — what it does with a real PDF is
 * proven end to end in `pdf-import.e2e.spec.ts`. What matters at this level is
 * that one file's fate never becomes another's, and that nothing internal
 * escapes into a response.
 */

const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

function uploadedFile(
  overrides: Partial<UploadedPdfFile> = {},
): UploadedPdfFile {
  const buffer = overrides.buffer ?? PDF_BYTES;

  return {
    originalname: "transport-order.pdf",
    mimetype: "application/pdf",
    size: buffer.length,
    ...overrides,
    buffer,
  };
}

function tripResponse(bookingNumber: string): TripResponseDto {
  return {
    id: `trip-${bookingNumber}`,
    bookingNumber,
    status: TripStatus.OPEN,
  } as TripResponseDto;
}

describe("PdfUploadService", () => {
  let importer: { import: jest.Mock };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: PdfUploadService;

  beforeEach(() => {
    importer = {
      import: jest.fn().mockResolvedValue({
        trips: [tripResponse("ANRDUB2602247")],
        combination: false,
        cancellations: [],
        revisions: [],
      }),
    };

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new PdfUploadService(
      importer as unknown as PdfTripImporter,
      { setContext: jest.fn(), ...logger } as unknown as AppLoggerService,
    );
  });

  describe("a request without files", () => {
    /** No file to report against, so this is the request itself being wrong. */
    it("is refused as a bad request", async () => {
      await expect(service.importUploadedFiles([])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("says which field was expected", async () => {
      await expect(service.importUploadedFiles([])).rejects.toThrow(/files/);
    });
  });

  describe("importing", () => {
    it("reports one successful result per file", async () => {
      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results).toEqual([
        {
          filename: "transport-order.pdf",
          ok: true,
          combination: false,
          trips: [tripResponse("ANRDUB2602247")],
        },
      ]);
    });

    it("keeps the results in the order the files were sent", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({ originalname: "first.pdf" }),
        uploadedFile({ originalname: "second.pdf" }),
      ]);

      expect(results.map((result) => result.filename)).toEqual([
        "first.pdf",
        "second.pdf",
      ]);
      expect(importer.import).toHaveBeenCalledTimes(2);
    });

    it("imports every file as a manual upload", async () => {
      await service.importUploadedFiles([uploadedFile()]);

      expect(importer.import).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "transport-order.pdf",
        {
          provenance: {
            importSource: ImportSource.MANUAL_UPLOAD,
            importedEmailId: null,
          },
        },
      );
    });

    it("reports a Combination as one file that produced two Trips", async () => {
      importer.import.mockResolvedValue({
        trips: [tripResponse("DUBANR2598395"), tripResponse("ANRBEL2603249")],
        combination: true,
        cancellations: [],
        revisions: [],
      });

      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results[0]).toMatchObject({ ok: true, combination: true });
      expect(results[0].trips).toHaveLength(2);
    });

    /** The response carries the Trips as the importer created them: OPEN. */
    it("returns the Trips unchanged, still OPEN", async () => {
      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results[0].trips?.[0].status).toBe(TripStatus.OPEN);
    });
  });

  describe("files that never reach the importer", () => {
    it("refuses an empty file", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({ buffer: Buffer.alloc(0) }),
      ]);

      expect(results[0]).toMatchObject({
        ok: false,
        code: "IMPORT_EMPTY_FILE",
      });
      expect(importer.import).not.toHaveBeenCalled();
    });

    it("refuses a file that is not a PDF", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({
          originalname: "prices.xlsx",
          mimetype: "application/vnd.ms-excel",
          buffer: Buffer.from("PK not a pdf at all"),
        }),
      ]);

      expect(results[0]).toMatchObject({
        filename: "prices.xlsx",
        ok: false,
        code: "IMPORT_NOT_A_PDF",
      });
      expect(importer.import).not.toHaveBeenCalled();
    });

    /** The declared content type is whatever the client chose to write. */
    it("does not believe a non-PDF that claims to be one", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({
          originalname: "renamed.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("this is a text file"),
        }),
      ]);

      expect(results[0]).toMatchObject({ ok: false, code: "IMPORT_NOT_A_PDF" });
    });

    /** And equally: a genuine PDF is imported however it was labelled. */
    it("accepts a real PDF sent as octet-stream", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({ mimetype: "application/octet-stream" }),
      ]);

      expect(results[0].ok).toBe(true);
    });
  });

  describe("when an import fails", () => {
    it("reports the parser's reason under the importer's own code", async () => {
      importer.import.mockRejectedValue(
        new UnreadablePdfException("scan.pdf", "no text layer"),
      );

      const { results } = await service.importUploadedFiles([
        uploadedFile({ originalname: "scan.pdf" }),
      ]);

      expect(results[0]).toMatchObject({
        filename: "scan.pdf",
        ok: false,
        code: "IMPORT_UNREADABLE_PDF",
      });
      expect(results[0].message).toContain("no text layer");
    });

    /** Uploading the same order twice must not create the Trips twice. */
    it("reports an already-imported booking as a duplicate", async () => {
      importer.import.mockRejectedValue(
        new DuplicateBookingNumberException("ANRDUB2602247", "trip-1"),
      );

      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results[0]).toMatchObject({
        ok: false,
        code: "IMPORT_DUPLICATE_BOOKING",
      });
      expect(results[0].message).toContain("ANRDUB2602247");
    });

    it("passes through other domain failures with their own message", async () => {
      importer.import.mockRejectedValue(
        new NotFoundException('PDF document "x" does not exist.'),
      );

      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results[0].message).toContain("does not exist");
    });

    /** An unrecognised failure is a defect: the client learns nothing from it. */
    it("keeps an unexpected failure's details out of the response", async () => {
      importer.import.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5432 at /srv/app/db.ts"),
      );

      const { results } = await service.importUploadedFiles([uploadedFile()]);

      expect(results[0]).toMatchObject({ ok: false, code: "IMPORT_FAILED" });
      expect(results[0].message).not.toContain("ECONNREFUSED");
      expect(results[0].message).not.toContain("/srv/app");
    });

    it("logs an unexpected failure with its stack", async () => {
      importer.import.mockRejectedValue(new Error("boom"));

      await service.importUploadedFiles([uploadedFile()]);

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ stack: expect.any(String) }),
      );
    });

    it("logs a refused document as a warning, not an error", async () => {
      importer.import.mockRejectedValue(
        new UnreadablePdfException("scan.pdf", "no text layer"),
      );

      await service.importUploadedFiles([uploadedFile()]);

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("a batch in which one file fails", () => {
    it("still imports the others", async () => {
      importer.import
        .mockRejectedValueOnce(
          new UnreadablePdfException("broken.pdf", "no text layer"),
        )
        .mockResolvedValueOnce({
          trips: [tripResponse("ANRDUB2602247")],
          combination: false,
          cancellations: [],
          revisions: [],
        });

      const { results } = await service.importUploadedFiles([
        uploadedFile({ originalname: "broken.pdf" }),
        uploadedFile({ originalname: "good.pdf" }),
      ]);

      expect(results.map((result) => [result.filename, result.ok])).toEqual([
        ["broken.pdf", false],
        ["good.pdf", true],
      ]);
    });

    /** A file refused before the importer must not consume its next answer. */
    it("does not let a rejected file shift the others' results", async () => {
      const { results } = await service.importUploadedFiles([
        uploadedFile({
          originalname: "notes.txt",
          buffer: Buffer.from("plain text"),
        }),
        uploadedFile({ originalname: "good.pdf" }),
      ]);

      expect(results[0]).toMatchObject({ ok: false });
      expect(results[1]).toMatchObject({ ok: true, filename: "good.pdf" });
      expect(importer.import).toHaveBeenCalledTimes(1);
    });
  });

  describe("logging", () => {
    /** Documents carry customer data; only what identifies the file is logged. */
    it("never logs the uploaded bytes", async () => {
      await service.importUploadedFiles([uploadedFile()]);

      const logged = JSON.stringify([
        logger.log.mock.calls,
        logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("%PDF");
    });
  });
});
