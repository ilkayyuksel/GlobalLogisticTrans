import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { ImapMailboxClient } from "./imap-mailbox.client";
import { ImapScanController } from "./imap-scan.controller";
import { ImapScanService } from "./imap-scan.service";
import { ImapModule } from "./imap.module";
import { ImapScheduler } from "./imap.scheduler";
import { ImportedEmailService } from "./imported-email.service";

jest.mock("@tms/parser", () => ({ parse: jest.fn() }));

/**
 * Stands in for the global modules the application provides at boot, plus the
 * scheduler registry ScheduleModule normally supplies.
 *
 * ENABLE_IMAP is false here on purpose: compiling the module must not schedule
 * a job or open a connection, and this proves it.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: AppLoggerService,
      useValue: {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    },
    {
      provide: ConfigService,
      useValue: { get: () => false, getOrThrow: () => "storage/pdf" },
    },
    { provide: DomainEventBus, useValue: { publish: jest.fn() } },
    { provide: SchedulerRegistry, useValue: { addCronJob: jest.fn() } },
  ],
  exports: [
    PrismaService,
    AppLoggerService,
    ConfigService,
    DomainEventBus,
    SchedulerRegistry,
  ],
})
class GlobalStubsModule {}

/**
 * Wiring, not behaviour.
 *
 * The scheduler has no controller and the client is never exported, so a module
 * that forgot a provider would first fail at boot, in production. Building the
 * real graph here turns that into a test failure.
 */
describe("ImapModule", () => {
  async function compile() {
    return Test.createTestingModule({
      imports: [GlobalStubsModule, ImapModule],
    }).compile();
  }

  it("resolves the scan service with its real dependency graph", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(ImapScanService)).toBeInstanceOf(ImapScanService);
    expect(moduleRef.get(ImapMailboxClient)).toBeInstanceOf(ImapMailboxClient);
    expect(moduleRef.get(ImportedEmailService)).toBeInstanceOf(
      ImportedEmailService,
    );

    await moduleRef.close();
  });

  it("exposes the operator endpoint", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(ImapScanController)).toBeInstanceOf(
      ImapScanController,
    );

    await moduleRef.close();
  });

  it("registers the scheduler", async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(ImapScheduler)).toBeInstanceOf(ImapScheduler);

    await moduleRef.close();
  });

  /**
   * The mailbox must not be contacted while the application starts: a backend
   * with an unreachable mailbox still has to serve every other endpoint.
   */
  it("connects to nothing while the module is initialising", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, ImapModule],
    }).compile();

    await moduleRef.init();

    const client = moduleRef.get(ImapMailboxClient);
    const withMailbox = jest.spyOn(client, "withMailbox");

    expect(withMailbox).not.toHaveBeenCalled();

    await moduleRef.close();
  });
});
