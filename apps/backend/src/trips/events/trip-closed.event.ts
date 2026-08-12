import { DomainEvent } from "../../common/events/domain-event-bus";

export const TRIP_CLOSED_EVENT = "trip.closed";

/**
 * A Trip has successfully transitioned to CLOSED.
 *
 * A statement of fact, not an instruction. It does not say "price this Trip" —
 * pricing is one subscriber's reaction, and expressing the event as a command
 * would put the Trip module in charge of a decision that belongs to the
 * Pricing Engine.
 *
 * It carries the Trip's identity and nothing else. A subscriber that needs the
 * Trip reads it through TripService, so it always works from the current
 * committed row rather than from a copy that was already stale when the event
 * was published. Carrying the entity would also freeze this contract around
 * whichever fields the Trip happens to have today.
 *
 * No Prisma model and no monetary value appears here, deliberately: an event is
 * logged, and pricing is commercial information.
 */
export class TripClosedEvent implements DomainEvent {
  readonly eventName = TRIP_CLOSED_EVENT;

  constructor(readonly tripId: string) {}
}
