import { request } from "./client";

const PATH = "/api/v1/route-configuration";
const COMBINATIONS_PATH = `${PATH}/combinations`;
const BULK_PATH = `${PATH}/bulk`;
const BULK_CHECK_PATH = `${BULK_PATH}/check`;

/**
 * One route, as the operator configures it.
 *
 * ── ONE RECORD, WHATEVER THE TABLES DO ──────────────────────────────────────
 * The backend stores a route's price and its route-dependent costs in separate
 * tables. That split is invisible here, deliberately: an operator configuring
 * "Quay 869 to Dourges" means one route, and the composition is the backend's
 * job. Nothing on this side assembles or splits a route.
 *
 * ── AND THE TOLL IS NOT ONE OF ITS AMOUNTS ──────────────────────────────────
 * A route carries its LENGTH. What a Trip pays in toll is that length times the
 * rate configured once for the whole business, and the Pricing Engine works it
 * out — never this screen, which stores kilometres and shows what it stored.
 *
 * Amounts are preformatted two-decimal STRINGS and are displayed exactly as
 * received. No arithmetic happens in the browser.
 */
export interface RouteConfiguration {
  id: string;
  departure: string;
  destination: string;
  tarief: string;
  /**
   * The route's length in kilometres, or null when nobody has stated it.
   *
   * Null is not zero: a route of no stated length is charged no toll, while a
   * route stated as nought kilometres is a decision somebody made. Routes
   * configured before distances existed carry null until an operator fills
   * them in.
   */
  kilometres: string | null;
  tunnel: string;
  /**
   * Whether a tunnel cost is actually configured, as opposed to absent.
   *
   * Both read "0.00" as a price, and the distinction matters to an operator: a
   * configured zero is a decision, an absent one is a gap the Pricing Engine
   * reports when a Trip carries the property.
   */
  hasTunnel: boolean;
  /**
   * Which kind of configuration this record is.
   *
   * NORMAL is an ordinary route. COMBINATION is one LEG of a two-leg Combination
   * configuration, which is edited and removed as a whole — so a leg is never
   * offered as a route an operator could change on its own.
   *
   * Both kinds may describe the same Van and Naar. That is not a duplicate: the
   * backend reads them in different pricing contexts and neither overwrites the
   * other.
   */
  type: "NORMAL" | "COMBINATION";
  /** The Combination this record is a leg of, or null for an ordinary route. */
  combinationGroupId: string | null;
  /**
   * Whether an administrator has been through these prices.
   *
   * ── ADMINISTRATIVE PROGRESS ONLY ──────────────────────────────────────────
   * It records that a person has looked, so a long price list can be worked
   * through. It says nothing about whether the route is used and nothing about
   * what a Trip is charged: an unreviewed route prices exactly as a reviewed one
   * does, and the Pricing Engine never reads it.
   *
   * On a Combination LEG this is the group's own mark, repeated so a row can be
   * read on its own — a leg is never reviewed by itself.
   */
  reviewed: boolean;
}

/**
 * One Combination route configuration: a group and its two legs.
 *
 * ── WHY THE GROUP IS THE THING ──────────────────────────────────────────────
 * Antwerp to Kallo at 100 and Kallo back to Antwerp at 80 is ONE record an
 * operator configures, with two legs that legitimately cost different amounts.
 * The identity acted on is the group's, because half a Combination would price
 * one direction and charge nothing for the other.
 *
 * Nothing to do with a Trip group in the Rittenlijst: that decides which Trips
 * carry the Backload, this decides what a route costs.
 */
export interface CombinationRouteConfiguration {
  id: string;
  /**
   * Whether an administrator has been through this Combination's prices.
   *
   * On the group, because the group is what an operator configures, edits,
   * removes — and therefore reviews.
   */
  reviewed: boolean;
  /** Exactly two, the outbound first. */
  legs: RouteConfiguration[];
}

/** What a route is saved with. Amounts are numbers; the backend rounds. */
export interface RouteConfigurationPayload {
  departure: string;
  destination: string;
  tarief: number;
  /**
   * A distance, not an amount: the Engine turns it into the Toll.
   *
   * Null means nobody has stated how long the road is, which is not the same as
   * a road of no length — the first is charged no toll, the second is charged
   * nothing because somebody decided it costs nothing.
   */
  kilometres: number | null;
  tunnel: number;
}

