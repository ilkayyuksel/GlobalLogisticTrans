import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PrismaService } from "../prisma/prisma.service";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { TripRepository, TripWriteRepositories } from "./trip.repository";

/**
 * The Trip write transaction.
 *
 * What matters is that every repository the write goes through is bound to the
 * SAME transaction client — a document written outside it would survive a
 * rollback that removed its Trips, and so would an automatic Custom Property
 * assignment, leaving a row pointing at a Trip that does not exist.
 */
describe("TripRepository write transaction", () => {
  let prisma: {
    trip: { create: jest.Mock };
    tripGroup: { create: jest.Mock };
    pdfDocument: { create: jest.Mock };
    tripCustomProperty: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TripRepository;

  beforeEach(() => {
    prisma = {
      trip: { create: jest.fn().mockResolvedValue({}) },
      tripGroup: { create: jest.fn().mockResolvedValue({ id: "group" }) },
      pdfDocument: { create: jest.fn().mockResolvedValue({ id: "pdf" }) },
      tripCustomProperty: { create: jest.fn().mockResolvedValue({ id: "tcp" }) },
      $transaction: jest.fn(),
    };

    prisma.$transaction.mockImplementation(
      (work: (client: unknown) => Promise<unknown>) => work(prisma),
    );

    repository = new TripRepository(prisma as unknown as PrismaService);
  });

  it("hands the callback repositories, never a Prisma client", async () => {
    let received: TripWriteRepositories | undefined;

    await repository.runTripWriteTransaction(async (repositories) => {
      received = repositories;
      return null;
    });

    expect(received?.trips).toBeInstanceOf(TripRepository);
    expect(received?.pdfDocuments).toBeInstanceOf(PdfDocumentRepository);
    expect(received?.customProperties).toBeInstanceOf(
      TripCustomPropertyRepository,
    );
  });

  it("runs every repository inside one transaction", async () => {
    await repository.runTripWriteTransaction(
      async ({ trips, pdfDocuments, customProperties }) => {
        await pdfDocuments.create({
          importSource: "MANUAL_UPLOAD",
          originalFilename: "order.pdf",
          storagePath: "abc.pdf",
          fileSizeBytes: BigInt(1),
          fileHash: "abc",
          mimeType: "application/pdf",
        });
        await trips.createTripGroup();
        // The automatic Flat assignment shares the Trip's transaction.
        await customProperties.create({
          tripId: "trip-1",
          customPropertyId: "property-1",
          isAutomatic: true,
        });
        return null;
      },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.pdfDocument.create).toHaveBeenCalledTimes(1);
    expect(prisma.tripGroup.create).toHaveBeenCalledTimes(1);
    expect(prisma.tripCustomProperty.create).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure so the transaction rolls back", async () => {
    prisma.$transaction.mockImplementation(
      async (work: (client: unknown) => Promise<unknown>) => work(prisma),
    );

    await expect(
      repository.runTripWriteTransaction(async () => {
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
