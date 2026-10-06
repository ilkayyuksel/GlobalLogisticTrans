import { Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { ValidationError, validate } from "class-validator";

import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import {
  RoadEndpoints,
  describeCombination,
  isSameCombination,
  isSameRoad,
} from "../route-pricing/route-identity";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import {
  BulkCombinationRouteImportDto,
  BulkNormalRouteImportDto,
  BulkRouteImportCheckDto,
  BulkRouteImportErrorDto,
  MAX_IMPORT_ROUTES,
} from "./dto/bulk-route-import.dto";
import { RouteConfigurationType } from "./dto/route-configuration.dto";

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

/** One entry of an import, read and understood. */
export type ImportedRoute =
  | { readonly kind: "NORMAL"; readonly route: BulkNormalRouteImportDto }
  | {
      readonly kind: "COMBINATION";
      readonly combination: BulkCombinationRouteImportDto;
    };

export interface BulkRouteImportPlan extends BulkRouteImportCheckDto {
  /**
   * The entries to create, in the order they were given — empty whenever the
   * document was refused, because a refused import creates nothing at all.
   */
  readonly routes: readonly ImportedRoute[];
}

/** One road of the document, and where in it that road was named. */
interface Road extends RoadEndpoints {
  readonly routeNumber: number;
  readonly legNumber: number | null;
}

/**
 * One Combination entry, as the uniqueness rule compares them.
 *
 * The rule is about the PAIR, so the entry travels as its two roads together.
 * See `isSameCombination`: one road may be a leg of many Combinations, and only
 * the same pair twice is a duplicate.
 */
interface Configuration {
  readonly routeNumber: number;
  readonly roads: readonly RoadEndpoints[];
}

/**
 * Reads a bulk import and decides whether it may be performed — without
 * performing any part of it.
 *
 * ── WHY VALIDATION IS A PHASE OF ITS OWN ────────────────────────────────────
 * Twenty valid routes and one broken one must produce NO database change. The
 * only way to promise that and still report every problem at once is to judge the
 * whole document before writing anything: a transaction that aborted on entry
 * twenty-one would roll back correctly but would have found only the FIRST
 * problem, leaving an operator to fix eighty routes one error at a time.
 *
 * It is also what makes a preview possible, since the preview and the import ask
 * this same class the same question.
 *
 * ── THE RULES ARE NOT RESTATED HERE ─────────────────────────────────────────
 * Field validation runs class-validator over the very DTO classes the manual
 * endpoints use, with the same options as the global pipe. Duplicate detection
 * calls the same lookup the manual create calls, which applies the canonical
 * terminal rule. Nothing in this file decides what a valid route is; it decides
 * only how to say which entry was wrong.
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
        routes: [],
      };
    }

    return this.checkEntries(envelope.entries);
  }

  private async checkEntries(
    entries: readonly unknown[],
  ): Promise<BulkRouteImportPlan> {
    const errors: BulkRouteImportErrorDto[] = [];
    const routes: ImportedRoute[] = [];

    for (const [index, entry] of entries.entries()) {
      const routeNumber = index + 1;
      const read = await this.readEntry(entry, routeNumber);

      errors.push(...read.errors);

      if (read.route) {
        routes.push(read.route);
      }
    }

    errors.push(...this.collidingWithinDocument(routes));
    errors.push(...(await this.collidingWithStoredRoutes(routes)));

    const isValid = errors.length === 0;

    /*
     * Reported in the order an operator reads the document. The duplicate checks
     * run last and would otherwise put "route 1 is already configured" below
     * route 20's missing field, in a list meant to be worked through top to
     * bottom.
     */
    errors.sort(byEntry);

    this.logger.log("Bulk route import checked", {
      entryCount: entries.length,
      errorCount: errors.length,
      isValid,
    });

    return {
      isValid,
      summary: summaryOf(routes),
      errors,
      // A refused document creates nothing, so it offers nothing to create.
      routes: isValid ? routes : [],
    };
  }

  /**
   * One entry, as the type it declares.
   *
   * The declared type decides which DTO validates it, so a NORMAL entry is held
   * to the manual create's rules exactly and a COMBINATION to the two-leg rule.
   * An entry that declares neither cannot be validated as either, and says so.
   */
  private async readEntry(
    entry: unknown,
    routeNumber: number,
  ): Promise<{
    route: ImportedRoute | null;
    errors: BulkRouteImportErrorDto[];
  }> {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return {
        route: null,
        errors: [
          failure(routeNumber, null, null, "each route must be an object"),
        ],
      };
    }

    const declared = (entry as Record<string, unknown>).type;

    if (declared === RouteConfigurationType.NORMAL) {
      return this.readNormal(entry, routeNumber);
    }

    if (declared === RouteConfigurationType.COMBINATION) {
      return this.readCombination(entry, routeNumber);
    }

    return {
      route: null,
      errors: [
        failure(
          routeNumber,
          null,
          "type",
          `type must be ${RouteConfigurationType.NORMAL} or ${RouteConfigurationType.COMBINATION}`,
        ),
      ],
    };
  }

  private async readNormal(
    entry: object,
    routeNumber: number,
  ): Promise<{
    route: ImportedRoute | null;
    errors: BulkRouteImportErrorDto[];
  }> {
    const route = plainToInstance(BulkNormalRouteImportDto, entry);
    const failures = await validate(route, VALIDATION_OPTIONS);

    if (failures.length > 0) {
      return { route: null, errors: flatten(failures, routeNumber, null) };
    }

    return { route: { kind: "NORMAL", route }, errors: [] };
  }

  private async readCombination(
    entry: object,
    routeNumber: number,
  ): Promise<{
    route: ImportedRoute | null;
    errors: BulkRouteImportErrorDto[];
  }> {
    const combination = plainToInstance(BulkCombinationRouteImportDto, entry);
    const failures = await validate(combination, VALIDATION_OPTIONS);

    if (failures.length > 0) {
      return {
        route: null,
        errors: flatten(failures, routeNumber, null),
      };
    }

    /*
     * The two legs of one Combination must be different roads. Pricing selects a
     * leg BY its road, so two legs on one road would make the choice between
     * them arbitrary — the same reason the partial unique index refuses it.
     */
    const [outbound, back] = combination.legs;

    if (isSameRoad(outbound, back)) {
      return {
        route: null,
        errors: [
          failure(
            routeNumber,
            null,
            "legs",
            "the two legs of a Combination must be different routes",
          ),
        ],
      };
    }

    return { route: { kind: "COMBINATION", combination }, errors: [] };
  }

  /**
   * Entries of this same document that configure the same thing twice.
   *
   * Checked separately from the stored records, because neither exists yet: two
   * identical entries would pass every per-entry rule and then collide with each
   * other halfway through the transaction, reported as a database conflict on an
   * entry the operator never thought was the problem.
   *
   * ── EACH KIND BY ITS OWN IDENTITY ─────────────────────────────────────────
   * An ordinary route is its road, and one road may hold one ordinary
   * configuration. A Combination is its PAIR of roads: the same leg may be used
   * by as many Combinations as an operator has returns for it, so a document
   * naming `Quay 869 → Lessines` as Leg 1 of ten Combinations is ten
   * configurations and not one collision. What is refused is the same pair twice.
   *
   * A Combination leg and an ordinary route on one road are not a collision
   * either, exactly as the partial unique indexes have it.
   */
  private collidingWithinDocument(
    routes: readonly ImportedRoute[],
  ): BulkRouteImportErrorDto[] {
    return [
      ...duplicatesAmong(ordinaryRoads(routes), "route"),
      ...duplicateCombinationsAmong(combinationConfigurations(routes)),
    ];
  }

  /**
   * Entries that are already configured in the database.
   *
   * Through the same lookups the manual create uses, so the canonical terminal
   * rule applies: an import naming `PSA Quay 869` collides with a route
   * configured as `Quay 869`. Nothing is overwritten and nothing is skipped — the
   * import is refused and says which entry is already there.
   *
   * An ordinary route is compared by its road; a Combination by its pair, which
   * is the only thing that identifies one. A leg whose road is already used by
   * some OTHER Combination is not a collision.
   */
  private async collidingWithStoredRoutes(
    routes: readonly ImportedRoute[],
  ): Promise<BulkRouteImportErrorDto[]> {
    const errors: BulkRouteImportErrorDto[] = [];

    for (const road of ordinaryRoads(routes)) {
      if (await this.isConfigured(road, RouteConfigurationKind.NORMAL)) {
        errors.push(alreadyConfigured(road, "route"));
      }
    }

    for (const configuration of combinationConfigurations(routes)) {
      if (await this.isConfiguredCombination(configuration.roads)) {
        errors.push(
          failure(
            configuration.routeNumber,
            null,
            null,
            `this Combination is already configured: ${describeCombination(configuration.roads)}`,
          ),
        );
      }
    }

    return errors;
  }

  private async isConfigured(
    road: Road,
    kind: RouteConfigurationKind,
  ): Promise<boolean> {
    const configured = await this.routePricing.findConfiguredRoute(
      road.departure,
      road.destination,
      kind,
    );

    return configured !== null;
  }

  private async isConfiguredCombination(
    roads: readonly RoadEndpoints[],
  ): Promise<boolean> {
    const configured =
      await this.combinationPricing.findConfiguredCombination(roads);

    return configured !== null;
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
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return {
      entries: null,
      errors: [
        failure(null, null, null, "the document must be an object with a routes array"),
      ],
    };
  }

  const routes = (document as { routes?: unknown }).routes;

  if (!Array.isArray(routes)) {
    return {
      entries: null,
      errors: [failure(null, null, "routes", "routes must be an array")],
    };
  }

  if (routes.length === 0) {
    return {
      entries: null,
      errors: [failure(null, null, "routes", "routes must not be empty")],
    };
  }

  /*
   * A bound, because the whole import runs in ONE transaction and its size
   * decides how long that transaction holds its locks. Refused rather than
   * truncated: importing the first five hundred of six hundred routes silently
   * would be the worst of both answers.
   */
  if (routes.length > MAX_IMPORT_ROUTES) {
    return {
      entries: null,
      errors: [
        failure(
          null,
          null,
          "routes",
          `routes must contain at most ${MAX_IMPORT_ROUTES} entries, not ${routes.length}`,
        ),
      ],
    };
  }

  return { entries: routes, errors: [] };
}

