import { Injectable } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/**
 * Whether a TAR-nummer has ALREADY BEEN CHARGED on another Trip that day.
 *
 * ── WHY THE CHARGE AND NOT THE COLUMN ───────────────────────────────────────
 * The obvious question is "does another Trip today carry this tar_nummer", and
 * it is the wrong one. A number typed on a Trip that was never closed has been
 * charged to nobody, and letting it block a real Trip would silently lose €50 —
 * so the evidence is the CHARGE: a `trip_pricing_item` naming the automatic
 * property. That row exists only where the Pricing Engine actually produced a
 * TAR line, which happens only for a Trip that reached CLOSED.
 *
 * ── WHICH TRIPS COUNT ───────────────────────────────────────────────────────
 * DELETED is excluded because the model calls soft delete the remedy for a Trip
 * "created incorrectly or is a duplicate" — a record nobody should be billed
 * for must not stop somebody else being billed. CANCELLED is excluded because
 * the schema calls it "a business cancellation of the underlying transport": a
 * transport that was called off did not incur the charge.
 *
 * A REOPENED Trip is deliberately still counted. Its snapshot is a real charge
 * until something replaces it, and dropping it from the check would let a
 * second Trip take the same TAR while the first still holds it — a double
 * charge produced by reopening, which is the one thing this rule exists to
 * prevent.
 *
 * ── ONE QUERY, NO ROWS LOADED ───────────────────────────────────────────────
 * An existence check, not a page of Trips: the answer is a boolean and the day
 * may hold a hundred Trips.
 */

/** Statuses whose TAR charge is not a charge anybody owes. */
const DISREGARDED_STATUSES: readonly TripStatus[] = [
  TripStatus.DELETED,
  TripStatus.CANCELLED,
];

export interface TarChargeQuery {
  /** Excluded from the search: a Trip never blocks itself. */
  readonly tripId: string;
  /**
   * The operational day. `planning_date` — the day the Ritten views group by
   * and the day an operator moves a Trip to — never `original_planning_date`,
   * which the schema keeps as the immutable IMPORT date for reporting.
   */
  readonly planningDate: Date;
  /** Trimmed, and known to be meaningful — see `hasTarNummer`. */
  readonly tarNummer: string;
  /** The configured automatic property, from the settings. */
  readonly automaticCustomPropertyId: string;
}

@Injectable()
export class TarChargeReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True when another Trip on the same day already carries the TAR charge for
   * this number.
   *
   * The comparison on `tar_nummer` is case- and space-insensitive in the same
   * way `meaningfulTarNummer` defines it: the caller passes a trimmed value and
   * this matches insensitively, so `tar123` and `TAR123 ` are one number.
   */
  async hasBeenChargedToday(query: TarChargeQuery): Promise<boolean> {
    const existing = await this.prisma.tripPricingItem.findFirst({
      where: {
        customPropertyId: query.automaticCustomPropertyId,
        tripPricing: {
          trip: {
            id: { not: query.tripId },
            planningDate: query.planningDate,
            tarNummer: {
              equals: query.tarNummer,
              mode: "insensitive",
            },
            status: { notIn: [...DISREGARDED_STATUSES] },
          },
        },
      },
      // Existence only. Nothing about the other Trip is read or reported.
      select: { id: true },
    });

    return existing !== null;
  }
}
