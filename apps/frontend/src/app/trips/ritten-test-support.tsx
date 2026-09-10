import { render } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";

import RittenPage from "./page";
import type { EffectivePricing, Paginated, Trip } from "@/lib/api/types";
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

/**
 * The canonical route the BACKEND would derive for this Trip.
 *
 * The fixture stands in for the backend here, so it applies the same rule the
 * backend applies: TERMINAL to CITY on a delivery, CITY to TERMINAL on a
 * collection, with the PSA prefix off the terminal. A spec that wants a
 * particular route passes `route` explicitly and this is skipped.
 */
function routeFor(trip: Omit<Trip, "route">): Trip["route"] {
  const terminal = (trip.terminal ?? "").replace(/^PSA\s+(?=Quay\b)/i, "");
  const city = trip.destinationCity ?? "";

  if (terminal === "" && city === "") {
    return null;
  }

  return trip.direction === "COLLECTION"
    ? { from: city, to: terminal }
    : { from: terminal, to: city };
}

export function buildTrip(overrides: Partial<Trip> = {}): Trip {
  // Annotated, so the string literals keep their union types through the spread.
  const trip: Trip = {
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
      hasPhoneNumber: true,
    },
    latestUpdate: null,
    costConfirmation: null,
    pricing: null,
    reasonCode: null,
    route: null,
    status: "OPEN",
    isLooseTrip: false,
    isPaid: false,
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
  internalNotes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };

  /*
   * `in` rather than `??`: a spec that passes `route: null` is stating that the
   * Trip HAS no route, and defaulting over it would silently give it one.
   */
  return {
    ...trip,
    route: "route" in overrides ? (overrides.route ?? null) : routeFor(trip),
  };
}

/**
 * The effective pricing a Trip carries, as the list endpoint sends it.
 *
 * Every amount is a preformatted two-decimal string, because that is what the
 * backend sends and what the screen must show unchanged. `totaal` is stated
 * explicitly rather than summed here for the same reason the UI never sums it:
 * a total computed in a test would prove the test's arithmetic, not the
 * backend's.
 *
 * `components` carries only what a cell reads from it — which of the three
 * editable amounts an operator typed. Pass `overriddenComponents` to mark them.
 */
