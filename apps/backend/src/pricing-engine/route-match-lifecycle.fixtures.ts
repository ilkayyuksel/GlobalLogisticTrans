import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import {
  CONFIGURED_TERMINAL,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";

/**
 * One configured Combination, its two Trips and the actions that price them —
 * shared by the route-match lifecycle specs.
 *
 * ── THE COMBINATION ─────────────────────────────────────────────────────────
 *   Leg 1  delivery    PSA Quay 869 → Ghlin     Tarief 150.00
 *   Leg 2  collection  Mons → PSA Quay 869      Tarief 120.00
 *   Over ST            Tarief 40.00, Toll 10.00, Tunnel not configured
 *   Over ST surcharge  70.00, once on Leg 2's Tarief
 *
 * Leg 2 on another day than Leg 1:
 *   Tarief 120 + 40 + 70 = 230.00, Brandstof 34.50, Backload 50.00,
 *   Toll 10.00 → Totaal 324.50
 * Leg 2 on the same day:
 *   Tarief 120.00, Brandstof 18.00, Backload 50.00 → Totaal 188.00
 * ────────────────────────────────────────────────────────────────────────────
 */

export const LEG1 = "leg-1";
export const LEG2 = "leg-2";
export const DOCUMENT = "pdf-combination";
export const GROUP = "group-combination";
export const COMBINATION_ID = "combination-1";
export const LEG1_ROW = "combination-leg-1";
export const LEG2_ROW = "combination-leg-2";
export const DAY_ONE = "2026-08-31";
export const DAY_TWO = "2026-09-01";

export const WITH_OVER_ST = {
  tarief: "230.00",
  brandstof: "34.50",
  backload: "50.00",
  tol: "10.00",
  tunnel: "0.00",
  totaal: "324.50",
};

export const WITHOUT_OVER_ST = {
  tarief: "120.00",
  brandstof: "18.00",
  backload: "50.00",
  tol: "0.00",
  totaal: "188.00",
};

const SURCHARGE_DESCRIPTION = "Over ST toeslag";

export function routeMatchActions(world: PricingLifecycle) {
  const close = (tripId: string) =>
    world.tripService.changeStatus(tripId, { status: TripStatus.CLOSED });
  const reopen = (tripId: string) =>
    world.tripService.changeStatus(tripId, { status: TripStatus.OPEN });
  const apiPricing = async (tripId: string) => (await world.readTrip(tripId)).pricing;

  return {
    close,
    reopen,
    /** The Ritten row's pricing, as GET /trips answers it. */
    apiPricing,
    moveTo: (tripId: string, planningDate: string) =>
      world.tripService.update(tripId, { planningDate }),

    /** The stored header's route record. */
    trace(tripId: string) {
      const snapshot = world.storedSnapshot(tripId);

      return { routePricingId: snapshot?.routePricingId, routeMatch: snapshot?.routeMatch };
    },

    surcharges(tripId: string) {
      return (world.storedSnapshot(tripId)?.items ?? []).filter(
        (item) => item.description === SURCHARGE_DESCRIPTION,
      );
    },

    /** The stored total equals its items, and the API's Totaal equals it. */
    async expectConsistent(tripId: string): Promise<void> {
      const snapshot = world.storedSnapshot(tripId)!;
      const itemSum = snapshot.items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );

      expect(snapshot.totalPrice.toFixed(2)).toBe(itemSum.toFixed(2));
      expect((await apiPricing(tripId))!.totaal).toBe(snapshot.totalPrice.toFixed(2));
    },

    configureCombination(): void {
      world.combinations.push({
        id: COMBINATION_ID,
        legs: [
          {
            id: LEG1_ROW,
            departure: CONFIGURED_TERMINAL,
            destination: "Ghlin",
            basePrice: "150.00",
            combinationLegPosition: 1,
          },
          {
            id: LEG2_ROW,
            departure: "Mons",
            destination: CONFIGURED_TERMINAL,
            basePrice: "120.00",
            combinationLegPosition: 2,
          },
        ],
        overSt: { tarief: "40.00", toll: "10.00", tunnel: null },
      });
    },

    /** Both legs of one document, OPEN, grouped unless `groupId` is null. */
    seedLegs(leg2Day = DAY_TWO, groupId: string | null = GROUP): void {
      world.seed(
        buildTrip(LEG1, {
          pdfDocumentId: DOCUMENT,
          tripGroupId: groupId,
          direction: TripDirection.DELIVERY,
          planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
        }),
      );
      world.seed(
        buildTrip(LEG2, {
          pdfDocumentId: DOCUMENT,
          tripGroupId: groupId,
          direction: TripDirection.COLLECTION,
          destinationCity: "Mons",
          planningDate: new Date(`${leg2Day}T00:00:00Z`),
        }),
      );
    },

    /** The configured Combination, both legs grouped and CLOSED. */
    async closedCombination(leg2Day = DAY_TWO): Promise<void> {
      this.configureCombination();
      this.seedLegs(leg2Day);
      await close(LEG1);
      await close(LEG2);
    },
  };
}
