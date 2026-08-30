import { Injectable } from "@nestjs/common";
import { TripDirection, TripStatus } from "@prisma/client";

import { toIsoDate } from "../common/dates";
import { DISTANCE_DECIMAL_PLACES } from "./dto/create-trip.dto";
import { EngineTripRow, TripReadRepository } from "./trip-read.repository";

/**
 * A Trip as the Pricing Engine sees it.
 *
 * ── WHY IT IS NOT TripResponseDto ───────────────────────────────────────────
 * The response DTO carries the Vehicle, the effective Driver, the latest
 * update, the Cost Confirmation, the assigned properties and the Trip's own
 * pricing. Resolving all of that costs several queries and — far worse — makes
 * pricing depend on the planning module, which is the cycle this read side
 * exists to prevent: the Engine would need TripModule, and TripModule needs the
 * Engine to recalculate after a waiting-time change.
 *
 * So the Engine reads eleven scalar columns and nothing else. Every one of them
 * is a documented pricing input:
 *
 *   id, status                 whether this Trip may be priced at all
 *   terminal, destinationCity  the route, for RoutePricing and RouteCost
 *   distanceKm                 the base price under Distance-Based Pricing
 *   waitingTimeMinutes         the Waiting Time component
 *   tripGroupId, pdfDocumentId whether this is a leg of a genuine Combination
 *   direction                  which leg it is, which decides where TAR sits
 *   bookingNumber, planningDate  carried onto the calculation context
 *
 * ── THE SERIALISED FORMS ARE DELIBERATE ─────────────────────────────────────
 * `distanceKm` is a fixed-2 STRING and `planningDate` an ISO date string,
 * exactly as TripResponseDto renders them. The calculation context is defined
 * in those terms — money and distances travel as exact decimal text, never as
 * floats — so the conversion belongs here rather than being repeated by every
 * caller.
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface TripReadView {
  readonly id: string;
  /** Null on a manual Trip whose booking number is not known yet. */
  readonly bookingNumber: string | null;
  readonly status: TripStatus;
  /** Null on a manually created Trip: it is what the DOCUMENT said. */
  readonly direction: TripDirection | null;
  readonly terminal: string | null;
  readonly destinationCity: string | null;
  /** "YYYY-MM-DD", or null on a Trip that has not been scheduled. */
  readonly planningDate: string | null;
  /** Fixed-2 decimal string, never a float. Null when no distance was entered. */
  readonly distanceKm: string | null;
  /** Null means no waiting time was recorded, which is not the same as zero. */
  readonly waitingTimeMinutes: number | null;
  readonly tripGroupId: string | null;
  readonly pdfDocumentId: string | null;
}

/**
 * The narrow Trip read side.
 *
 * Sits BELOW both the planning domain and the Pricing Engine and depends on
 * neither — only on Prisma, which is global. That is what makes the pricing
 * graph acyclic: the Engine reads Trips through this service, TripModule calls
 * the Engine after a pricing input changes, and no arrow points back.
 *
 * It answers two questions and refuses to grow a third without a reason: what
 * are this Trip's pricing inputs, and which Trips share its group. Anything
 * about a Trip's lifecycle, its documents or its planning data belongs to
 * TripService, which owns those rules.
 */
@Injectable()
export class TripReadService {
  constructor(private readonly repository: TripReadRepository) {}

  /**
   * One Trip's pricing inputs, or null when there is no such Trip.
   *
   * Null rather than a 404: this service has no transport, and a caller that
   * needs one raises its own. The Engine reports absence as a pricing-domain
   * failure; the pricing API reports it as a Trip that does not exist.
   */
  async findById(tripId: string): Promise<TripReadView | null> {
    const row = await this.repository.findById(tripId);

    return row === null ? null : toTripReadView(row);
  }

  /** Every Trip in one group, including the Trip that asked. */
  async findByGroupId(tripGroupId: string): Promise<TripReadView[]> {
    const rows = await this.repository.findByGroupId(tripGroupId);

    return rows.map(toTripReadView);
  }
}

function toTripReadView(row: EngineTripRow): TripReadView {
  return {
    id: row.id,
    bookingNumber: row.bookingNumber,
    status: row.status,
    direction: row.direction,
    terminal: row.terminal,
    destinationCity: row.destinationCity,
    planningDate: row.planningDate === null ? null : toIsoDate(row.planningDate),
    // Explicit null check, not truthiness: a distance of exactly 0 is a value.
    distanceKm:
      row.distanceKm === null
        ? null
        : row.distanceKm.toFixed(DISTANCE_DECIMAL_PLACES),
    waitingTimeMinutes: row.waitingTimeMinutes,
    tripGroupId: row.tripGroupId,
    pdfDocumentId: row.pdfDocumentId,
  };
}
