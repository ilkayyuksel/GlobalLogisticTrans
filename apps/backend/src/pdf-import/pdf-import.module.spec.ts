import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { PrismaService } from "../prisma/prisma.service";
import { TripService } from "../trips/trip.service";
import { PdfImportModule } from "./pdf-import.module";
import { PdfTripImporter } from "./pdf-trip-importer.service";

jest.mock("@tms/parser", () => ({ parse: jest.fn() }));

/**
 * Stands in for the four global modules the application provides at boot:
 * Prisma, the logger, the configuration and the event bus.
 *
 * Faking them at the edge keeps everything between the importer and the
 * database as the real wiring, which is the only part this test is about.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: AppLoggerService,
      useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() },
    },
    { provide: ConfigService, useValue: { getOrThrow: () => "storage/pdf" } },
    { provide: DomainEventBus, useValue: { publish: jest.fn() } },
  ],
  exports: [PrismaService, AppLoggerService, ConfigService, DomainEventBus],
})
class GlobalStubsModule {}

/**
 * Wiring, not behaviour.
 *
 * The importer has no controller, so nothing else would notice a module that
 * forgot to export a provider — the failure would first appear at boot, in
 * production. Building the real graph here turns that into a test failure.
 */
describe("PdfImportModule", () => {
  it("resolves the importer with its real dependency graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, PdfImportModule],
    }).compile();

    expect(moduleRef.get(PdfTripImporter)).toBeInstanceOf(PdfTripImporter);

    await moduleRef.close();
  });

  it("reaches the Trip and PdfDocument services through their own modules", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, PdfImportModule],
    }).compile();

    expect(moduleRef.get(TripService)).toBeInstanceOf(TripService);
    expect(moduleRef.get(PdfDocumentService)).toBeInstanceOf(
      PdfDocumentService,
    );

    await moduleRef.close();
  });
});
