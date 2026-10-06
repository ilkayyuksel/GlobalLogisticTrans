import { render, screen } from "@testing-library/react";

import { ApiError, request } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import PricingSettingsPage from "../page";

/**
 * The Settings → Prijzen page against an in-memory backend, for the bulk delete,
 * the leg-price sync and the scroll-position specs.
 *
 * The backend here keeps what it serves and changes it the way the real one
 * does — a bulk delete removes, a sync rewrites the matching legs — so a refetch
 * shows what a write did. A refetch can be HELD, which is what lets a spec look
 * at the page while the list is being reloaded: the moment the scroll position
 * used to be lost.
 *
 * Callers mock the client in their own file (`jest.mock` is hoisted per test
 * file), exactly as the existing pricing specs do:
 *
 *   jest.mock("@/lib/api/client", () => ({
 *     ...jest.requireActual("@/lib/api/client"),
 *     request: jest.fn(),
 *   }));
 */

export const ROUTES_PATH = "/api/v1/route-configuration";
export const COMBINATIONS_PATH = `${ROUTES_PATH}/combinations`;
export const BULK_DELETE_PATH = `${ROUTES_PATH}/bulk-delete`;
const BOOTSTRAP_PATH = "/api/v1/settings/pricing/bootstrap";

type Prices = { tarief: string; toll: string; tunnel: string };

export interface ServedRoute extends Prices {
  id: string;
  departure: string;
  destination: string;
  hasToll: boolean;
  hasTunnel: boolean;
  type: "NORMAL" | "COMBINATION";
  combinationGroupId: string | null;
  reviewed: boolean;
}

export interface ServedCombination {
  id: string;
  reviewed: boolean;
  legs: ServedRoute[];
  overSt: { tarief: string | null; toll: string | null; tunnel: string | null };
}

/** A deep copy of plain data. jsdom has no `structuredClone`. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function route(overrides: Partial<ServedRoute> = {}): ServedRoute {
  return {
    id: "route-1",
    departure: "Quay 869",
    destination: "Dourges",
    tarief: "520.00",
    toll: "15.00",
    hasToll: true,
    tunnel: "0.00",
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    reviewed: false,
    ...overrides,
  };
}

export function combination(
  id: string,
  first: [string, string, Prices],
  second: [string, string, Prices],
  reviewed = false,
): ServedCombination {
  const leg = (
    [departure, destination, prices]: [string, string, Prices],
    position: number,
  ) =>
    route({
      id: `${id}-leg-${position}`,
      departure,
      destination,
      ...prices,
      type: "COMBINATION",
      combinationGroupId: id,
      reviewed,
    });

  return {
    id,
    reviewed,
    legs: [leg(first, 1), leg(second, 2)],
    overSt: { tarief: null, toll: null, tunnel: null },
  };
}

export const prices = (
  tarief: string,
  toll: string,
  tunnel: string,
): Prices => ({ tarief, toll, tunnel });

export interface Call {
  path: string;
  method: string;
  body: unknown;
}

interface Backend {
  routes: ServedRoute[];
  combinations: ServedCombination[];
  calls: Call[];
  /** When set, the next bulk delete is refused with this message. */
  refuseBulkDelete: string | null;
  /** When set, the next sync is refused with this message. */
  refuseSync: string | null;
  /** When true, list GETs after the first load wait for `releaseRefetch`. */
  holdRefetch: boolean;
  held: (() => void)[];
  hasLoaded: { routes: boolean; combinations: boolean };
}

export const backend: Backend = {
  routes: [],
  combinations: [],
  calls: [],
  refuseBulkDelete: null,
  refuseSync: null,
  holdRefetch: false,
  held: [],
  hasLoaded: { routes: false, combinations: false },
};

/** Lets every held list request answer. */
export function releaseRefetch(): void {
  const waiting = backend.held.splice(0);

  waiting.forEach((resume) => resume());
}

export const writes = () =>
  backend.calls.filter((call) => call.method !== "GET");

/** The legs a sync of this leg reaches: same position, exactly the same road. */
function syncTargets(groupId: string, position: number): ServedCombination[] {
  const source = backend.combinations.find((each) => each.id === groupId)!;
  const leg = source.legs[position - 1];

  return backend.combinations.filter(
    (candidate) =>
      candidate.id !== groupId &&
      candidate.legs[position - 1].departure === leg.departure &&
      candidate.legs[position - 1].destination === leg.destination,
  );
}