export function buildPricing({
  overriddenComponents = [],
  ...amounts
}: Partial<Omit<EffectivePricing, "components">> & {
  overriddenComponents?: readonly string[];
} = {}): EffectivePricing {
  const resolved = {
    tarief: "100.00",
    brandstof: "15.00",
    backload: "0.00",
    tol: "10.00",
    tunnel: "10.00",
    others: "20.00",
    ek: "0.00",
    totaal: "155.00",
    ...amounts,
  };

  const amountOf: Record<string, string> = {
    BASE_PRICE: resolved.tarief,
    TOLL: resolved.tol,
    TUNNEL: resolved.tunnel,
  };

  return {
    ...resolved,
    components: ["BASE_PRICE", "TOLL", "TUNNEL"].map((componentCode) => ({
      componentCode,
      engineAmount: amountOf[componentCode],
      effectiveAmount: amountOf[componentCode],
      source: overriddenComponents.includes(componentCode)
        ? ("OVERRIDE" as const)
        : ("ENGINE" as const),
    })),
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
  /**
   * What a manual price correction answers with: the WHOLE recalculated
   * breakdown for that Trip, which is what the row updates from.
   *
   * A function rather than a value, so a spec can answer differently per Trip
   * and per component — which is exactly what "only the edited Trip changed"
   * needs in order to be provable. `amount` is null for a reset.
   */
  onPricingOverride?: (correction: {
    tripId: string;
    componentCode: string;
    amount: number | null;
  }) => unknown;
  /** The refusal a price correction answers with, as the backend words it. */
  pricingOverrideFailureMessage?: string;
  /**
   * What a PATCH on a Trip answers with.
   *
   * The whole updated Trip, as the endpoint returns it — including the pricing
   * a waiting-time change recalculated. A function rather than a value so a
   * spec can answer per Trip, which is what "only the edited row changed" needs
   * in order to be provable.
   */
  onTripUpdate?: (update: {
    tripId: string;
    body: Record<string, unknown>;
  }) => Trip;
  /**
   * What assigning or removing a Custom Property answers with.
   *
   * The assignment plus the Trip's recalculated pricing, which is what the row
   * updates from. `assignmentId` is set on a removal, `customPropertyId` on an
   * assignment.
   */
  onCustomPropertyMutation?: (change: {
    method: string;
    tripId?: string;
    customPropertyId?: string;
    assignmentId?: string;
  }) => unknown;
  /** The id a manual grouping request answers with. */
  createdGroupId?: string;
  /**
   * What the WhatsApp status endpoint reports.
   *
   * CONNECTED by default, so the send button is offered in every spec that is
   * not about WhatsApp. A spec testing an outage says so explicitly.
   */
  whatsAppStatus?: string;
  /** The driver a successful send reports having reached. */
  sentToDriverName?: string;
  /**
   * The refusal a send answers with, as the backend would word it.
   *
   * Routed here rather than through `mockRejectedValueOnce`, which queues
   * against the NEXT request of any kind — and the page makes several. A
   * refusal that landed on the Trip list instead of the send made one spec fail
   * and left the queued rejection to break the one after it.
   */
  sendFailureMessage?: string;
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

    if (path === "/api/v1/whatsapp/status") {
      return Promise.resolve({
        status: responses.whatsAppStatus ?? "CONNECTED",
      });
    }

    // A successful send, answered as the backend answers it. A spec testing a
    // refusal overrides this call with its own rejection.
    if (path.endsWith("/whatsapp/send-pdf") && method === "POST") {
      if (responses.sendFailureMessage) {
        /*
         * An ApiError, not a bare Error. `userFacingMessage` shows the
         * backend's own sentence only for the former and a generic apology for
         * anything else — so a plain Error here would test the fallback path
         * while appearing to test the message.
         */
        return Promise.reject(
          new ApiError(
            "SERVICE_UNAVAILABLE",
            responses.sendFailureMessage,
            503,
          ),
        );
      }

      return Promise.resolve({
        delivered: true,
        driverName: responses.sentToDriverName ?? DRIVER.name,
        filename: "transport-order.pdf",
      });
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
      /*
       * `isAssignable` defaults to true, because an ordinary manual property is
       * what almost every fixture means and the real API says so for one. It is
       * the BACKEND's classification and the picker filters on it, so a spec
       * about a property the operator may NOT assign — Flat, Toll, Tunnel —
       * states `isAssignable: false` for itself.
       */
      return Promise.resolve(
        page(
          (responses.availableCustomProperties ?? []).map((property) => ({
            isAssignable: true,
            ...(property as Record<string, unknown>),
          })),
        ),
      );
    }

    if (path.startsWith("/api/v1/trip-custom-properties/trip/")) {
      return Promise.resolve({
        items: responses.assignedCustomProperties ?? [],
      });
    }

    // Assigning and removing a Custom Property.
    if (path.startsWith("/api/v1/trip-custom-properties")) {
      const body = options?.body as
        | { tripId?: string; customPropertyId?: string }
        | undefined;

      return Promise.resolve(
        responses.onCustomPropertyMutation?.({
          method,
          tripId: body?.tripId,
          customPropertyId: body?.customPropertyId,
          assignmentId:
            method === "DELETE"
              ? path.slice("/api/v1/trip-custom-properties/".length)
              : undefined,
        }) ?? {},
      );
    }

    if (path.includes("/reprocess")) {
      return Promise.resolve({});
    }

    /*
     * The two override endpoints, matched BEFORE the snapshot read below them:
     * both live under the same `/trip/{id}/` prefix, and the generic branch
     * would otherwise answer a correction with a snapshot.
     */
    if (path.includes("/overrides") && method !== "GET") {
      if (responses.pricingOverrideFailureMessage) {
        return Promise.reject(
          new ApiError(
            "BAD_REQUEST",
            responses.pricingOverrideFailureMessage,
            400,
          ),
        );
      }

      const [, tripId] = path.match(/\/trip\/([^/]+)\/overrides/) ?? [];
      const body = options?.body as
        | { componentCode: string; amount: number }
        | undefined;
      const componentCode =
        body?.componentCode ?? path.split("/overrides/")[1] ?? "";

      return Promise.resolve(
        responses.onPricingOverride?.({
          tripId: tripId ?? "",
          componentCode,
          amount: body?.amount ?? null,
        }) ?? null,
      );
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
      const [, tripId] = path.match(/^\/api\/v1\/trips\/([^/]+)/) ?? [];

      return Promise.resolve(
        responses.onTripUpdate?.({
          tripId: tripId ?? "",
          body: (options?.body ?? {}) as Record<string, unknown>,
        }) ?? buildTrip(),
      );
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

/**
 * The Ritten page, in a chosen language and theme.
 *
 * Both providers read the real sources — localStorage for the language, the
 * `dark` class the pre-paint script applies for the theme — so seeding those is
 * how a spec chooses. Setting provider props instead would test a code path the
 * application never takes.
 */
export function renderRitten({
  language,
  theme,
}: { language?: "nl" | "tr"; theme?: "light" | "dark" } = {}) {
  /*
   * Only when the caller ASKS. Older specs set `tms.language` themselves before
   * rendering, and defaulting either of these would silently overwrite that —
   * which it did, turning every Turkish assertion in the suite Dutch.
   */
  if (language) {
    window.localStorage.setItem("tms.language", language);
  }

  if (theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <RittenPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}
