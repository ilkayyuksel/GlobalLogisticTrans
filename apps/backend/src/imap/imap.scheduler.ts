import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";

import { AppLoggerService } from "../logger/app-logger.service";
import { ImapScanService } from "./imap-scan.service";

const SCAN_JOB_NAME = "imap-scan";

/**
 * Runs a mailbox scan on a timer.
 *
 * Polling rather than a long-lived IDLE connection: transport orders arrive a
 * few times a day, so a connection held open all week — with the reconnect
 * handling that implies — would buy minutes of latency nobody is waiting for.
 * A scan every few minutes is enough, and a process restart costs nothing
 * because unread mail is still there.
 *
 * The job is registered at startup rather than declared with `@Cron`, because a
 * decorator is evaluated when the class is loaded and could only read the raw
 * environment. Registering it here means the cadence comes from the validated
 * configuration like every other setting.
 *
 * When IMAP is off, no job is registered at all — there is nothing to fire and
 * nothing to skip. Nothing connects at boot either: the first connection
 * happens when the first scan runs, so a backend with an unreachable mailbox
 * still starts and still serves every other endpoint.
 */
@Injectable()
export class ImapScheduler implements OnModuleInit {
  constructor(
    private readonly imapScanService: ImapScanService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImapScheduler.name);
  }

  onModuleInit(): void {
    if (this.configService.get<boolean>("ENABLE_IMAP") !== true) {
      this.logger.log("Mailbox polling disabled; no scan is scheduled");

      return;
    }

    const cronExpression =
      this.configService.getOrThrow<string>("IMAP_POLL_CRON");

    const job = this.startJob(cronExpression);

    this.schedulerRegistry.addCronJob(SCAN_JOB_NAME, job);

    this.logger.log("Mailbox polling scheduled", { cronExpression });
  }

  /**
   * Builds and starts the job, refusing an expression that could never fire.
   *
   * Both steps are guarded together because the two ways an expression can be
   * wrong surface at different moments: malformed syntax throws on
   * construction, while a date that can never occur (`31 February`) is only
   * discovered when the first run is scheduled. Either way the underlying
   * library raises a bare CronError naming neither the setting nor the value.
   *
   * Startup already fails on invalid configuration by design; this only makes
   * the failure say which variable to fix.
   */
  private startJob(cronExpression: string): CronJob {
    try {
      const job = new CronJob(cronExpression, () => {
        void this.runScheduledScan();
      });

      job.start();

      return job;
    } catch (error: unknown) {
      throw new Error(
        `IMAP_POLL_CRON is not a usable cron expression: "${cronExpression}". ` +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * A scheduled run has no caller to return a failure to, so every failure is
   * logged rather than propagated. An unhandled rejection here would otherwise
   * surface as an unhandled promise rejection in the process; the next tick
   * tries again regardless.
   */
  private async runScheduledScan(): Promise<void> {
    try {
      await this.imapScanService.scan();
    } catch (error: unknown) {
      this.logger.error("Scheduled mailbox scan failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
