import { Injectable } from "@nestjs/common";
import { Prisma, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { FAILED_CALCULATION_STATUS } from "../trip-pricing/current-pricing";
import { isHeldByAnother, type TarHolder } from "./tar-charge-holders";

/**
 * The reads behind "has this TAR-nummer ALREADY BEEN CHARGED that day?" —
 * WHO holds a charge is decided in `tar-charge-holders.ts`.
 *
 * ── WHY THE CHARGE AND NOT THE COLUMN ───────────────────────────────────────
 * The obvious question is "does another Trip today carry this tar_nummer", and
 * it is the wrong one. A number typed on a Trip that was never closed has been
 * charged to nobody, and letting it block a real Trip would silently lose the
 * charge — so the evidence is the CHARGE: an AUTOMATIC TAR line
 * (`trip_pricing_item.is_automatic`) on a stored snapshot. Only the Engine
 * writes one, and only for a Trip that reached CLOSED. A manual TAR is a line
 * of the same property without the mark: an extra, never the day's charge.
 *
 * ── WHICH SNAPSHOTS COUNT ───────────────────────────────────────────────────
 * Not a CANCELLED or DELETED Trip's: that transport did not incur the charge,
 * and a record nobody should be billed for must not stop somebody else being
 * billed. Not a FAILED snapshot: it is nobody's price. A REOPENED Trip's does
 * count, until a CLOSED Trip charged later replaces it — see the rule.
 *
 * ── SMALL READS ─────────────────────────────────────────────────────────────
 * The day's automatic lines of one number — a handful at most. Nothing about
 * another Trip is read beyond its id, status and when it was priced.
 */

/** Statuses whose TAR charge is not a charge anybody owes. */
const DISREGARDED_STATUSES: readonly TripStatus[] = [
  TripStatus.DELETED,
  TripStatus.CANCELLED,
];

/** Whether a Trip at this status can hold a TAR charge anybody owes. */
export function canHoldTarCharge(status: TripStatus): boolean {
  return !DISREGARDED_STATUSES.includes(status);
}

/** One TAR-nummer on one operational day. */
export interface TarDay {
  /** Trimmed, and known to be meaningful — see `hasTarNummer`. */
  readonly tarNummer: string;
  /**
   * The operational day: `planning_date` — the day the Ritten views group by
   * and the day an operator moves a Trip to — never `original_planning_date`,
   * which the schema keeps as the immutable IMPORT date for reporting.
   */
  readonly planningDate: Date;
}

export interface TarChargeQuery extends TarDay {
  /** The Trip being priced: its own charge never blocks it. */
  readonly tripId: string;
}

/** An automatic TAR line that may be a charge someone owes. */
const COUNTED_AUTOMATIC_LINE = {
  isAutomatic: true,
  tripPricing: {
    calculationStatus: { not: FAILED_CALCULATION_STATUS },
    trip: { status: { notIn: [...DISREGARDED_STATUSES] } },
  },
} satisfies Prisma.TripPricingItemWhereInput;

@Injectable()
export class TarChargeReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** True when a Trip other than the one asking holds this number's charge that day. */
  async hasBeenChargedToday(query: TarChargeQuery): Promise<boolean> {
    return isHeldByAnother(await this.findHolders(query), query.tripId);
  }

  /**
   * Every Trip — the one asking included — whose stored snapshot carries an
   * automatic TAR line for this number that day. The number is compared as
   * `meaningfulTarNummer` defines it: trimmed by the caller, case-insensitive
   * here, so `tar123` and `TAR123 ` are one number.
   */
  async findHolders(day: TarDay): Promise<TarHolder[]> {
    const lines = await this.prisma.tripPricingItem.findMany({
      where: {
        ...COUNTED_AUTOMATIC_LINE,
        tripPricing: {
          ...COUNTED_AUTOMATIC_LINE.tripPricing,
          trip: {
            ...COUNTED_AUTOMATIC_LINE.tripPricing.trip,
            planningDate: day.planningDate,
            tarNummer: { equals: day.tarNummer, mode: "insensitive" },
          },
        },
      },
      select: {
        tripPricing: {
          select: { tripId: true, calculatedAt: true, trip: { select: { status: true } } },
        },
      },
    });

    return lines.map(({ tripPricing }) => ({
      tripId: tripPricing.tripId,
      status: tripPricing.trip.status,
      calculatedAt: tripPricing.calculatedAt,
    }));
  }

  /** Which of these Trips' stored snapshots carry an automatic TAR line. */
  async findTripsHoldingAutomaticTar(tripIds: readonly string[]): Promise<Set<string>> {
    if (tripIds.length === 0) {
      return new Set();
    }

    const lines = await this.prisma.tripPricingItem.findMany({
      where: {
        isAutomatic: true,
        tripPricing: { tripId: { in: [...tripIds] } },
      },
      select: { tripPricing: { select: { tripId: true } } },
    });

    return new Set(lines.map((line) => line.tripPricing.tripId));
  }

  /**
   * The CLOSED Trips other than `excludeTripId` that state this TAR-nummer on
   * this day — the Trips a charge released on that day may now belong to.
   */
  async findClosedTripsStating(day: TarDay, excludeTripId: string): Promise<string[]> {
    const trips = await this.prisma.trip.findMany({
      where: {
        id: { not: excludeTripId },
        status: TripStatus.CLOSED,
        planningDate: day.planningDate,
        tarNummer: { equals: day.tarNummer, mode: "insensitive" },
      },
      select: { id: true },
      // The first priced Trip takes a free charge; a stable order keeps the
      // answer reproducible when several could.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return trips.map((trip) => trip.id);
  }
}
