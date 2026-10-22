import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import type { CombinationMember } from "../pricing-engine/combination-leg";
import { PrismaService } from "../prisma/prisma.service";

/** One Cost Confirmation, as the invoice check compares an EC line with it. */
export interface InvoiceCostConfirmation {
  readonly tripId: string;
  /** Eucon's own number, digits only — the customer prints it as `EC <nr>`. */
  readonly ccNumber: string;
  readonly amount: Prisma.Decimal;
}

/** A Trip as the route-choice check reads it: its pair facts and its choice NOW. */
export interface RouteChoiceMember extends CombinationMember {
  /** The route `trip_route_selection` holds for it now; null when none. */
  readonly currentChoice: string | null;
}

/**
 * What the invoice check READS beyond what the Trip and pricing modules offer.
 *
 * ── READ ONLY, AND ONLY FOR THIS FLOW ───────────────────────────────────────
 * Every method here is a query; nothing writes. They live in the invoice check
 * rather than in the Trip or Cost Confirmation modules because only this flow
 * asks them — and each is ONE query for the whole document, never one per line.
 *
 * DELETED Trips are never returned: a deleted Trip is a record that should not
 * have existed, and nothing on an invoice can be about it.
 */
@Injectable()
export class InvoiceAuditReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every Trip on any of the given days, by either of its two dates, whatever
   * its booking — the candidates for a line whose booking matched nothing.
   */
  findTripsOnDates(days: readonly Date[]): Promise<Trip[]> {
    if (days.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.trip.findMany({
      where: {
        OR: [
          { planningDate: { in: [...days] } },
          { originalPlanningDate: { in: [...days] } },
        ],
        status: { not: TripStatus.DELETED },
      },
      orderBy: [{ planningDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Every Trip holding one of these bookings, on ANY day — the candidates for a
   * line whose date is misprinted. Never a partial booking: exact numbers only.
   */
  findTripsByBookings(bookingNumbers: readonly string[]): Promise<Trip[]> {
    if (bookingNumbers.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.trip.findMany({
      where: { bookingNumber: { in: [...bookingNumbers] }, status: { not: TripStatus.DELETED } },
      orderBy: [{ planningDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  /** The given Trips, DELETED ones left out. */
  findTripsByIds(tripIds: readonly string[]): Promise<Trip[]> {
    if (tripIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.trip.findMany({
      where: { id: { in: [...tripIds] }, status: { not: TripStatus.DELETED } },
      orderBy: [{ id: "asc" }],
    });
  }

  /**
   * Every Cost Confirmation carrying one of these numbers.
   *
   * A number is unique per Trip, not across Trips, so several Trips may answer
   * to one number — the caller decides what that means.
   */
  async findCostConfirmationsByNumbers(
    ccNumbers: readonly string[],
  ): Promise<InvoiceCostConfirmation[]> {
    if (ccNumbers.length === 0) {
      return [];
    }

    const rows = await this.prisma.costConfirmation.findMany({
      where: {
        ccNumber: { in: [...ccNumbers] },
        trip: { status: { not: TripStatus.DELETED } },
      },
      select: { tripId: true, ccNumber: true, amount: true },
      orderBy: [{ ccNumber: "asc" }, { tripId: "asc" }],
    });

    return rows.map((row) => ({
      tripId: row.tripId,
      ccNumber: row.ccNumber,
      amount: new Prisma.Decimal(row.amount),
    }));
  }

  /**
   * The names of the Custom Properties assigned to each Trip — by a person or
   * by a rule, priced or not — in the order they were assigned.
   */
  async findCustomPropertyNames(
    tripIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const names = new Map<string, string[]>();

    if (tripIds.length === 0) {
      return names;
    }

    const assignments = await this.prisma.tripCustomProperty.findMany({
      where: { tripId: { in: [...tripIds] } },
      select: { tripId: true, customProperty: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    for (const assignment of assignments) {
      names.set(assignment.tripId, [
        ...(names.get(assignment.tripId) ?? []),
        assignment.customProperty.name,
      ]);
    }

    return names;
  }

  /** Every Cost Confirmation number of each Trip, oldest first. */
  async findCostConfirmationNumbers(
    tripIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const numbers = new Map<string, string[]>();

    if (tripIds.length === 0) {
      return numbers;
    }

    const confirmations = await this.prisma.costConfirmation.findMany({
      where: { tripId: { in: [...tripIds] } },
      select: { tripId: true, ccNumber: true },
      orderBy: [{ receivedAt: "asc" }, { ccNumber: "asc" }],
    });

    for (const confirmation of confirmations) {
      numbers.set(confirmation.tripId, [
        ...(numbers.get(confirmation.tripId) ?? []),
        confirmation.ccNumber,
      ]);
    }

    return numbers;
  }

  /** How many (not deleted) Trips each group holds. */
  async countGroupMembers(groupIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    if (groupIds.length === 0) {
      return counts;
    }

    const groups = await this.prisma.trip.groupBy({
      by: ["tripGroupId"],
      where: {
        tripGroupId: { in: [...groupIds] },
        status: { not: TripStatus.DELETED },
      },
      _count: { _all: true },
    });

    for (const group of groups) {
      if (group.tripGroupId !== null) {
        counts.set(group.tripGroupId, group._count._all);
      }
    }

    return counts;
  }

  /**
   * These Trips and every member of these groups, each with the route choice
   * stored for it NOW — never what a snapshot remembers. A choice an explicit
   * reprocess, a road, group or status change removed is simply absent.
   */
  async findRouteChoiceMembers(
    tripIds: readonly string[],
    tripGroupIds: readonly string[],
  ): Promise<RouteChoiceMember[]> {
    if (tripIds.length === 0 && tripGroupIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.trip.findMany({
      where: {
        OR: [{ id: { in: [...tripIds] } }, { tripGroupId: { in: [...tripGroupIds] } }],
        status: { not: TripStatus.DELETED },
      },
      select: {
        id: true,
        tripGroupId: true,
        pdfDocumentId: true,
        direction: true,
        status: true,
        routeSelection: { select: { routePricingId: true } },
      },
      orderBy: [{ id: "asc" }],
    });

    return rows.map(({ routeSelection, ...member }) => ({
      ...member,
      currentChoice: routeSelection?.routePricingId ?? null,
    }));
  }
}
