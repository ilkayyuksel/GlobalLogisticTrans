import { Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { ValidationError, validate } from "class-validator";

import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { isSameRoad } from "../route-pricing/route-identity";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  ImportedRoute,
  byEntry,
  declaredType,
  describeEntry,
  describeRawEntry,
  duplicatesWithinDocument,
  problem,
  roadsOf,
  skippedEntry,
  summaryOf,
} from "./bulk-route-import.entries";
import {
  BulkCombinationRouteImportDto,
  BulkNormalRouteImportDto,
  BulkRouteImportCheckDto,
  BulkRouteImportErrorDto,
  BulkRouteImportSkippedDto,
  MAX_IMPORT_ROUTES,
} from "./dto/bulk-route-import.dto";
import { RouteConfigurationType } from "./dto/route-configuration.dto";

export type { ImportedRoute } from "./bulk-route-import.entries";

/**
 * The same options the application's global ValidationPipe uses.
 *
 * `forbidNonWhitelisted` is what refuses a `kilometres` field: a route carries a
 * toll AMOUNT, and silently dropping a distance from an older file would let an
 * operator believe it had been used. The same goes for `active`, which no
 * longer exists.
 */
const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
} as const;

export interface BulkRouteImportPlan extends BulkRouteImportCheckDto {
  /**
   * Problems with the document ITSELF — no routes array, too many entries.
   * Any of them refuses the whole import; nothing can be read, so nothing is
   * imported or skipped.
   */
  readonly documentErrors: readonly BulkRouteImportErrorDto[];
  /** The entries to create, in the order they were given. */
  readonly routes: readonly ImportedRoute[];
}

type EntryReading =
  | { readonly route: ImportedRoute; readonly skipped: null }
  | { readonly route: null; readonly skipped: BulkRouteImportSkippedDto };

/**
 * Reads a bulk import and decides, entry by entry, what may be created —
 * without creating any of it.
 *
 * ── ONE ENTRY'S PROBLEM IS THAT ENTRY'S ─────────────────────────────────────
 * The import used to be all or nothing: two Combinations whose legs were the
 * same road refused eighty valid routes. Now every entry is judged on its own
 * and a broken one is SKIPPED with its reasons, while the rest go ahead. No rule
 * is relaxed for it: a skipped entry is one that breaks a rule, reported as it
 * always was. Only a problem with the document itself refuses everything.
 *
 * ── THE RULES ARE NOT RESTATED HERE ─────────────────────────────────────────
 * Field validation runs class-validator over the very DTO classes the manual
 * endpoints use, with the same options as the global pipe. Duplicate detection
 * calls the same lookups the manual create calls, which apply the canonical
 * terminal rule. Nothing here decides what a valid route is; it decides only
 * which entry broke which rule.
 */
@Injectable()
export class BulkRouteImportValidator {
  constructor(
    private readonly routePricing: RoutePricingService,
    private readonly combinationPricing: CombinationRoutePricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(BulkRouteImportValidator.name);
  }

  async check(document: unknown): Promise<BulkRouteImportPlan> {
    const envelope = readEnvelope(document);

    if (!envelope.entries) {
      this.logger.warn("Bulk route import document could not be read", {
        reason: envelope.errors[0]?.message,
      });

      return {
        isValid: false,
        summary: summaryOf([]),
        errors: envelope.errors,
        skipped: [],
        documentErrors: envelope.errors,
        routes: [],
      };
    }

    return this.checkEntries(envelope.entries);
  }

