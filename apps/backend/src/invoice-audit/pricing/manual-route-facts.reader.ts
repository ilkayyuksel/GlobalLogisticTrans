import { Injectable } from "@nestjs/common";
import { RouteSelectionSource } from "@prisma/client";

import { pricingPartnerOf } from "../../pricing-engine/combination-leg";
import {
  EffectivePricingService,
  type CurrentTripPricing,
} from "../../trip-pricing/effective-pricing.service";
import {
  InvoiceAuditReadRepository,
  type RouteChoiceMember,
} from "../invoice-audit-read.repository";

/** The partner leg of a Trip priced on a chosen Combination, as stored now. */
export interface ManualPartnerFacts {
  readonly tripId: string;
  /** The route choice stored for the partner now; null when none. */
  readonly currentChoice: string | null;
  /** The partner's stored pricing; null when it has no current price. */
  readonly pricing: CurrentTripPricing | null;
}

/** What is stored NOW about a Trip whose snapshot was priced on a route choice. */
export interface ManualRouteFacts {
  /** The route choice stored for the Trip now; null when none. */
  readonly currentChoice: string | null;
  /** Its pricing partner now (`pricingPartnerOf`); null when it has none. */
  readonly partner: ManualPartnerFacts | null;
}

/**
 * The stored facts that confirm — or contradict — a price made on a route an
 * operator chose — see `price-reliability.ts`.
 *
 * ── READ, NEVER DECIDED ─────────────────────────────────────────────────────
 * The choice as `trip_route_selection` holds it now, and the partner leg by
 * the same rule pricing uses (`pricingPartnerOf`), with its stored price.
 * Nothing is matched or priced. A choice a later reprocess removed is absent
 * here, so a snapshot still claiming it is never trusted on its word.
 *
 * Only for Trips whose snapshot says MANUAL; a fixed number of queries for the
 * whole document.
 */
@Injectable()
export class ManualRouteFactsReader {
  constructor(
    private readonly reads: InvoiceAuditReadRepository,
    private readonly effectivePricing: EffectivePricingService,
  ) {}

  async findForTrips(
    trips: readonly { readonly id: string; readonly tripGroupId: string | null }[],
    pricingByTrip: ReadonlyMap<string, CurrentTripPricing>,
  ): Promise<ReadonlyMap<string, ManualRouteFacts>> {
    const manual = trips.filter(
      (trip) => pricingByTrip.get(trip.id)?.routeMatch.selection === RouteSelectionSource.MANUAL,
    );

    if (manual.length === 0) {
      return new Map();
    }

    const members = await this.reads.findRouteChoiceMembers(
      manual.map((trip) => trip.id),
      [...new Set(manual.flatMap((trip) => (trip.tripGroupId ? [trip.tripGroupId] : [])))],
    );
    const partners = partnersOf(manual, members);
    const unread = [...new Set([...partners.values()].map((partner) => partner.id))].filter(
      (id) => !pricingByTrip.has(id),
    );
    const partnerPricing = await this.effectivePricing.findForTrips(unread);
    const pricingOf = (id: string) => pricingByTrip.get(id) ?? partnerPricing.get(id) ?? null;
    const choiceOf = new Map(members.map((member) => [member.id, member.currentChoice]));

    return new Map(
      manual.map((trip) => {
        const partner = partners.get(trip.id);

        return [
          trip.id,
          {
            currentChoice: choiceOf.get(trip.id) ?? null,
            partner: partner
              ? { tripId: partner.id, currentChoice: partner.currentChoice, pricing: pricingOf(partner.id) }
              : null,
          },
        ];
      }),
    );
  }
}

/** Each grouped Trip's pricing partner, by the rule pricing itself uses. */
function partnersOf(
  trips: readonly { readonly id: string }[],
  members: readonly RouteChoiceMember[],
): Map<string, RouteChoiceMember> {
  const partners = new Map<string, RouteChoiceMember>();

  for (const trip of trips) {
    const own = members.find((member) => member.id === trip.id);

    if (!own?.tripGroupId) {
      continue;
    }

    const pairing = pricingPartnerOf(
      own,
      members.filter((member) => member.tripGroupId === own.tripGroupId),
    );

    if (pairing.kind === "PAIRED") {
      partners.set(trip.id, pairing.partner);
    }
  }

  return partners;
}
