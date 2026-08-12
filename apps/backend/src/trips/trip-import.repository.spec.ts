import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PrismaService } from "../prisma/prisma.service";
import { ImportRepositories, TripRepository } from "./trip.repository";

/**
 * The import transaction.
 *
 * What matters is that both repositories the import writes through are bound to
 * the SAME transaction client — a document written outside it would survive a
 * rollback that removed its Trips.
 */
describe("TripRepository import transaction", () => {
  let prisma: {
    trip: { create: jest.Mock };
    tripGroup: { create: jest.Mock };
    pdfDocument: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TripRepository;

  beforeEach(() => {
    prisma = {
      trip: { create: jest.fn().mockResolvedValue({}) },
      tripGroup: { create: jest.fn().mockResolvedValue({ id: "group" }) },
      pdfDocument: { create: jest.fn().mockResolvedValue({ id: "pdf" }) },
      $transaction: jest.fn(),
    };

    prisma.$transaction.mockImplementation(
      (work: (client: unknown) => Promise<unknown>) => work(prisma),
    );

    repository = new TripRepository(prisma as unknown as PrismaService);
  });

  it("hands the callback repositories, never a Prisma client", async () => {
    let received: ImportRepositories | undefined;

    await repository.runImportTransaction(async (repositories) => {
      received = repositories;
      return null;
    });

    expect(received?.trips).toBeInstanceOf(TripRepository);
    expect(received?.pdfDocuments).toBeInstanceOf(PdfDocumentRepository);
  });

  it("runs both repositories inside one transaction", async () => {
    await repository.runImportTransaction(async ({ trips, pdfDocuments }) => {
      await pdfDocuments.create({
        importSource: "MANUAL_UPLOAD",
        originalFilename: "order.pdf",
        storagePath: "abc.pdf",
        fileSizeBytes: BigInt(1),
        fileHash: "abc",
        mimeType: "application/pdf",
      });
      await trips.createTripGroup();
      return null;
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.pdfDocument.create).toHaveBeenCalledTimes(1);
    expect(prisma.tripGroup.create).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure so the transaction rolls back", async () => {
    prisma.$transaction.mockImplementation(
      async (work: (client: unknown) => Promise<unknown>) => work(prisma),
    );

    await expect(
      repository.runImportTransaction(async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
  });

  describe("createTripGroup", () => {
    it("creates a group with no data of its own", async () => {
      await repository.createTripGroup();

      expect(prisma.tripGroup.create).toHaveBeenCalledWith({ data: {} });
    });
  });
});
