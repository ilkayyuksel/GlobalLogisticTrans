import { Injectable } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { PaymentSelectionNoLongerEligibleException } from "../exceptions/invoice-audit.exceptions";

/**
 * The one write of the invoice check: marking the confirmed transports paid.
 *
 * ── ALL OR NOTHING, AND ONLY WHAT IS STILL TRUE ─────────────────────────────
 * The update itself states the conditions the confirmation was decided on — a
 * CLOSED Trip, not yet paid — so a Trip reopened or paid by somebody else in
 * the moment between deciding and writing is simply not updated. When fewer
 * rows changed than were asked for, the transaction is rolled back and NOTHING
 * is paid.
 *
 * It writes ONE column, exactly as the single-Trip payment does: no status, no
 * pricing, no snapshot is touched.
 */
@Injectable()
export class InvoicePaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async settle(tripIds: readonly string[]): Promise<number> {
    if (tripIds.length === 0) {
      return 0;
    }

    return this.prisma.$transaction(async (transaction) => {
      const { count } = await transaction.trip.updateMany({
        where: { id: { in: [...tripIds] }, status: TripStatus.CLOSED, isPaid: false },
        data: { isPaid: true },
      });

      if (count !== tripIds.length) {
        // Thrown inside the transaction, which is what rolls the others back.
        throw new PaymentSelectionNoLongerEligibleException(
          tripIds.map((tripId) => ({ tripId, reasons: ["CHANGED_WHILE_SETTLING"] })),
        );
      }

      return count;
    });
  }
}