  private async checkEntries(entries: readonly unknown[]): Promise<BulkRouteImportPlan> {
    const skipped: BulkRouteImportSkippedDto[] = [];
    let routes: ImportedRoute[] = [];

    for (const [index, entry] of entries.entries()) {
      const reading = await this.readEntry(entry, index + 1);

      if (reading.route) {
        routes.push(reading.route);
      } else {
        skipped.push(reading.skipped);
      }
    }

    // Within the document first: the first occurrence is the one kept.
    const duplicates = duplicatesWithinDocument(routes);
    routes = this.withoutSkipped(routes, duplicates, skipped);

    const stored = await this.alreadyConfigured(routes);
    routes = this.withoutSkipped(routes, stored, skipped);

    skipped.sort((left, right) => left.routeNumber - right.routeNumber);
    const errors = skipped.flatMap((entry) => entry.reasons).sort(byEntry);

    this.logger.log("Bulk route import checked", {
      entryCount: entries.length,
      importableCount: routes.length,
      skippedCount: skipped.length,
      skippedRouteNumbers: skipped.map((entry) => entry.routeNumber),
    });

    return {
      isValid: skipped.length === 0,
      summary: summaryOf(routes),
      errors,
      skipped,
      documentErrors: [],
      routes,
    };
  }

  /** `routes` minus the entries `problems` names, which join `skipped`. */
  private withoutSkipped(
    routes: readonly ImportedRoute[],
    problems: ReadonlyMap<number, BulkRouteImportErrorDto>,
    skipped: BulkRouteImportSkippedDto[],
  ): ImportedRoute[] {
    return routes.filter((entry) => {
      const reason = problems.get(entry.routeNumber);

      if (reason) {
        skipped.push(skippedEntry(entry.routeNumber, entry.kind, describeEntry(entry), [reason]));
      }

      return reason === undefined;
    });
  }

  /**
   * One entry, as the type it declares.
   *
   * The declared type decides which DTO validates it, so a NORMAL entry is held
   * to the manual create's rules exactly and a COMBINATION to the two-leg rule.
   */
  private async readEntry(entry: unknown, routeNumber: number): Promise<EntryReading> {
    const skip = (reasons: BulkRouteImportErrorDto[]): EntryReading => ({
      route: null,
      skipped: skippedEntry(routeNumber, declaredType(entry), describeRawEntry(entry), reasons),
    });

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return skip([problem(routeNumber, null, null, "each route must be an object", "INVALID")]);
    }

    const declared = (entry as Record<string, unknown>).type;

    if (declared === RouteConfigurationType.NORMAL) {
      const route = plainToInstance(BulkNormalRouteImportDto, entry);
      const failures = await validate(route, VALIDATION_OPTIONS);

      return failures.length > 0
        ? skip(flatten(failures, routeNumber, null))
        : { route: { kind: "NORMAL", route, routeNumber }, skipped: null };
    }

    if (declared === RouteConfigurationType.COMBINATION) {
      return this.readCombination(entry, routeNumber, skip);
    }

    return skip([
      problem(
        routeNumber,
        null,
        "type",
        `type must be ${RouteConfigurationType.NORMAL} or ${RouteConfigurationType.COMBINATION}`,
        "INVALID",
      ),
    ]);
  }

  private async readCombination(
    entry: object,
    routeNumber: number,
    skip: (reasons: BulkRouteImportErrorDto[]) => EntryReading,
  ): Promise<EntryReading> {
    const combination = plainToInstance(BulkCombinationRouteImportDto, entry);
    const failures = await validate(combination, VALIDATION_OPTIONS);

    if (failures.length > 0) {
      return skip(flatten(failures, routeNumber, null));
    }

    /*
     * The two legs of one Combination must be different roads. Pricing selects a
     * leg BY its road, so two legs on one road would make the choice between
     * them arbitrary — the same reason the partial unique index refuses it.
     */
    const [outbound, back] = combination.legs;

    if (isSameRoad(outbound, back)) {
      return skip([
        problem(
          routeNumber,
          null,
          "legs",
          "the two legs of a Combination must be different routes",
          "SAME_ROUTE_LEGS",
        ),
      ]);
    }

    return { route: { kind: "COMBINATION", combination, routeNumber }, skipped: null };
  }

  /**
   * Entries that are already configured in the database.
   *
   * Through the same lookups the manual create uses, so the canonical terminal
   * rule applies: an import naming `PSA Quay 869` collides with a route
   * configured as `Quay 869`. Nothing is overwritten: the entry is skipped.
   *
   * An ordinary route is compared by its road; a Combination by its pair, which
   * is the only thing that identifies one. A leg whose road is already used by
   * some OTHER Combination is not a collision.
   */
  private async alreadyConfigured(
    routes: readonly ImportedRoute[],
  ): Promise<Map<number, BulkRouteImportErrorDto>> {
    const configured = new Map<number, BulkRouteImportErrorDto>();

    for (const entry of routes) {
      const exists =
        entry.kind === "NORMAL"
          ? await this.routePricing.findConfiguredRoute(
              entry.route.departure,
              entry.route.destination,
              RouteConfigurationKind.NORMAL,
            )
          : await this.combinationPricing.findConfiguredCombination(roadsOf(entry));

      if (exists !== null) {
        const subject = entry.kind === "NORMAL" ? "route" : "Combination";

        configured.set(
          entry.routeNumber,
          problem(
            entry.routeNumber,
            null,
            null,
            `this ${subject} is already configured: ${describeEntry(entry)}`,
            "ALREADY_CONFIGURED",
          ),
        );
      }
    }

    return configured;
  }
}

