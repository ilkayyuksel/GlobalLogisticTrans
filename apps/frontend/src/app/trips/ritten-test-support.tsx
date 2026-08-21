import { render } from "@testing-library/react";

import RittenPage from "./page";
import type { Paginated, Trip } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

/**
 * Shared fixtures for the Ritten specs.
 *
 * Not a test file — it holds only builders, so each spec states what it is
 * about instead of repeating forty lines of Trip.
 */

export const VEHICLE_COLOR = "#2563eb";

export const VEHICLE = {
  id: "vehicle-1",
  licensePlate: "1-ABC-123",
  displayColor: VEHICLE_COLOR,
  isActive: true,
};

export function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: VEHICLE.id,
    driverId: null,
    customProperties: [],
    direction: null,
    vehicle: VEHICLE,
    effectiveDriver: {
      id: "driver-1",
      name: "Piet Janssens",
      isActive: true,
      source: "VEHICLE_ASSIGNMENT",
    },
    latestUpdate: null,
    costConfirmation: null,
    status: "OPEN",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: "2026-08-13",
    planningDate: "2026-08-13",
    startTime: "10:00:00",
    endTime: "16:00:00",
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildPage(
  items: Trip[],
  meta: Partial<Paginated<Trip>["meta"]> = {},
): Paginated<Trip> {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 50,
      totalItems: items.length,
      totalPages: 1,
      ...meta,
    },
  };
}

/** Every count the page asks for answers with the same total. */
export function countPage(totalItems: number): Paginated<Trip> {
  return buildPage([], { pageSize: 1, totalItems, totalPages: 1 });
}

export interface BackendResponses {
  /** The page of Trips the list request answers with. */
  trips?: Paginated<Trip>;
  open?: number;
  closed?: number;
  total?: number;
  vehicles?: { id: string; licensePlate: string }[];
  /** The distinct terminals the filter dropdown offers. */
  terminals?: string[];
  /** The stored pricing the export reads, per Trip. */
  pricingSnapshots?: unknown[];
  /** Configuration, including the fuel percentage the export labels with. */
  settings?: unknown[];
  drivers?: { id: string; name: string }[];
  /** What a Combination lookup answers with. */
  groupMembers?: Trip[];
  /** The Custom Properties already on the Trip. */
  assignedCustomProperties?: unknown[];
  /** The active Custom Properties a Trip can be given. */
  availableCustomProperties?: unknown[];
  /** The Trip's pricing snapshot, or null when it has none. */
  pricing?: unknown;
  /** The id a manual grouping request answers with. */
  createdGroupId?: string;
}

/**
 * The mocked API client, seen loosely.
 *
 * `request` is generic in its return type, which no single mock signature can
 * satisfy; these helpers only ever read the path and the query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RequestMock = jest.MockedFunction<any>;

type RequestCall = [
  string,
  { query?: Record<string, unknown>; method?: string; body?: unknown } | undefined,
];

export const DRIVER = {
  id: "driver-1",
  name: "Piet Janssens",
  isActive: true,
};

/** A one-page list response, which is what every picker endpoint returns. */
function page<TItem>(items: TItem[]) {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 200,
      totalItems: items.length,
      totalPages: 1,
    },
  };
}

/**
 * Answers the API client the way the backend would.
 *
 * Mocking at the client boundary rather than at `listTrips` keeps the real
 * query-building in the test: a spec can assert that the period, the filters
 * and the counts were genuinely asked of the backend, which is the whole point
 * of a list that never filters in the browser.
 */
export function respondWith(
  request: RequestMock,
  responses: BackendResponses = {},
): void {
  request.mockImplementation((...args: unknown[]) => {
    const [path, options] = args as RequestCall;
    const query = options?.query ?? {};
    const method = options?.method ?? "GET";

    if (path === "/api/v1/vehicles") {
      return Promise.resolve(page(responses.vehicles ?? [VEHICLE]));
    }

    if (path === "/api/v1/drivers") {
      return Promise.resolve(page(responses.drivers ?? [DRIVER]));
    }

    // The export reads stored pricing in bulk, and the configured fuel
    // percentage that labels it. Both are READS: neither prices anything.
    if (path === "/api/v1/trip-pricing/snapshots") {
      return Promise.resolve(responses.pricingSnapshots ?? []);
    }

    if (path === "/api/v1/settings") {
      return Promise.resolve(
        responses.settings ?? [
          {
            id: "setting-fuel",
            category: "PRICING",
            key: "FUEL_PERCENTAGE",
            value: "15",
            valueType: "DECIMAL",
            description: null,
          },
        ],
      );
    }

    // Declared before the Trip routes: it is a sibling of them, not a Trip.
    if (path === "/api/v1/trips/terminals") {
      return Promise.resolve(responses.terminals ?? ["PSA Quay 869"]);
    }

    if (path === "/api/v1/custom-properties") {
      return Promise.resolve(page(responses.availableCustomProperties ?? []));
    }

    if (path.startsWith("/api/v1/trip-custom-properties/trip/")) {
      return Promise.resolve({
        items: responses.assignedCustomProperties ?? [],
      });
    }

    // Assigning and removing a Custom Property.
    if (path.startsWith("/api/v1/trip-custom-properties")) {
      return Promise.resolve({});
    }

    if (path.includes("/reprocess")) {
      return Promise.resolve({});
    }

    if (path.startsWith("/api/v1/trip-pricing/trip/")) {
      return Promise.resolve(responses.pricing ?? null);
    }

    // Creating a manual group.
    if (path === "/api/v1/trip-groups") {
      return Promise.resolve({
        id: responses.createdGroupId ?? "97777777-7777-4777-8777-777777777777",
        tripCount: 2,
        trips: [],
      });
    }

    // Every Trip mutation: PATCH on the Trip or one of its sub-resources.
    if (method !== "GET" && path.startsWith("/api/v1/trips/")) {
      return Promise.resolve(buildTrip());
    }

    if (query.tripGroupId) {
      return Promise.resolve(buildPage(responses.groupMembers ?? []));
    }

    // A count: one row requested, only the total read.
    if (query.pageSize === 1) {
      if (query.status === "OPEN") {
        return Promise.resolve(countPage(responses.open ?? 0));
      }

      if (query.status === "CLOSED") {
        return Promise.resolve(countPage(responses.closed ?? 0));
      }

      return Promise.resolve(countPage(responses.total ?? 0));
    }

    return Promise.resolve(responses.trips ?? buildPage([]));
  });
}

/** Every call the page made with a method other than GET. */
export function mutationCalls(request: RequestMock): RequestCall[] {
  return (request.mock.calls as RequestCall[]).filter(
    ([, options]) => (options?.method ?? "GET") !== "GET",
  );
}

/** The list request, ignoring the counts and the vehicle lookup. */
export function listCalls(
  request: RequestMock,
): Record<string, unknown>[] {
  return (request.mock.calls as RequestCall[])
    .filter(
      ([path, options]) =>
        path === "/api/v1/trips" &&
        options?.query?.pageSize !== 1 &&
        !options?.query?.tripGroupId,
    )
    .map(([, options]) => options?.query ?? {});
}

export function lastListCall(request: RequestMock): Record<string, unknown> {
  const calls = listCalls(request);

  return calls[calls.length - 1] ?? {};
}

export function renderRitten() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <RittenPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}