/** Both legs of a Combination, saved together or not at all. */
export interface CombinationRouteConfigurationPayload {
  legs: RouteConfigurationPayload[];
}

export function listRouteConfigurations(
  signal?: AbortSignal,
): Promise<RouteConfiguration[]> {
  return request<RouteConfiguration[]>(PATH, { signal });
}

export function createRouteConfiguration(
  payload: RouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateRouteConfiguration(
  id: string,
  payload: RouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(`${PATH}/${id}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

/**
 * Removes a route's configuration and answers with what was removed.
 *
 * The price and the route's tunnel cost go together — the backend guarantees
 * it — so the screen offers one action rather than three. Trips already priced
 * keep the amounts they were priced with; only the next calculation notices.
 *
 * ── WHY IT RETURNS THE ROUTE ────────────────────────────────────────────────
 * Every response in this API carries the standard envelope, and an empty body is
 * not one. These two endpoints used to answer 204 No Content: the deletion
 * succeeded, the browser found no envelope to read, and the screen reported a
 * failure for something that had already happened. They now answer 200 with the
 * removed configuration, like every other DELETE here.
 */
export function deleteRouteConfiguration(
  id: string,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(`${PATH}/${id}`, {
    method: "DELETE",
    signal,
  });
}

/*
 * ── THE COMBINATION ROUTES ──────────────────────────────────────────────────
 * Their own endpoints rather than a flag on the ones above, because the thing
 * acted on is the PAIR: created with two legs, edited with two legs and removed
 * as a whole. The backend writes both legs in one transaction, so this side
 * never has to keep them in step.
 */

export function listCombinationRouteConfigurations(
  signal?: AbortSignal,
): Promise<CombinationRouteConfiguration[]> {
  return request<CombinationRouteConfiguration[]>(COMBINATIONS_PATH, { signal });
}

export function createCombinationRouteConfiguration(
  payload: CombinationRouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<CombinationRouteConfiguration> {
  return request<CombinationRouteConfiguration>(COMBINATIONS_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateCombinationRouteConfiguration(
  combinationGroupId: string,
  payload: CombinationRouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<CombinationRouteConfiguration> {
  return request<CombinationRouteConfiguration>(
    `${COMBINATIONS_PATH}/${combinationGroupId}`,
    { method: "PUT", body: payload, signal },
  );
}

/**
 * Removes a Combination, both of its legs and each leg's own tunnel.
 *
 * Never one leg: the backend refuses that outright, because a Combination with
 * one leg prices one direction and silently charges nothing for the other.
 * Trips already priced keep the amounts they were priced with.
 */
export function deleteCombinationRouteConfiguration(
  combinationGroupId: string,
  signal?: AbortSignal,
): Promise<CombinationRouteConfiguration> {
  return request<CombinationRouteConfiguration>(
    `${COMBINATIONS_PATH}/${combinationGroupId}`,
    { method: "DELETE", signal },
  );
}

/*
 * ── THE BULK IMPORT ─────────────────────────────────────────────────────────
 * JSON is the input format and nothing else: the backend turns each entry into
 * exactly the same records a route configured by hand becomes, with exactly the
 * same rules. Nothing on this side validates a route, counts what would be
 * created or decides what a duplicate is — all three are answered by `check`,
 * because a browser's copy of a business rule is the one that drifts.
 *
 * The whole document goes out as the body, `routes` array and all: the backend
 * reads the envelope too, so "this JSON has no routes array" is reported in the
 * same list, in the same words, as "route 4 has no kilometres".
 */

/** What an import would create, or did. */
export interface BulkRouteImportSummary {
  normalRoutes: number;
  combinationGroups: number;
  combinationLegs: number;
  totalRoutes: number;
}

/** What is wrong with one entry, and which entry it is. */
export interface BulkRouteImportError {
  routeNumber: number;
  legNumber: number | null;
  field: string | null;
  message: string;
}

export interface BulkRouteImportCheck {
  isValid: boolean;
  summary: BulkRouteImportSummary;
  errors: BulkRouteImportError[];
}

/**
 * Asks what an import would do, without doing any of it.
 *
 * This is the preview. A refused document comes back as an ordinary answer with
 * its reasons, not as a failure, because the question was "what would happen".
 */
export function checkBulkRouteImport(
  document: unknown,
  signal?: AbortSignal,
): Promise<BulkRouteImportCheck> {
  return request<BulkRouteImportCheck>(BULK_CHECK_PATH, {
    method: "POST",
    body: document,
    signal,
  });
}

/**
 * Performs the import, or nothing at all.
 *
 * The backend validates the document again and writes it in one transaction, so
 * twenty valid routes and one broken one leave the configuration untouched.
 */
export function runBulkRouteImport(
  document: unknown,
  signal?: AbortSignal,
): Promise<BulkRouteImportSummary> {
  return request<BulkRouteImportSummary>(BULK_PATH, {
    method: "POST",
    body: document,
    signal,
  });
}

/*
 * ── ADMINISTRATIVE PROGRESS ─────────────────────────────────────────────────
 * Its own endpoint rather than part of the ordinary save: ticking a box is not an
 * edit, and sending the amounts back to record one would rewrite prices nobody
 * meant to touch. The value is SENT rather than toggled, so pressing twice leaves
 * it where it was put and two administrators cannot flip each other's mark.
 */

export function markRouteConfigurationReviewed(
  id: string,
  reviewed: boolean,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(`${PATH}/${id}/review`, {
    method: "PATCH",
    body: { reviewed },
    signal,
  });
}

export function markCombinationRouteConfigurationReviewed(
  combinationGroupId: string,
  reviewed: boolean,
  signal?: AbortSignal,
): Promise<CombinationRouteConfiguration> {
  return request<CombinationRouteConfiguration>(
    `${COMBINATIONS_PATH}/${combinationGroupId}/review`,
    { method: "PATCH", body: { reviewed }, signal },
  );
}

/*
 * ── ACTIONS ON SEVERAL CONFIGURATIONS AT ONCE ───────────────────────────────
 * Each runs its whole selection in ONE backend transaction, through the very
 * services the single-record endpoints use. Nothing on this side loops over
 * records or decides which ones belong together.
 */

const BULK_DELETE_PATH = `${PATH}/bulk-delete`;

/** What a bulk delete removes: ordinary routes, and Combinations as a whole. */
export interface BulkRemoveRouteConfigurationPayload {
  routeIds: string[];
  combinationGroupIds: string[];
}

export interface BulkRemoveRouteConfigurationResult {
  removedRoutes: number;
  removedCombinations: number;
}

/**
 * Removes the whole selection, or nothing at all.
 *
 * A Combination is named by its group, never by a leg, so it always goes with
 * both legs. If any record cannot be removed the backend removes none, and the
 * refusal is reported with its reason.
 */
export function bulkDeleteRouteConfigurations(
  payload: BulkRemoveRouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<BulkRemoveRouteConfigurationResult> {
  return request<BulkRemoveRouteConfigurationResult>(BULK_DELETE_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** 1 is the outbound leg, listed first; 2 the return. */
export type CombinationLegPosition = 1 | 2;

/**
 * One leg's price sync: the leg, its values, and which other Combinations it
 * reaches.
 *
 * The targets are decided by the backend — same leg position, exactly the same
 * Van and Naar — and the preview and the sync ask the same rule, so the count a
 * confirmation shows is the count the sync works from.
 */
export interface CombinationLegSync {
  combinationGroupId: string;
  legPosition: CombinationLegPosition;
  departure: string;
  destination: string;
  prices: {
    tarief: string;
    kilometres: string | null;
    tunnel: string;
  };
  targetCombinationGroupIds: string[];
}

function legSyncPath(
  combinationGroupId: string,
  legPosition: CombinationLegPosition,
): string {
  return `${COMBINATIONS_PATH}/${combinationGroupId}/legs/${legPosition}`;
}

/** Which Combinations a sync of this leg would reach. Writes nothing. */
export function previewCombinationLegSync(
  combinationGroupId: string,
  legPosition: CombinationLegPosition,
  signal?: AbortSignal,
): Promise<CombinationLegSync> {
  return request<CombinationLegSync>(
    `${legSyncPath(combinationGroupId, legPosition)}/sync-targets`,
    { signal },
  );
}

/**
 * Copies this leg's stored Tarief, KM and Tunnel to every matching leg, in one
 * transaction. Never an ordinary route, never the other leg position.
 */
export function syncCombinationLeg(
  combinationGroupId: string,
  legPosition: CombinationLegPosition,
  signal?: AbortSignal,
): Promise<CombinationLegSync> {
  return request<CombinationLegSync>(
    `${legSyncPath(combinationGroupId, legPosition)}/sync`,
    { method: "POST", signal },
  );
}
