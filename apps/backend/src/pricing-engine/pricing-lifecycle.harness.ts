import {
  CostConfirmation,
  Prisma,
  PricingCalculationStatus,
  RouteMatchMethod,
  Trip,
  TripStatus,
} from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { SettingsService } from "../settings/settings.service";
import { TripExportLabelsService } from "../trip-export/trip-export-labels.service";
import { TripCustomPropertyService } from "../trip-custom-properties/trip-custom-property.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { hasCurrentPrice } from "../trip-pricing/current-pricing";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { AutomaticFlatPropertyService } from "../trips/automatic-flat.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripReadService } from "../trips/trip-read.service";
import { TripRepository } from "../trips/trip.repository";
import { TripService } from "../trips/trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CostConfirmationCalculator } from "./cost-confirmation.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import { PairedPricingService } from "./paired-pricing.service";
import { ManualRouteSelectionService } from "./manual-route-selection.service";
import { TripRouteSelectionRepository } from "../trip-route-selection/trip-route-selection.repository";
import { PricingRecalculationService } from "./pricing-recalculation.service";
import {
  TarChargeReadRepository,
  canHoldTarCharge,
  type TarChargeQuery,
  type TarDay,
} from "./tar-charge-read.repository";
import { isHeldByAnother, type TarHolder } from "./tar-charge-holders";
import { TarChargeSettlement } from "./tar-charge-settlement";
import { AutomaticTarAlreadyChargedException, TarChargeGuard } from "./tar-charge-guard";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingStrategy } from "./pricing-settings";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { RouteCostResolver } from "./route-cost.resolver";
import { TollCalculator } from "./toll.calculator";
import { TripClosedPricingListener } from "./trip-closed-pricing.listener";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";
import { noDriverPinning } from "../trips/trip-driver-pinning.double";
import { NO_REVIEW_STATUS, type RouteReviewRepository } from "../trip-pricing/route-review.repository";

/**
 * The whole pricing lifecycle of a Trip, wired from the real services.
 *
 * Not a test file — a shared harness, in the spirit of
 * `real-documents.harness.ts`.
 *
 * ── WHAT IS REAL ────────────────────────────────────────────────────────────
 * Every service that decides or stores money: the Engine and its eight
 * calculators, the component resolver, the snapshot writer and store, the
 * effective-pricing read, the recalculation service, the close listener on the
 * real event bus, and the services an operator's actions go through —
 * `TripService`, `TripCustomPropertyService`, `CostConfirmationService` — plus
 * `TripPlanningDataService`, which is what puts pricing on an API response.
 *
 * ── WHAT IS IN MEMORY ───────────────────────────────────────────────────────
 * Only the tables. A test can therefore assert the stored snapshot, its items
 * and the API response for the same Trip, which is the whole point: a figure
 * that is right in one and wrong in another is the bug class this exists for.
 *
 * Route configuration is deliberately trivial — one configured road — because
 * route matching is out of scope here and is exercised by its own specs.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const CONFIGURED_TERMINAL = "PSA Quay 869";
export const CONFIGURED_DESTINATION = "Ghlin";
export const CONFIGURED_ROUTE_ID = "route-1";
export const CONFIGURED_BASE_PRICE = "200.00";

const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

const RULES = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "50.00",
  overStSurcharge: "70.00",
  automaticCustomPropertyId: TAR_ID,
  waitingTimeFreeMinutes: 120,
  waitingTimeThresholdMinutes: 150,
  waitingTimeBlockMinutes: 15,
  waitingTimeBlockPrice: "13.75",
  ruleVersion: "2026.1",
};

function catalogEntry(id: string, name: string, price: string | null) {
  return {
    id,
    name,
    description: null,
    pricingComponentId: null,
    defaultPrice: price === null ? null : new Prisma.Decimal(price),
    displayOrder: 0,
    color: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

/**
 * The Custom Values an operator can assign. One deliberately has no price, and
 * one is explicitly priced at zero — two different things.
 */
export const PROPERTIES = {
  genset: catalogEntry("property-genset", "Genset", "35.00"),
  douane: catalogEntry("property-douane", "Douane", "12.50"),
  unpriced: catalogEntry("property-unpriced", "Label zonder prijs", null),
  tar: catalogEntry(TAR_ID, "TAR", "20.00"),
  flat: catalogEntry("property-flat", "Flat", "45.00"),
  free: catalogEntry("property-free", "Gratis", "0.00"),
};