function syncAnswer(groupId: string, position: number) {
  const source = backend.combinations.find((each) => each.id === groupId)!;
  const leg = source.legs[position - 1];

  return {
    combinationGroupId: groupId,
    legPosition: position,
    departure: leg.departure,
    destination: leg.destination,
    prices: { tarief: leg.tarief, toll: leg.toll, tunnel: leg.tunnel },
    targetCombinationGroupIds: syncTargets(groupId, position).map(
      (each) => each.id,
    ),
  };
}

function bulkDelete(body: {
  routeIds: string[];
  combinationGroupIds: string[];
}): unknown {
  if (backend.refuseBulkDelete) {
    throw new ApiError("NOT_FOUND", backend.refuseBulkDelete, 404);
  }

  backend.routes = backend.routes.filter(
    (each) => !body.routeIds.includes(each.id),
  );
  backend.combinations = backend.combinations.filter(
    (each) => !body.combinationGroupIds.includes(each.id),
  );

  return {
    removedRoutes: body.routeIds.length,
    removedCombinations: body.combinationGroupIds.length,
  };
}

function sync(groupId: string, position: number): unknown {
  if (backend.refuseSync) {
    throw new ApiError("CONFLICT", backend.refuseSync, 409);
  }

  const answer = syncAnswer(groupId, position);
  const targets = new Set(answer.targetCombinationGroupIds);

  backend.combinations = backend.combinations.map((each) =>
    !targets.has(each.id)
      ? each
      : {
          ...each,
          legs: each.legs.map((leg, index) =>
            index === position - 1 ? { ...leg, ...answer.prices } : leg,
          ),
        },
  );

  return answer;
}

/** A list GET: answered at once on first load, held afterwards when asked. */
function list(kind: "routes" | "combinations"): Promise<unknown> {
  const answer = () => clone(backend[kind]);

  if (backend.holdRefetch && backend.hasLoaded[kind]) {
    return new Promise((resolve) => backend.held.push(() => resolve(answer())));
  }

  backend.hasLoaded[kind] = true;

  return Promise.resolve(answer());
}

function answer(path: string, method: string, body: unknown): Promise<unknown> {
  const syncMatch = path.match(/combinations\/([^/]+)\/legs\/(\d)\/(sync-targets|sync)$/);

  try {
    if (path === BULK_DELETE_PATH) {
      return Promise.resolve(bulkDelete(body as never));
    }

    if (syncMatch) {
      const [, groupId, position, action] = syncMatch;

      return Promise.resolve(
        action === "sync"
          ? sync(groupId, Number(position))
          : syncAnswer(groupId, Number(position)),
      );
    }
  } catch (error: unknown) {
    return Promise.reject(error);
  }

  if (method === "PATCH") {
    return Promise.resolve(body);
  }

  if (method === "DELETE") {
    const id = path.split("/").at(-1);

    backend.routes = backend.routes.filter((each) => each.id !== id);
    backend.combinations = backend.combinations.filter((each) => each.id !== id);

    return Promise.resolve(route());
  }

  if (path === BOOTSTRAP_PATH) {
    return Promise.resolve({
      settings: [],
      missingCount: 0,
      creatableCount: 0,
      blockedCount: 0,
    });
  }

  if (path === "/api/v1/settings") {
    return Promise.resolve([]);
  }

  return list(path === COMBINATIONS_PATH ? "combinations" : "routes");
}

/** Serves these records, with nothing held and nothing refused. */
export function serve(
  requestMock: jest.Mock,
  served: { routes?: ServedRoute[]; combinations?: ServedCombination[] } = {},
): void {
  backend.routes = served.routes ?? [];
  backend.combinations = served.combinations ?? [];
  backend.calls = [];
  backend.refuseBulkDelete = null;
  backend.refuseSync = null;
  backend.holdRefetch = false;
  backend.held = [];
  backend.hasLoaded = { routes: false, combinations: false };

  requestMock.mockImplementation(
    (path: string, options?: Record<string, unknown>) => {
      const method = (options?.method as string) ?? "GET";

      backend.calls.push({ path, method, body: options?.body });

      return answer(path, method, options?.body);
    },
  );
}

export function renderPage() {
  window.localStorage.setItem("tms.language", "nl");

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PricingSettingsPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

export function routesSection(): HTMLElement {
  return screen
    .getAllByText("Routeprijzen")[0]
    .closest("section") as HTMLElement;
}

export { request };
