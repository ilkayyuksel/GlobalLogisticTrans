import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripRepository, type FindTripsFilter } from "./trip.repository";

/**
 * The Ritten list's "Route nakijken" filter — the real `findPage` query against
 * a REAL database.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. Every test uses its own day, so tests never see each other's Trips.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("the route-attention filter against a real database", () => {
  let client: PrismaClient;
  let trips: TripRepository;
  let day: Date;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    trips = new TripRepository(client as unknown as PrismaService);
    day = new Date(Date.UTC(2032, 0, 1 + Math.floor(Math.random() * 3000)));
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  async function aRoute(reviewed: boolean, combinationGroupId: string | null = null, position: number | null = null) {
    return (
      await client.routePricing.create({
        data: {
          routeName: `R ${unique()}`,
          departure: "Quay 869",
          destination: `CITY ${unique()}`,
          basePrice: "100.00",
          reviewed,
          combinationGroupId,
          combinationLegPosition: position,
        },
      })
    ).id;
  }

  /** A Combination: its own mark, and legs with marks of their own that must not count. */
  async function aCombination(reviewed: boolean, legsReviewed: boolean) {
    const group = await client.combinationRouteGroup.create({ data: { reviewed } });
    const leg1 = await aRoute(legsReviewed, group.id, 1);
    await aRoute(legsReviewed, group.id, 2);

    return { groupId: group.id, legId: leg1 };
  }

  /** A Trip on this test's day with a stored snapshot shaped by `pricing`. */
  async function aTrip(
    label: string,
    pricing: {
      routePricingId?: string | null;
      routeMatch?: "EXACT" | "NOT_FOUND" | "AMBIGUOUS" | null;
      combinationRouteGroupId?: string | null;
      routeSelection?: "AUTOMATIC" | "MANUAL";
      calculationStatus?: "CALCULATED" | "FAILED";
    } | null,
    status: "CLOSED" | "OPEN" = "CLOSED",
  ): Promise<string> {
    const trip = await client.trip.create({
      data: { bookingNumber: `${label}-${unique()}`, status, planningDate: day, containerNumber: label },
    });

    if (pricing !== null) {
      await client.tripPricing.create({
        data: {
          tripId: trip.id,
          totalPrice: "100.00",
          calculatedAt: new Date(),
          pricingEngineVersion: "1.0.0",
          pricingRuleVersion: "test",
          calculationStatus: pricing.calculationStatus ?? "CALCULATED",
          routePricingId: pricing.routePricingId ?? null,
          routeMatch: pricing.routeMatch === undefined ? "EXACT" : pricing.routeMatch,
          combinationRouteGroupId: pricing.combinationRouteGroupId ?? null,
          routeSelection: pricing.routeSelection ?? "AUTOMATIC",
        },
      });
    }

    return trip.id;
  }

  async function listed(extra: Partial<FindTripsFilter> = {}) {
    const { items, totalItems } = await trips.findPage({
      planningDate: day,
      needsRouteAttention: true,
      skip: 0,
      take: 100,
      ...extra,
    });

    return { ids: items.map((trip) => trip.id).sort(), totalItems };
  }

  it("lists a Trip that matched no usable route, NOT_FOUND or AMBIGUOUS", async () => {
    const notFound = await aTrip("NOT-FOUND", { routePricingId: null, routeMatch: "NOT_FOUND" });
    const ambiguous = await aTrip("AMBIGUOUS", { routePricingId: null, routeMatch: "AMBIGUOUS" });

    expect((await listed()).ids).toEqual([notFound, ambiguous].sort());
  });

  it("lists a Trip priced on an unchecked ordinary route, never one on a checked route", async () => {
    const unchecked = await aTrip("UNCHECKED", { routePricingId: await aRoute(false) });
    await aTrip("CHECKED", { routePricingId: await aRoute(true) });

    expect((await listed()).ids).toEqual([unchecked]);
  });

  it("judges a Combination by its own mark, never a leg's", async () => {
    const groupUnchecked = await aCombination(false, true);
    const groupChecked = await aCombination(true, false);
    const listedTrip = await aTrip("COMBI-UNCHECKED", {
      routePricingId: groupUnchecked.legId,
      combinationRouteGroupId: groupUnchecked.groupId,
    });
    await aTrip("COMBI-CHECKED", {
      routePricingId: groupChecked.legId,
      combinationRouteGroupId: groupChecked.groupId,
    });

    expect((await listed()).ids).toEqual([listedTrip]);
  });

  it("treats a route an operator chose as a route: listed only while its price is unchecked", async () => {
    const chosenUnchecked = await aTrip("MANUAL-UNCHECKED", {
      routePricingId: await aRoute(false),
      routeMatch: "NOT_FOUND",
      routeSelection: "MANUAL",
    });
    await aTrip("MANUAL-CHECKED", {
      routePricingId: await aRoute(true),
      routeMatch: "NOT_FOUND",
      routeSelection: "MANUAL",
    });

    expect((await listed()).ids).toEqual([chosenUnchecked]);
  });

  it("lists a Trip once however many reasons hold, and counts it once", async () => {
    // Unchecked as a route AND as a Combination: both conditions of the OR.
    const group = await aCombination(false, false);
    const trip = await aTrip("BOTH", { routePricingId: group.legId, combinationRouteGroupId: group.groupId });

    expect(await listed()).toEqual({ ids: [trip], totalItems: 1 });
  });

  it("never reads an old, failed or missing price as a missing route", async () => {
    await aTrip("FAILED", { routePricingId: null, routeMatch: "NOT_FOUND", calculationStatus: "FAILED" });
    await aTrip("REOPENED", { routePricingId: null, routeMatch: "NOT_FOUND" }, "OPEN");
    await aTrip("NEVER-PRICED", null);
    await aTrip("UNRECORDED", { routePricingId: null, routeMatch: null });

    expect((await listed()).ids).toEqual([]);
  });

  it("combines with the search, and pages and counts the filtered set", async () => {
    const first = await aTrip("ALPHA-1", { routePricingId: null, routeMatch: "NOT_FOUND" });
    const second = await aTrip("ALPHA-2", { routePricingId: await aRoute(false) });
    await aTrip("BETA", { routePricingId: null, routeMatch: "NOT_FOUND" });
    await aTrip("ALPHA-3", { routePricingId: await aRoute(true) });

    const searched = await listed({ search: "alpha" });
    expect(searched).toEqual({ ids: [first, second].sort(), totalItems: 2 });

    const pageOne = await listed({ search: "alpha", take: 1 });
    const pageTwo = await listed({ search: "alpha", skip: 1, take: 1 });
    expect(pageOne.totalItems).toBe(2);
    expect([...pageOne.ids, ...pageTwo.ids].sort()).toEqual([first, second].sort());
  });

  it("changes nothing when it is off", async () => {
    const matched = await aTrip("OFF", { routePricingId: await aRoute(true) });
    const unmatched = await aTrip("OFF-2", { routePricingId: null, routeMatch: "NOT_FOUND" });

    expect((await listed({ needsRouteAttention: false })).ids).toEqual([matched, unmatched].sort());
    expect((await listed({ needsRouteAttention: undefined })).ids).toEqual([matched, unmatched].sort());
  });
});