/** The roads the ordinary entries describe. */
function ordinaryRoads(routes: readonly ImportedRoute[]): Road[] {
  return routes.flatMap((entry, index) =>
    entry.kind === "NORMAL"
      ? [
          {
            departure: entry.route.departure,
            destination: entry.route.destination,
            routeNumber: index + 1,
            legNumber: null,
          },
        ]
      : [],
  );
}

/** The Combination entries, each as its own pair of roads. */
function combinationConfigurations(
  routes: readonly ImportedRoute[],
): Configuration[] {
  return routes.flatMap((entry, index) =>
    entry.kind === "COMBINATION"
      ? [
          {
            routeNumber: index + 1,
            roads: entry.combination.legs.map((leg) => ({
              departure: leg.departure,
              destination: leg.destination,
            })),
          },
        ]
      : [],
  );
}

/**
 * Every Combination configured twice in one document, reported on the LATER
 * entry.
 *
 * Only an identical PAIR counts, in either leg order — see `isSameCombination`.
 * Two Combinations sharing one leg are two configurations, and this is the check
 * that used to refuse them.
 */
function duplicateCombinationsAmong(
  configurations: readonly Configuration[],
): BulkRouteImportErrorDto[] {
  return configurations.flatMap((configuration, index) => {
    const earlier = configurations
      .slice(0, index)
      .find((candidate) => isSameCombination(candidate.roads, configuration.roads));

    return earlier
      ? [
          failure(
            configuration.routeNumber,
            null,
            null,
            `this Combination is already configured by route ${earlier.routeNumber} of this import: ${describeCombination(configuration.roads)}`,
          ),
        ]
      : [];
  });
}

