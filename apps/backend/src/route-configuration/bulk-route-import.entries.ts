import {
  RoadEndpoints,
  describeCombination,
  isSameCombination,
  isSameRoad,
} from "../route-pricing/route-identity";
import {
  BulkCombinationRouteImportDto,
  BulkNormalRouteImportDto,
  BulkRouteImportErrorDto,
  BulkRouteImportProblemCode,
  BulkRouteImportSkippedDto,
  BulkRouteImportSummaryDto,
} from "./dto/bulk-route-import.dto";

/** One entry of an import that passed every per-entry rule. */
export type ImportedRoute = { readonly routeNumber: number } & (
  | { readonly kind: "NORMAL"; readonly route: BulkNormalRouteImportDto }
  | { readonly kind: "COMBINATION"; readonly combination: BulkCombinationRouteImportDto }
);

export function problem(
  routeNumber: number | null,
  legNumber: number | null,
  field: string | null,
  message: string,
  code: BulkRouteImportProblemCode | null,
): BulkRouteImportErrorDto {
  return { routeNumber, legNumber, field, message, code };
}

/** The road, or pair of roads, an accepted entry configures. */
export function roadsOf(entry: ImportedRoute): RoadEndpoints[] {
  const roads =
    entry.kind === "NORMAL" ? [entry.route] : entry.combination.legs;

  return roads.map((road) => ({ departure: road.departure, destination: road.destination }));
}

/** The entry as an operator names it: `A to B`, or both roads of a pair. */
export function describeEntry(entry: ImportedRoute): string {
  return describeCombination(roadsOf(entry));
}

/**
 * The same, best-effort, for an entry that could not be read: the roads it
 * names when they are text, else null. Only for the report — never matched on.
 */
export function describeRawEntry(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const raw = entry as { departure?: unknown; destination?: unknown; legs?: unknown };
  const roads = Array.isArray(raw.legs) ? (raw.legs as unknown[]) : [raw];
  const named = roads.filter(
    (road): road is RoadEndpoints =>
      typeof road === "object" &&
      road !== null &&
      typeof (road as RoadEndpoints).departure === "string" &&
      typeof (road as RoadEndpoints).destination === "string",
  );

  return named.length === roads.length && named.length > 0 ? describeCombination(named) : null;
}

/** The type an entry declares, when it declares a known one. */
export function declaredType(entry: unknown): "NORMAL" | "COMBINATION" | null {
  const type = (entry as { type?: unknown } | null)?.type;

  return type === "NORMAL" || type === "COMBINATION" ? type : null;
}

/**
 * Whether two accepted entries configure the same thing.
 *
 * Each kind by its own identity: an ordinary route is its road, a Combination
 * its PAIR (`isSameCombination`). A Combination leg and an ordinary route on one
 * road, or two Combinations sharing one leg, are not the same — exactly as the
 * partial unique indexes have it.
 */
function configuresSame(left: ImportedRoute, right: ImportedRoute): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  return left.kind === "NORMAL"
    ? isSameRoad(roadsOf(left)[0], roadsOf(right)[0])
    : isSameCombination(roadsOf(left), roadsOf(right));
}

/**
 * Entries of one document that configure what an EARLIER entry already does.
 *
 * The first occurrence is kept — it is the route the operator meant — and every
 * later one is skipped, naming the entry it repeats. Deterministic, and never
 * two conflicting versions of one route: amounts play no part in identity.
 */
export function duplicatesWithinDocument(
  routes: readonly ImportedRoute[],
): Map<number, BulkRouteImportErrorDto> {
  const duplicates = new Map<number, BulkRouteImportErrorDto>();

  routes.forEach((entry, index) => {
    const earlier = routes
      .slice(0, index)
      .find((candidate) => !duplicates.has(candidate.routeNumber) && configuresSame(candidate, entry));

    if (earlier) {
      const subject = entry.kind === "NORMAL" ? "route" : "Combination";

      duplicates.set(
        entry.routeNumber,
        problem(
          entry.routeNumber,
          null,
          null,
          `this ${subject} is already configured by route ${earlier.routeNumber} of this import: ${describeEntry(entry)}`,
          "DUPLICATE_IN_IMPORT",
        ),
      );
    }
  });

  return duplicates;
}

/** One skipped entry for the report. */
export function skippedEntry(
  routeNumber: number,
  type: "NORMAL" | "COMBINATION" | null,
  route: string | null,
  reasons: BulkRouteImportErrorDto[],
): BulkRouteImportSkippedDto {
  return { routeNumber, type, route, reasons };
}

/** What these entries create. */
export function summaryOf(routes: readonly ImportedRoute[]): BulkRouteImportSummaryDto {
  const normalRoutes = routes.filter((entry) => entry.kind === "NORMAL").length;
  const combinationGroups = routes.length - normalRoutes;
  const combinationLegs = routes.reduce(
    (total, entry) => (entry.kind === "COMBINATION" ? total + entry.combination.legs.length : total),
    0,
  );

  return {
    normalRoutes,
    combinationGroups,
    combinationLegs,
    totalRoutes: normalRoutes + combinationLegs,
  };
}

/** The order the document is read in: entry, then leg. */
export function byEntry(left: BulkRouteImportErrorDto, right: BulkRouteImportErrorDto): number {
  return (
    (left.routeNumber ?? 0) - (right.routeNumber ?? 0) ||
    (left.legNumber ?? 0) - (right.legNumber ?? 0)
  );
}