/**
 * The document itself: an object with a `routes` array of a workable size.
 *
 * Read here rather than by the global ValidationPipe, which would strip every
 * entry's properties on its way past — see `BulkImportRouteConfigurationDto`. It
 * is also the one place that can say "the document has no routes array" as an
 * entry-less problem, which is what an operator who pasted the wrong thing needs
 * to hear.
 */
function readEnvelope(document: unknown): {
  entries: readonly unknown[] | null;
  errors: BulkRouteImportErrorDto[];
} {
  const refuse = (field: string | null, message: string) => ({
    entries: null,
    errors: [problem(null, null, field, message, null)],
  });

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return refuse(null, "the document must be an object with a routes array");
  }

  const routes = (document as { routes?: unknown }).routes;

  if (!Array.isArray(routes)) {
    return refuse("routes", "routes must be an array");
  }

  if (routes.length === 0) {
    return refuse("routes", "routes must not be empty");
  }

  /*
   * A bound on one request's work. Refused rather than truncated: importing
   * the first five hundred of six hundred routes silently would be the worst
   * of both answers.
   */
  if (routes.length > MAX_IMPORT_ROUTES) {
    return refuse(
      "routes",
      `routes must contain at most ${MAX_IMPORT_ROUTES} entries, not ${routes.length}`,
    );
  }

  return { entries: routes, errors: [] };
}

/**
 * A class-validator failure tree, flattened to one line per broken rule.
 *
 * A nested leg arrives as `legs` → `1` → `toll`; the index becomes the leg
 * NUMBER and the innermost property the field, so the report reads "route 4,
 * leg 2: toll must be a number" rather than repeating a path.
 */
function flatten(
  failures: readonly ValidationError[],
  routeNumber: number,
  legNumber: number | null,
): BulkRouteImportErrorDto[] {
  return failures.flatMap((error) => {
    const index = Number(error.property);
    const isArrayIndex = Number.isInteger(index) && error.property !== "";

    /*
     * ── ONE LINE FOR A MISSING FIELD ────────────────────────────────────────
     * A field that is absent fails every rule it has, so `toll` missing
     * produced three lines: not a number, not at least zero, not at most the
     * money ceiling. All three say the same thing. A present value that is
     * wrong still reports each rule it broke, because those are different facts.
     */
    const own =
      error.value === undefined || error.value === null
        ? [problem(routeNumber, legNumber, error.property, `${error.property} is required`, "INVALID")]
        : Object.values(error.constraints ?? {}).map((message) =>
            problem(routeNumber, legNumber, error.property, message, "INVALID"),
          );

    const nested = (error.children ?? []).flatMap((child) =>
      flatten([child], routeNumber, isArrayIndex ? index + 1 : legNumber),
    );

    return [...own, ...nested];
  });
}