/**
 * Every road named more than once in one scope, reported on the LATER entry.
 *
 * The later one is the duplicate: the first occurrence is the route the operator
 * meant to configure, and naming it as the problem would be confusing.
 */
function duplicatesAmong(
  roads: readonly Road[],
  subject: "route" | "leg",
): BulkRouteImportErrorDto[] {
  return roads.flatMap((road, index) => {
    const earlier = roads
      .slice(0, index)
      .find((candidate) => isSameRoad(candidate, road));

    return earlier
      ? [
          failure(
            road.routeNumber,
            road.legNumber,
            null,
            `this ${subject} is already configured by route ${earlier.routeNumber} of this import: ${road.departure} to ${road.destination}`,
          ),
        ]
      : [];
  });
}

function alreadyConfigured(
  road: Road,
  subject: "route" | "leg",
): BulkRouteImportErrorDto {
  return failure(
    road.routeNumber,
    road.legNumber,
    null,
    `this ${subject} is already configured: ${road.departure} to ${road.destination}`,
  );
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
     * money ceiling. All three say the same thing, and an operator reading eighty
     * routes has to read past two of them. A present value that is wrong still
     * reports each rule it broke, because those are different facts.
     */
    const own =
      error.value === undefined || error.value === null
        ? [failure(routeNumber, legNumber, error.property, `${error.property} is required`)]
        : Object.values(error.constraints ?? {}).map((message) =>
            failure(routeNumber, legNumber, error.property, message),
          );

    const nested = (error.children ?? []).flatMap((child) =>
      flatten([child], routeNumber, isArrayIndex ? index + 1 : legNumber),
    );

    return [...own, ...nested];
  });
}

/** The order the document is read in: entry, then leg. */
function byEntry(
  left: BulkRouteImportErrorDto,
  right: BulkRouteImportErrorDto,
): number {
  return (
    (left.routeNumber ?? 0) - (right.routeNumber ?? 0) ||
    (left.legNumber ?? 0) - (right.legNumber ?? 0)
  );
}

function failure(
  routeNumber: number | null,
  legNumber: number | null,
  field: string | null,
  message: string,
): BulkRouteImportErrorDto {
  return { routeNumber, legNumber, field, message };
}

/** What the readable entries would create. */
function summaryOf(routes: readonly ImportedRoute[]) {
  const normalRoutes = routes.filter((entry) => entry.kind === "NORMAL").length;
  const combinationGroups = routes.length - normalRoutes;
  const combinationLegs = routes.reduce(
    (total, entry) =>
      entry.kind === "COMBINATION" ? total + entry.combination.legs.length : total,
    0,
  );

  return {
    normalRoutes,
    combinationGroups,
    combinationLegs,
    totalRoutes: normalRoutes + combinationLegs,
  };
}
