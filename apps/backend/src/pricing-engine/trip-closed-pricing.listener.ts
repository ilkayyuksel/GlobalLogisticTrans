import { Injectable, OnModuleInit } from "@nestjs/common";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  TRIP_CLOSED_EVENT,
  TripClosedEvent,
} from "../trips/events/trip-closed.event";
import { PricingEngineException } from "./exceptions/pricing-engine.exceptions";
import { PairedPricingService } from "./paired-pricing.service";

/**
 * Prices a Trip as soon as it closes.
 *
 * The adapter between a Trip lifecycle fact and the Pricing Engine, and the
 * reason TripService needs to know nothing about pricing. The Trip module
 * announces that a Trip closed; this listener decides that closing is worth
 * pricing. Reversing that — having the Trip module ask for a price — is the
 * dependency direction the architecture forbids.
 *
 * It performs no validation, no calculation and no persistence of its own. It
 * calls one Engine operation and interprets the outcome, so every rule about
 * whether and how a Trip may be priced stays in exactly one place.
 *
 * `calculateAndStore` rather than `reprocess`: a Trip that has just closed is
 * normally being priced for the first time, and the "there must already be a
 * snapshot" precondition belongs only to the explicit reprocess operation.
 * `calculateAndStore` also handles the repeat case, replacing the snapshot
 * atomically, which is what makes a duplicated event harmless.
 *
 * ── AND ITS PARTNER LEG (OWNER, OCTOBER 2026) ───────────────────────────────
 * Closing a leg prices its CLOSED partner with it, both or neither — see
 * `PairedPricingService`. When both legs closed in one action, the first
 * leg's event priced the pair, so the second leg's event does nothing more.
 *
 * Amounts are never logged. Identifiers, the event name, a stable error code
 * and counts are.
 */
@Injectable()
export class TripClosedPricingListener implements OnModuleInit {
  constructor(
    private readonly eventBus: DomainEventBus,
    private readonly pairs: PairedPricingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripClosedPricingListener.name);
  }

  onModuleInit(): void {
    this.eventBus.subscribe<TripClosedEvent>(TRIP_CLOSED_EVENT, (event) =>
      this.onTripClosed(event),
    );
  }

  /**
   * Never throws.
   *
   * The Trip is already CLOSED and committed by the time this runs, and a
   * pricing problem cannot un-close it. Letting a failure escape would either
   * turn a successful status change into a server error for the caller, or —
   * worse — suggest the transition itself had failed. The two are separate
   * concerns and a Trip that cannot be priced yet is a normal, recoverable
   * state: the configuration is fixed and the explicit reprocess endpoint runs
   * the calculation again.
   *
   * Nothing is swallowed quietly. A pricing-domain failure is logged as a
   * warning with its stable code, because it means the configuration is
   * incomplete rather than the software broken. Anything else is logged as an
   * error, because it is unexpected.
   */
  private async onTripClosed(event: TripClosedEvent): Promise<void> {
    this.logger.log("Pricing a Trip that has closed", {
      eventName: event.eventName,
      tripId: event.tripId,
    });

    try {
      const { closedPartnerId } = await this.pairs.pairOf(event.tripId);

      if (closedPartnerId && closedEarlierInBatch(event, closedPartnerId)) {
        this.logger.log("Already priced with its partner leg in this batch", {
          eventName: event.eventName,
          tripId: event.tripId,
          partnerTripId: closedPartnerId,
        });

        return;
      }

      const [result] = await this.pairs.calculateAndStoreTogether(
        closedPartnerId ? [event.tripId, closedPartnerId] : [event.tripId],
      );

      this.logger.log("Automatic pricing completed", {
        eventName: event.eventName,
        tripId: event.tripId,
        partnerTripId: closedPartnerId,
        isReprocess: result.isReprocess,
        lineCount: result.lines.length,
        calculationStatus: result.calculationStatus,
      });
    } catch (error: unknown) {
      this.reportFailure(event, error);
    }
  }

  private reportFailure(event: TripClosedEvent, error: unknown): void {
    if (error instanceof PricingEngineException) {
      // Expected: the Trip closed but cannot be priced against the current
      // configuration. The code names what to fix.
      this.logger.warn("Automatic pricing could not price the Trip", {
        eventName: event.eventName,
        tripId: event.tripId,
        pricingErrorCode: error.code,
      });

      return;
    }

    this.logger.error("Automatic pricing failed unexpectedly", {
      eventName: event.eventName,
      tripId: event.tripId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The partner closed in the same action and its event came first: it priced both. */
function closedEarlierInBatch(event: TripClosedEvent, partnerId: string): boolean {
  const partnerPosition = event.closedTogetherWith.indexOf(partnerId);

  return partnerPosition !== -1 && partnerPosition < event.closedTogetherWith.indexOf(event.tripId);
}
