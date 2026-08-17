import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";

import { AppLoggerService } from "../logger/app-logger.service";
import { ImapScanService } from "./imap-scan.service";
import { ImapScheduler } from "./imap.scheduler";

/**
 * A valid expression for the tests that need one. No test waits for it: ticks
 * are fired directly, because a test that sleeps past a real cron boundary
 * passes on an idle machine and fails on a busy one.
 */
const EVERY_SECOND = "* * * * * *";

describe("ImapScheduler", () => {
  let imapScanService: { scan: jest.Mock };
  let schedulerRegistry: { addCronJob: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let registeredJobs: CronJob[];

  function buildScheduler(configuration: Record<string, unknown>) {
    const configService = {
      get: jest.fn((key: string) => configuration[key]),
      getOrThrow: jest.fn((key: string) => configuration[key]),
    };

    return new ImapScheduler(
      imapScanService as unknown as ImapScanService,
      schedulerRegistry as unknown as SchedulerRegistry,
      configService as unknown as ConfigService,
      logger as unknown as AppLoggerService,
    );
  }

  beforeEach(() => {
    imapScanService = { scan: jest.fn().mockResolvedValue({ scanned: 0 }) };
    registeredJobs = [];
    schedulerRegistry = {
      addCronJob: jest.fn((_name: string, job: CronJob) => {
        registeredJobs.push(job);
      }),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    registeredJobs.forEach((job) => job.stop());
  });

  describe("when IMAP is disabled", () => {
    it("registers no job at all", () => {
      buildScheduler({ ENABLE_IMAP: false }).onModuleInit();

      expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });

    it("never scans", () => {
      buildScheduler({ ENABLE_IMAP: false }).onModuleInit();

      expect(imapScanService.scan).not.toHaveBeenCalled();
    });

    /** A missing flag is off: a feature must not switch itself on. */
    it("treats an absent flag as disabled", () => {
      buildScheduler({}).onModuleInit();

      expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });
  });

  describe("when IMAP is enabled", () => {
    it("registers one job using the configured cadence", () => {
      buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: "0 */5 * * * *",
      }).onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
      expect(registeredJobs).toHaveLength(1);
    });

    /** Nothing may touch the network while the application is starting. */
    it("does not scan during startup", () => {
      buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: "0 */5 * * * *",
      }).onModuleInit();

      expect(imapScanService.scan).not.toHaveBeenCalled();
    });

    /**
     * The tick is fired directly rather than waited for. A test that sleeps
     * past a real cron boundary passes on an idle machine and fails on a busy
     * one, which makes it a source of false alarms rather than a check.
     */
    it("scans when the job fires", async () => {
      buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: EVERY_SECOND,
      }).onModuleInit();

      await registeredJobs[0].fireOnTick();

      expect(imapScanService.scan).toHaveBeenCalledTimes(1);
    });

    /**
     * A scheduled run has no caller to receive an error, so a failure must be
     * logged rather than escaping as an unhandled rejection.
     */
    it("logs a failing scan instead of letting it escape", async () => {
      imapScanService.scan.mockRejectedValue(new Error("mailbox unreachable"));

      buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: EVERY_SECOND,
      }).onModuleInit();

      await expect(registeredJobs[0].fireOnTick()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reason: "mailbox unreachable" }),
      );
    });

    /**
     * Startup already fails on invalid configuration by design. What matters is
     * that the message names the variable: the underlying library reports only
     * a bare CronError, which tells an operator nothing about where to look.
     */
    it("names IMAP_POLL_CRON when the expression cannot fire", () => {
      const scheduler = buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: "0 0 5 31 2 *",
      });

      expect(() => scheduler.onModuleInit()).toThrow(/IMAP_POLL_CRON/);
    });

    it("names IMAP_POLL_CRON when the expression is malformed", () => {
      const scheduler = buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: "not a cron expression",
      });

      expect(() => scheduler.onModuleInit()).toThrow(
        /not a usable cron expression/,
      );
    });

    it("keeps scanning after a failure", async () => {
      imapScanService.scan
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue({ scanned: 0 });

      buildScheduler({
        ENABLE_IMAP: true,
        IMAP_POLL_CRON: EVERY_SECOND,
      }).onModuleInit();

      await registeredJobs[0].fireOnTick();
      await registeredJobs[0].fireOnTick();

      expect(imapScanService.scan).toHaveBeenCalledTimes(2);
    });
  });
});
