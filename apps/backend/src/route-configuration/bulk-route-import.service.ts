import { BadRequestException, Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  BulkRouteImportCheckDto,
  BulkRouteImportErrorDto,
  BulkRouteImportSummaryDto,
} from "./dto/bulk-route-import.dto";
import { SaveCombinationRouteConfigurationDto } from "./dto/route-configuration.dto";
import {
  BulkRouteImportValidator,
  ImportedRoute,
} from "./bulk-route-import.validator";
import {
  RouteConfigurationServices,
  RouteConfigurationUnitOfWork,
} from "./route-configuration.unit-of-work";

/**
 * A refused import, as an HTTP failure.
 *
 * The per-entry report travels in `details`, which is where the envelope already
 * carries field-level validation failures, so a caller needs no second shape to
 * read. The message says the one thing that matters beyond the list: nothing was
 * created.
 */
export class BulkRouteImportRefusedException extends BadRequestException {
  constructor(errors: readonly BulkRouteImportErrorDto[]) {
    super({
      /*
       * One sentence about the request, and the reasons beside it. The sentence
       * is what a caller shows when it shows one line, and "nothing was created"
       * is the part an operator needs before anything else.
       */
      message: `The import was refused and nothing was created: ${errors.length} ${
        errors.length === 1 ? "problem" : "problems"
      } found.`,
      details: errors.map(describe),
      error: "Bulk route import refused",
    });
  }
}

/**
 * One problem, as a line naming the entry it belongs to.
 *
 * A problem with the document itself belongs to no entry, and says so rather than
 * claiming to be about route 0.
 */
function describe(error: BulkRouteImportErrorDto): string {
  if (error.routeNumber === null) {
    return error.message;
  }

  const leg = error.legNumber === null ? "" : `, leg ${error.legNumber}`;

  return `route ${error.routeNumber}${leg}: ${error.message}`;
}

/**
 * Imports many route configurations from one document.
 *
 * ── WHAT IT ADDS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────
 * It adds two things: reading a whole document before writing any of it, and
 * writing all of it in one transaction. It adds no rule. An imported NORMAL route
 * is created by `RouteConfigurationService.create` and an imported COMBINATION by
 * `CombinationRouteConfigurationService.create` — the very methods the screen
 * calls — so the duplicate check, the canonical terminal matching, the money
 * precision, the exactly-two-legs rule and the toll and tunnel costs are all the
 * same code.
 *
 * There is no pricing logic here at all. No amount is computed, converted or
 * defaulted: the Toll and the Tunnel are stored as the amounts given, exactly as
 * they are for a route configured by hand.
 *
 * ── ALL OR NOTHING ──────────────────────────────────────────────────────────
 * Twenty valid routes and one broken one change nothing. The validator judges the
 * document first, so the refusal names every problem at once; the transaction then
 * guarantees the promise even against a failure the validator could not foresee,
 * such as a concurrent import taking one of the roads between the two phases.
 *
 * ── AND NOTHING HERE TOUCHES HISTORY ────────────────────────────────────────
 * Configuration is read when a Trip is priced. A Trip already priced keeps the
 * amounts it was priced with, whether its route was imported or typed.
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

  /**
   * What an import WOULD do, without doing any of it.
   *
   * The preview the screen shows before an operator commits: the counts, and every
   * reason the document would be refused. Read-only by construction — it reaches
   * the unit of work not at all.
   */
  async check(document: unknown): Promise<BulkRouteImportCheckDto> {
    const { isValid, summary, errors } = await this.validator.check(document);

    return { isValid, summary, errors };
  }

  /**
   * Performs the import, or refuses it entirely.
   *
   * Validated again rather than trusting an earlier preview: the two are separate
   * requests, and a route configured in between would otherwise be overwritten by
   * a document that was valid when it was checked.
   */
  async import(document: unknown): Promise<BulkRouteImportSummaryDto> {
    const plan = await this.validator.check(document);

    if (!plan.isValid) {
      this.logger.warn("Bulk route import refused", {
        errorCount: plan.errors.length,
      });

      throw new BulkRouteImportRefusedException(plan.errors);
    }

    await this.unitOfWork.run((services) =>
      this.createAll(services, plan.routes),
    );

    // Counts only: what a route costs is commercial configuration and is never
    // logged, here or anywhere else.
    this.logger.log("Bulk route import completed", plan.summary);

    return plan.summary;
  }

  /**
   * Creates every entry through the ordinary configuration services.
   *
   * Sequentially and in the order given, so the records come out in the order the
   * operator wrote them and a failure is attributable to one entry. They share one
   * transaction, so nothing here has to undo anything.
   */
  private async createAll(
    services: RouteConfigurationServices,
    routes: readonly ImportedRoute[],
  ): Promise<void> {
    for (const entry of routes) {
      if (entry.kind === "NORMAL") {
        await services.routes.create(entry.route);

        continue;
      }

      await services.combinations.create(toCombinationDto(entry.combination));
    }
  }
}

/**
 * A Combination entry, as the manual endpoint's own DTO.
 *
 * The legs are passed through untouched — each keeps its own Tarief, Toll and
 * Tunnel, because the two directions of a real Combination cost different things
 * and nothing may copy one onto the other.
 */
function toCombinationDto(combination: {
  legs: SaveCombinationRouteConfigurationDto["legs"];
}): SaveCombinationRouteConfigurationDto {
  return { legs: combination.legs };
}
