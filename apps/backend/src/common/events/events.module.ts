import { Global, Module } from "@nestjs/common";

import { DomainEventBus } from "./domain-event-bus";

/**
 * The domain event boundary, available everywhere.
 *
 * Global for the same reason LoggerModule and PrismaModule are: a publisher and
 * a subscriber must share ONE bus instance, and requiring every module that
 * publishes or listens to import this one would add an import edge to modules
 * that have no other relationship — the opposite of what the bus is for.
 */
@Global()
@Module({
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