type CatalogEntry = (typeof PROPERTIES)[keyof typeof PROPERTIES];

export function buildTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    pdfDocumentId: `pdf-${id}`,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction: null,
    bookingNumber: `ANRDUB-${id}`,
    containerNumber: null,
    containerType: "45PH",
    terminal: CONFIGURED_TERMINAL,
    destinationCity: CONFIGURED_DESTINATION,
    destinationCountry: "Belgium",
    originalPlanningDate: new Date("2026-08-31T00:00:00Z"),
    planningDate: new Date("2026-08-31T00:00:00Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  } as Trip;
}

export interface StoredItem {
  id: string;
  tripPricingId: string;
  pricingComponentId: string;
  pricingComponent: { code: string };
  customPropertyId: string | null;
  description: string;
  amount: Prisma.Decimal;
  calculationOrder: number;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  /** The Engine's own automatic TAR, as opposed to an operator's manual one. */
  isAutomatic: boolean;
}

const COMPONENT_PREFIX = "component-";

export interface StoredRouteLeg {
  tripPricingId: string;
  legPosition: number | null;
  isPricedLeg: boolean;
  routePricingId: string;
  departure: string;
  destination: string;
  matchMethod: RouteMatchMethod;
}

/** The fields of a configured route that pricing reads. */
export interface ConfiguredRoute {
  id: string;
  departure: string;
  destination: string;
  basePrice: string;
  combinationLegPosition?: number;
}

/** A configured Combination: two legs, outbound first, and its Over ST. */
export interface ConfiguredCombination {
  id: string;
  legs: [ConfiguredRoute, ConfiguredRoute];
  overSt: { tarief: string | null; toll: string | null; tunnel: string | null };
}

const silentLogger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as AppLoggerService;

