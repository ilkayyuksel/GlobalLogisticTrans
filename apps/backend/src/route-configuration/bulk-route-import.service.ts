import { BadRequestException, Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  DuplicateActiveRouteException,
  DuplicateCombinationRouteException,
} from "../route-pricing/exceptions/route-pricing.exceptions";
import {
  ImportedRoute,
  describeEntry,
  problem,
  skippedEntry,
  summaryOf,
} from "./bulk-route-import.entries";
import {
  BulkRouteImportCheckDto,
  BulkRouteImportErrorDto,
  BulkRouteImportOutcome,
  BulkRouteImportResultDto,
  BulkRouteImportSkippedDto,
  BulkRouteImportStopDto,
} from "./dto/bulk-route-import.dto";
import { BulkRouteImportValidator } from "./bulk-route-import.validator";
import {
  RouteConfigurationServices,
  RouteConfigurationUnitOfWork,
} from "./route-configuration.unit-of-work";

/**
 * A document that cannot be read at all, as an HTTP failure.
 *
 * Only the DOCUMENT is refused this way — no routes array, too many entries.
 * A broken entry is skipped and reported in the result instead.
 */
export class BulkRouteImportRefusedException extends BadRequestException {
  constructor(errors: readonly BulkRouteImportErrorDto[]) {
    super({
      message: `The import was refused and nothing was created: ${errors.length} ${
        errors.length === 1 ? "problem" : "problems"
      } found.`,
      details: errors.map(describeImportProblem),
      error: "Bulk route import refused",
    });
  }
}

/** One problem, as a line naming the entry (and leg) it belongs to. */
export function describeImportProblem(error: BulkRouteImportErrorDto): string {
  if (error.routeNumber === null) {
    return error.message;
  }

  const leg = error.legNumber === null ? "" : `, leg ${error.legNumber}`;

  return `route ${error.routeNumber}${leg}: ${error.message}`;
}

const STOPPED_MESSAGE =
  "An unexpected error stopped the import at this route. Nothing of this route was saved; the routes before it were imported and the routes after it were not attempted.";

/**
 * Imports many route configurations from one document.
 *
 * ── WHAT IT ADDS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────
 * An imported NORMAL route is created by `RouteConfigurationService.create` and
 * an imported COMBINATION by `CombinationRouteConfigurationService.create` — the
 * very methods the screen calls — so every rule is the same code. There is no
 * pricing logic here: no amount is computed, converted or defaulted, and no Trip
 * is repriced. A Trip already priced keeps the amounts it was priced with.
 *
 * ── EVERY VALID ENTRY, EACH IN ITS OWN TRANSACTION ──────────────────────────
 * The import used to be all or nothing; now an entry that breaks a rule is
 * skipped and the rest are imported. Each entry is written in its OWN
 * transaction, so a Combination is its group and both legs or nothing at all —
 * never half a pair — and one entry's failure cannot undo another's success.
 *
 * Two kinds of failure while writing, told apart on purpose:
 *   the database refuses the route as ALREADY CONFIGURED (another import or a
 *     person took it after the check) — that entry is skipped, like any
 *     duplicate;
 *   ANYTHING ELSE — the import stops there. An unexplained database failure is
 *     not a bad route, and carrying on past it would hide it. The result says
 *     where it stopped; the entries before it stay imported.
 */
@Injectable()
export class BulkRouteImportService {
  constructor(
    private readonly validator: BulkRouteImportValidator,
    private readonly unitOfWork: RouteConfigurationUnitOfWork,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(BulkRouteImportService.name);
  }

  /** What an import WOULD do, without doing any of it. */
  async check(document: unknown): Promise<BulkRouteImportCheckDto> {
    const { isValid, summary, errors, skipped } = await this.validator.check(document);

    return { isValid, summary, errors, skipped };
  }

  /**
   * Imports every valid entry and reports every skipped one.
   *
   * Validated again rather than trusting an earlier preview: the two are separate
   * requests, and a route configured in between must not be overwritten.
   */
  async import(document: unknown): Promise<BulkRouteImportResultDto> {
    const plan = await this.validator.check(document);

    if (plan.documentErrors.length > 0) {
      this.logger.warn("Bulk route import refused", {
        errorCount: plan.documentErrors.length,
      });

      throw new BulkRouteImportRefusedException(plan.documentErrors);
    }

    const result = await this.createEach(plan.routes, [...plan.skipped]);

    // Counts and entry numbers only: what a route costs is never logged.
    this.logger.log("Bulk route import finished", {
      outcome: result.outcome,
      imported: result.imported,
      skippedRouteNumbers: result.skipped.map((entry) => entry.routeNumber),
      stoppedAtRoute: result.stoppedAt?.routeNumber ?? null,
      notAttempted: result.notAttempted,
    });

    return result;
  }

  private async createEach(
    routes: readonly ImportedRoute[],
    skipped: BulkRouteImportSkippedDto[],
  ): Promise<BulkRouteImportResultDto> {
    const imported: ImportedRoute[] = [];
    let stoppedAt: BulkRouteImportStopDto | null = null;
    let notAttempted = 0;

    for (const [index, entry] of routes.entries()) {
      try {
        await this.unitOfWork.run((services) => createOne(services, entry));
        imported.push(entry);
      } catch (error: unknown) {
        if (isAlreadyConfigured(error)) {
          skipped.push(conflictSkip(entry, error));
          this.logger.warn("Bulk route import entry taken while importing", {
            routeNumber: entry.routeNumber,
          });

          continue;
        }

        this.logger.error("Bulk route import stopped by an unexpected error", {
          routeNumber: entry.routeNumber,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        stoppedAt = { routeNumber: entry.routeNumber, message: STOPPED_MESSAGE };
        notAttempted = routes.length - index - 1;

        break;
      }
    }

    skipped.sort((left, right) => left.routeNumber - right.routeNumber);

    return {
      outcome: outcomeOf(imported.length, skipped.length, stoppedAt),
      imported: summaryOf(imported),
      skipped,
      stoppedAt,
      notAttempted,
    };
  }
}

function createOne(services: RouteConfigurationServices, entry: ImportedRoute): Promise<unknown> {
  return entry.kind === "NORMAL"
    ? services.routes.create(entry.route)
    : services.combinations.create({ legs: entry.combination.legs });
}

/** The database refused the route as one that exists — a duplicate, not a fault. */
function isAlreadyConfigured(
  error: unknown,
): error is DuplicateActiveRouteException | DuplicateCombinationRouteException {
  return (
    error instanceof DuplicateActiveRouteException ||
    error instanceof DuplicateCombinationRouteException
  );
}

function conflictSkip(entry: ImportedRoute, error: Error): BulkRouteImportSkippedDto {
  return skippedEntry(entry.routeNumber, entry.kind, describeEntry(entry), [
    problem(entry.routeNumber, null, null, error.message, "ALREADY_CONFIGURED"),
  ]);
}

function outcomeOf(
  importedCount: number,
  skippedCount: number,
  stoppedAt: BulkRouteImportStopDto | null,
): BulkRouteImportOutcome {
  if (stoppedAt) {
    return "ABORTED";
  }

  if (skippedCount === 0) {
    return "COMPLETED";
  }

  return importedCount > 0 ? "PARTIAL" : "NOTHING_IMPORTED";
}