export function buildPricingLifecycle() {
  const trips = new Map<string, Trip>();
  const assignments: {
    id: string;
    tripId: string;
    customPropertyId: string;
    isAutomatic: boolean;
    createdAt: Date;
    customProperty: CatalogEntry;
  }[] = [];
  const costConfirmations: CostConfirmation[] = [];
  const snapshots: Prisma.TripPricingGetPayload<object>[] = [];
  const items: StoredItem[] = [];
  const routeLegs = new Map<string, StoredRouteLeg[]>();
  const routeLegsOf = (tripPricingId: string) =>
    [...(routeLegs.get(tripPricingId) ?? [])].sort(
      (left, right) => (left.legPosition ?? 0) - (right.legPosition ?? 0),
    );
  let groupCount = 0;
  const logger = silentLogger();
  /*
   * The route configuration, as the configuration screens would leave it. One
   * ordinary route unless a test configures more; matched by the REAL matcher.
   */
  const ordinaryRoutes: ConfiguredRoute[] = [
    {
      id: CONFIGURED_ROUTE_ID,
      departure: CONFIGURED_TERMINAL,
      destination: CONFIGURED_DESTINATION,
      basePrice: CONFIGURED_BASE_PRICE,
    },
  ];
  const combinations: ConfiguredCombination[] = [];

  const requireTrip = (id: string) => trips.get(id) ?? null;
  const tripsInGroup = (groupId: string) =>
    [...trips.values()].filter((trip) => trip.tripGroupId === groupId);

  /* ── the operators' route choices (trip_route_selection) ─────────────────── */
  const routeChoices = new Map<string, string>();
  const combinationOfLeg = (routePricingId: string) =>
    combinations.find((each) => each.legs.some((leg) => leg.id === routePricingId))?.id ?? null;
  /** As the real repository: replaced together, removed with the partner leg's. */
  const routeChoiceRepository = {
    replace: jest.fn((choices: readonly { tripId: string; routePricingId: string }[]) => {
      for (const choice of choices) {
        routeChoices.set(choice.tripId, choice.routePricingId);
      }
      return Promise.resolve();
    }),
    clearForTrips: jest.fn((tripIds: readonly string[]) => {
      const pairs = tripIds.flatMap((id) => {
        const chosen = routeChoices.get(id);
        const tripGroupId = requireTrip(id)?.tripGroupId ?? null;
        const combination = chosen ? combinationOfLeg(chosen) : null;
        return tripGroupId && combination ? [{ tripGroupId, combination }] : [];
      });
      let removed = 0;
      for (const [tripId, routePricingId] of [...routeChoices]) {
        const ofPair = pairs.some(
          (pair) =>
            requireTrip(tripId)?.tripGroupId === pair.tripGroupId &&
            combinationOfLeg(routePricingId) === pair.combination,
        );
        if (tripIds.includes(tripId) || ofPair) {
          routeChoices.delete(tripId);
          removed += 1;
        }
      }
      return Promise.resolve(removed);
    }),
  };
  /** A Trip row as the read side loads it: with its route choice. */
  const withRouteChoice = (trip: Trip | null) =>
    trip && {
      ...trip,
      routeSelection: routeChoices.has(trip.id) ? { routePricingId: routeChoices.get(trip.id) } : null,
    };

  /* ── the Trip table ─────────────────────────────────────────────────────── */
  const tripRepository = {
    findById: jest.fn((id: string) => Promise.resolve(requireTrip(id))),
    findManyByIds: jest.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map(requireTrip).filter((trip): trip is Trip => !!trip)),
    ),
    findManyByGroupId: jest.fn((groupId: string) =>
      Promise.resolve(tripsInGroup(groupId)),
    ),
    clearRouteSelections: jest.fn((ids: readonly string[]) => routeChoiceRepository.clearForTrips(ids)),
    update: jest.fn(async (id: string, data: Record<string, unknown>) => {
      if (data.tripGroupId !== undefined) {
        await routeChoiceRepository.clearForTrips([id]);
      }
      const defined = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );
      const updated = { ...(requireTrip(id) as Trip), ...defined } as Trip;
      trips.set(id, updated);
      return updated;
    }),
    setStatus: jest.fn(async (id: string, status: TripStatus) => {
      if (status === TripStatus.OPEN || status === TripStatus.CLOSED) {
        await routeChoiceRepository.clearForTrips([id]);
      }
      const updated = { ...(requireTrip(id) as Trip), status };
      trips.set(id, updated);
      return updated;
    }),
    createTripGroup: jest.fn(() => {
      groupCount += 1;
      return Promise.resolve({ id: `group-${groupCount}` });
    }),
    assignToGroup: jest.fn(async (ids: readonly string[], tripGroupId: string) => {
      await routeChoiceRepository.clearForTrips(ids);
      for (const id of ids) {
        trips.set(id, { ...(requireTrip(id) as Trip), tripGroupId });
      }
      return ids.length;
    }),
    findCustomPropertiesForTrips: jest.fn((ids: readonly string[]) =>
      Promise.resolve(assignments.filter((row) => ids.includes(row.tripId))),
    ),
    findAppliedUpdateHistory: jest.fn().mockResolvedValue([]),
    /** Another Trip holding the same identity, as reopening checks. */
    findByIdentity: jest.fn(
      ({
        identity,
        statuses,
        excludeTripId,
      }: {
        identity: { bookingNumber: string; containerNumber: string | null };
        statuses: readonly TripStatus[];
        excludeTripId?: string;
      }) =>
        Promise.resolve(
          [...trips.values()].find(
            (trip) =>
              trip.id !== excludeTripId &&
              trip.bookingNumber === identity.bookingNumber &&
              trip.containerNumber === identity.containerNumber &&
              statuses.includes(trip.status),
          ) ?? null,
        ),
    ),
    /** Another Trip with this booking and container on this planning day, as an edit checks. */
    findByBookingOnPlanningDate: jest.fn(
      (query: {
        bookingNumber: string;
        containerNumber: string | null;
        planningDate: Date | null;
        statuses: readonly TripStatus[];
        excludeTripId: string;
      }) =>
        Promise.resolve(
          [...trips.values()].find(
            (trip) =>
              trip.id !== query.excludeTripId &&
              trip.bookingNumber === query.bookingNumber &&
              trip.containerNumber === query.containerNumber &&
              trip.planningDate?.getTime() === query.planningDate?.getTime() &&
              query.statuses.includes(trip.status),
          ) ?? null,
        ),
    ),
    runInTransaction: jest.fn(),
  };
  tripRepository.runInTransaction.mockImplementation(
    (work: (repository: unknown) => unknown) => work(tripRepository),
  );

  const tripRead = new TripReadService({
    findById: (id: string) => Promise.resolve(withRouteChoice(requireTrip(id))),
    findByGroupId: (groupId: string) => Promise.resolve(tripsInGroup(groupId).map(withRouteChoice)),
  } as never);

  /* ── the pricing tables ─────────────────────────────────────────────────── */
  const pricingRepository = {
    findById: jest.fn((id: string) =>
      Promise.resolve(snapshots.find((row) => row.id === id) ?? null),
    ),
    findByTripId: jest.fn((tripId: string) =>
      Promise.resolve(snapshots.find((row) => row.tripId === tripId) ?? null),
    ),
    /** CLOSED Trips and no FAILED snapshot, exactly as the real query filters. */
    findCurrentByTripIds: jest.fn((tripIds: readonly string[]) =>
      Promise.resolve(
        snapshots
          .filter(
            (row) =>
              tripIds.includes(row.tripId) &&
              isCurrent(row.tripId) &&
              row.calculationStatus !== PricingCalculationStatus.FAILED,
          )
          .map((row) => ({
            ...row,
            items: itemsOf(row.id),
            routeLegs: routeLegsOf(row.id),
          })),
      ),
    ),
    findCurrentByTripId: jest.fn((tripId: string) =>
      Promise.resolve(
        snapshots.find(
          (row) =>
            row.tripId === tripId &&
            isCurrent(tripId) &&
            row.calculationStatus !== PricingCalculationStatus.FAILED,
        ) ?? null,
      ),
    ),
    /** As the real conditional UPDATE: older, not yet FAILED snapshots only. */
    markFailed: jest.fn((tripIds: readonly string[], calculationStartedAt: Date) => {
      const marked = snapshots.filter(
        (row) =>
          tripIds.includes(row.tripId) &&
          row.calculatedAt.getTime() < calculationStartedAt.getTime() &&
          row.calculationStatus !== PricingCalculationStatus.FAILED,
      );
      for (const row of marked) {
        row.calculationStatus = PricingCalculationStatus.FAILED;
      }
      return Promise.resolve(marked.length);
    }),
    create: jest.fn((data: Record<string, unknown>) => {
      const row = {
        id: `pricing-${snapshots.length + 1}`,
        currency: "EUR",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as Prisma.TripPricingGetPayload<object>;
      snapshots.push(row);
      return Promise.resolve(row);
    }),
    updateUnlessNewerStored: jest.fn(
      (id: string, data: Record<string, unknown> & { calculatedAt: Date }) => {
        const row = snapshots.find((candidate) => candidate.id === id);
        if (!row || row.calculatedAt.getTime() > data.calculatedAt.getTime()) {
          return Promise.resolve(null);
        }
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    ),
    replaceRouteLegs: jest.fn(
      (tripPricingId: string, legs: readonly Record<string, unknown>[]) => {
        routeLegs.set(
          tripPricingId,
          legs.map((leg) => ({ ...leg, tripPricingId }) as StoredRouteLeg),
        );
        return Promise.resolve();
      },
    ),
    runInTransaction: jest.fn(),
  };
  const itemRepository = {
    findByTripPricingId: jest.fn((id: string) => Promise.resolve(itemsOf(id))),
    findById: jest.fn((id: string) =>
      Promise.resolve(items.find((row) => row.id === id) ?? null),
    ),
    findPricingComponentsByCodes: jest.fn((codes: readonly string[]) =>
      Promise.resolve(
        codes.map((code) => ({ id: `${COMPONENT_PREFIX}${code}`, code })),
      ),
    ),
    createMany: jest.fn((rows: Omit<StoredItem, "id" | "pricingComponent">[]) => {
      for (const row of rows) {
        items.push({
          ...row,
          id: `item-${items.length + 1}`,
          pricingComponent: {
            code: row.pricingComponentId.slice(COMPONENT_PREFIX.length),
          },
        });
      }
      return Promise.resolve({ count: rows.length });
    }),
    deleteByTripPricingId: jest.fn((tripPricingId: string) => {
      const kept = items.filter((row) => row.tripPricingId !== tripPricingId);
      const count = items.length - kept.length;
      items.splice(0, items.length, ...kept);
      return Promise.resolve({ count });
    }),
  };
  pricingRepository.runInTransaction.mockImplementation(
    (work: (repositories: unknown) => unknown) =>
      // No database here: the TAR guard below reads the tables directly.
      work({ pricing: pricingRepository, items: itemRepository, transaction: undefined }),
  );

  function isCurrent(tripId: string): boolean {
    const trip = requireTrip(tripId);
    return trip !== null && hasCurrentPrice(trip.status);
  }

  function itemsOf(tripPricingId: string): StoredItem[] {
    return items
      .filter((row) => row.tripPricingId === tripPricingId)
      .sort((left, right) => left.calculationOrder - right.calculationOrder);
  }

  const tripPricing = new TripPricingService(
    pricingRepository as never,
    tripRead,
    logger,
  );
  const effectivePricing = new EffectivePricingService(
    {
      findForTrip: () => Promise.resolve([]),
      findForTrips: () => Promise.resolve([]),
    } as never,
    pricingRepository as never,
    { findReviewStatus: async () => NO_REVIEW_STATUS } as unknown as RouteReviewRepository,
  );

  /* ── the Engine ─────────────────────────────────────────────────────────── */
  const ruleResolver = {
    resolve: jest.fn().mockResolvedValue(RULES),
  } as unknown as PricingRuleResolver;
  const toPropertyView = (property: CatalogEntry) => ({
    ...property,
    defaultPrice: property.defaultPrice?.toFixed(2) ?? null,
  });
  const customPropertyCatalog = {
    findById: jest.fn((id: string) =>
      Promise.resolve(
        toPropertyView(
          Object.values(PROPERTIES).find((property) => property.id === id)!,
        ),
      ),
    ),
  } as unknown as CustomPropertyService;
  const routePricingService = {
    // Read afresh on every calculation, as the real table is.
    findAllOrdinary: () => Promise.resolve(ordinaryRoutes.map((route) => ({ ...route }))),
  } as unknown as RoutePricingService;
  const combinationPricingService = {
    findAll: () => Promise.resolve(combinations.map((group) => ({ ...group }))),
  } as unknown as CombinationRoutePricingService;
  /**
   * The TAR reads over the tables above, exactly as the real queries select:
   * automatic TAR lines of snapshots not FAILED, of Trips not CANCELLED or
   * DELETED. Who holds the charge is the real rule (`tar-charge-holders.ts`).
   */
  const sameTar = (trip: Trip, day: TarDay) =>
    trip.planningDate?.getTime() === day.planningDate.getTime() &&
    trip.tarNummer?.trim().toLowerCase() === day.tarNummer.toLowerCase();
  const holdsAutomaticTar = (snapshot: Prisma.TripPricingGetPayload<object>) =>
    itemsOf(snapshot.id).some((item) => item.isAutomatic === true);
  const findHolders = (day: TarDay): TarHolder[] =>
    snapshots
      .filter((snapshot) => {
        const trip = trips.get(snapshot.tripId);

        return (
          !!trip &&
          canHoldTarCharge(trip.status) &&
          snapshot.calculationStatus !== PricingCalculationStatus.FAILED &&
          sameTar(trip, day) &&
          holdsAutomaticTar(snapshot)
        );
      })
      .map((snapshot) => ({
        tripId: snapshot.tripId,
        status: trips.get(snapshot.tripId)!.status,
        calculatedAt: snapshot.calculatedAt,
      }));
  const tarCharges = {
    hasBeenChargedToday: (query: TarChargeQuery) =>
      Promise.resolve(isHeldByAnother(findHolders(query), query.tripId)),
    findHolders: (day: TarDay) => Promise.resolve(findHolders(day)),
    findTripsHoldingAutomaticTar: (tripIds: readonly string[]) =>
      Promise.resolve(
        new Set(
          snapshots
            .filter((snapshot) => tripIds.includes(snapshot.tripId) && holdsAutomaticTar(snapshot))
            .map((snapshot) => snapshot.tripId),
        ),
      ),
    findClosedTripsStating: (day: TarDay, excludeTripId: string) =>
      Promise.resolve(
        [...trips.values()]
          .filter((trip) => trip.id !== excludeTripId && trip.status === TripStatus.CLOSED && sameTar(trip, day))
          .map((trip) => trip.id),
      ),
  };
  /** The write's own re-check of an automatic TAR — the real rule, without the lock. */
  const tarGuard = {
    assertStillFree: (_transaction: unknown, day: TarDay, tripId: string) =>
      isHeldByAnother(findHolders(day), tripId)
        ? Promise.reject(new AutomaticTarAlreadyChargedException(tripId))
        : Promise.resolve(),
  } as unknown as TarChargeGuard;
  const components = new PricingComponentResolver(
    routePricingService,
    combinationPricingService,
    new TripCustomPropertyReadService({
      findByTripId: (tripId: string) =>
        Promise.resolve(assignments.filter((row) => row.tripId === tripId)),
    } as never),
    customPropertyCatalog,
    tripRead,
    ruleResolver,
    tarCharges as unknown as TarChargeReadRepository,
    logger,
  );
  const ccRepository = {
    create: jest.fn((data: Record<string, unknown>) => {
      const row = {
        id: `cc-${costConfirmations.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        amount: new Prisma.Decimal(data.amount as string),
      } as CostConfirmation;
      costConfirmations.push(row);
      return Promise.resolve(row);
    }),
    findAllByTrip: jest.fn((tripId: string) =>
      Promise.resolve(costConfirmations.filter((row) => row.tripId === tripId)),
    ),
    findForTrips: jest.fn((tripIds: readonly string[]) =>
      Promise.resolve(
        costConfirmations.filter((row) => tripIds.includes(row.tripId)),
      ),
    ),
    /** Newest first, as the real query orders: the latest arrival leads. */
    findNumbersForTrips: jest.fn((tripIds: readonly string[]) =>
      Promise.resolve(
        [...costConfirmations]
          .reverse()
          .filter((row) => tripIds.includes(row.tripId))
          .map((row) => ({ tripId: row.tripId, ccNumber: row.ccNumber })),
      ),
    ),
  };
  const costConfirmationRead = new CostConfirmationReadService(ccRepository as never);
  const engine = new PricingEngineService(
    tripRead,
    ruleResolver,
    components,
    new RouteCostResolver(
      {
        findActiveForRoute: () => Promise.resolve([]),
        findActiveForRoutePricing: () => Promise.resolve([]),
      } as never,
      logger,
    ),
    new PricingSnapshotWriter(
      tripPricing,
      new TripPricingItemService(itemRepository as never, tripPricing, logger),
      tarGuard,
      logger,
    ),
    costConfirmationRead,
    [
      new BasePriceCalculator(logger),
      new CombinationSurchargeCalculator(logger),
      new FuelSurchargeCalculator(logger),
      new WaitingTimeCalculator(logger),
      new TollCalculator(logger),
      new TunnelCalculator(logger),
      new CustomPropertyCalculator(logger),
      new CostConfirmationCalculator(logger),
    ],
    logger,
  );
  const tarSettlement = new TarChargeSettlement(
    tarCharges as unknown as TarChargeReadRepository,
    tripRead,
    logger,
  );
  const pairs = new PairedPricingService(
    engine,
    tripRead,
    logger,
    routeChoiceRepository as unknown as TripRouteSelectionRepository,
    tarSettlement,
  );
  /** "Route kiezen": the real service over the same Engine, tables and choices. */
  const routeChoice = new ManualRouteSelectionService(
    tripRead,
    components,
    routePricingService,
    combinationPricingService,
    pairs,
    routeChoiceRepository as unknown as TripRouteSelectionRepository,
    logger,
  );
  const recalculation = new PricingRecalculationService(
    pairs,
    effectivePricing,
    tripRead,
    components,
    tarCharges as unknown as TarChargeReadRepository,
    logger,
  );
  const eventBus = new DomainEventBus(logger);
  new TripClosedPricingListener(eventBus, pairs, logger).onModuleInit();

  /* ── the services an operator's actions go through ──────────────────────── */
  const costConfirmationService = new CostConfirmationService(
    ccRepository as never,
    recalculation,
    logger,
  );
  const planningData = new TripPlanningDataService(
    { findManyByIds: () => Promise.resolve(new Map()) } as unknown as VehicleService,
    { findManyByIds: () => Promise.resolve(new Map()) } as unknown as DriverService,
    { findDriversForVehiclesOnDates: () => Promise.resolve(new Map()) } as never,
    tripRepository as unknown as TripRepository,
    costConfirmationService,
    effectivePricing,
  );
  const tripService = new TripService(
    tripRepository as unknown as TripRepository,
    {} as unknown as VehicleService,
    {} as unknown as DriverService,
    planningData,
    noDriverPinning(),
    { synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
    recalculation,
    eventBus,
    logger,
  );
  const customValues = new TripCustomPropertyService(
    {
      findById: (id: string) =>
        Promise.resolve(assignments.find((row) => row.id === id) ?? null),
      findByTripId: (tripId: string) =>
        Promise.resolve(assignments.filter((row) => row.tripId === tripId)),
      findByTripAndProperty: (tripId: string, customPropertyId: string) =>
        Promise.resolve(
          assignments.find(
            (row) =>
              row.tripId === tripId && row.customPropertyId === customPropertyId,
          ) ?? null,
        ),
      create: (data: { tripId: string; customPropertyId: string }) => {
        const row = {
          id: `assignment-${assignments.length + 1}`,
          tripId: data.tripId,
          customPropertyId: data.customPropertyId,
          isAutomatic: false,
          createdAt: new Date(),
          customProperty: Object.values(PROPERTIES).find(
            (property) => property.id === data.customPropertyId,
          )!,
        };
        assignments.push(row);
        return Promise.resolve(row);
      },
      delete: (id: string) => {
        const index = assignments.findIndex((row) => row.id === id);
        const [removed] = assignments.splice(index, 1);
        return Promise.resolve(removed);
      },
    } as never,
    tripService,
    customPropertyCatalog,
    recalculation,
    logger,
  );

  return {
    trips,
    /** The one logger every service shares, for asserting warnings. */
    logger: logger as unknown as { warn: jest.Mock; log: jest.Mock },
    /** Change these to change the configuration; nothing is repriced by it. */
    ordinaryRoutes,
    combinations,
    costConfirmations,
    snapshots,
    items,
    engine,
    /** The pricing rules every calculation reads; reject it to make one fail. */
    ruleResolver: ruleResolver as unknown as { resolve: jest.Mock },
    /** The read every screen, export and the invoice check share. */
    effectivePricing,
    /** Who must be priced again when a TAR charge moves. */
    tarSettlement,
    /** What every pricing trigger goes through: a Trip and its partner leg. */
    pairs,
    tripRead,
    /** The operators' route choices, by Trip id, and the repository over them. */
    routeChoices,
    routeChoiceRepository,
    routeChoice,
    tripPricing,
    tripService,
    customValues,
    costConfirmationService,
    /** The words both exports print, from the real labels service. */
    exportLabels: new TripExportLabelsService(
      tripService,
      tripPricing,
      {
        findOne: () => Promise.resolve({ value: TAR_ID }),
      } as unknown as SettingsService,
      costConfirmationRead,
      logger,
    ),
    /** Adds a Trip to the table, OPEN unless stated otherwise. */
    seed(trip: Trip): Trip {
      trips.set(trip.id, trip);
      return trip;
    },
    /**
     * The automatic Flat assignment the importer writes for a flat-rack
     * container (`AutomaticFlatPropertyService`) — an operator cannot assign
     * Flat by hand.
     */
    seedAutomaticFlat(tripId: string): void {
      assignments.push({
        id: `assignment-${assignments.length + 1}`,
        tripId,
        customPropertyId: PROPERTIES.flat.id,
        isAutomatic: true,
        createdAt: new Date(),
        customProperty: PROPERTIES.flat,
      });
    },
    /** The stored snapshot of a Trip, with its items and route legs, or null. */
    storedSnapshot(tripId: string) {
      const snapshot = snapshots.find((row) => row.tripId === tripId);
      return snapshot
        ? { ...snapshot, items: itemsOf(snapshot.id), routeLegs: routeLegsOf(snapshot.id) }
        : null;
    },
    /** What GET /trip-pricing/snapshots answers for one Trip, or null. */
    async snapshotResponse(tripId: string) {
      const [response] = await tripPricing.findManyByTripIds([tripId]);
      return response ?? null;
    },
    /** What GET /trips/:id would answer, read from the stored data. */
    readTrip: (tripId: string) => tripService.findById(tripId),
    /** A Cost Confirmation arriving for a Trip, through the real service. */
    confirmCost(tripId: string, ccNumber: string, amount: string) {
      return costConfirmationService.record({
        tripId,
        pdfDocumentId: `pdf-cc-${ccNumber}`,
        ccNumber,
        costCode: "WAIT",
        amount,
        currency: "EUR",
        receivedAt: new Date(),
      });
    },
  };
}

export type PricingLifecycle = ReturnType<typeof buildPricingLifecycle>;
