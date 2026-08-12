import { AppLoggerService } from "../../logger/app-logger.service";
import { DomainEvent, DomainEventBus } from "./domain-event-bus";

const EVENT_NAME = "test.happened";
const OTHER_EVENT_NAME = "test.other";

function event(name = EVENT_NAME): DomainEvent {
  return { eventName: name };
}

describe("DomainEventBus", () => {
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let bus: DomainEventBus;

  beforeEach(() => {
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    bus = new DomainEventBus(logger as unknown as AppLoggerService);
  });

  describe("delivery", () => {
    it("delivers an event to its subscriber", async () => {
      const handler = jest.fn();
      bus.subscribe(EVENT_NAME, handler);

      await bus.publish(event());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event());
    });

    it("delivers nothing when no one subscribed", async () => {
      await expect(bus.publish(event())).resolves.toBeUndefined();
    });

    it("delivers only to the matching event name", async () => {
      const wanted = jest.fn();
      const other = jest.fn();
      bus.subscribe(EVENT_NAME, wanted);
      bus.subscribe(OTHER_EVENT_NAME, other);

      await bus.publish(event());

      expect(wanted).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    });

    it("delivers to every subscriber, in subscription order", async () => {
      const order: string[] = [];
      bus.subscribe(EVENT_NAME, () => {
        order.push("first");
      });
      bus.subscribe(EVENT_NAME, () => {
        order.push("second");
      });

      await bus.publish(event());

      expect(order).toEqual(["first", "second"]);
    });

    it("awaits an asynchronous handler before returning", async () => {
      let finished = false;
      bus.subscribe(EVENT_NAME, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        finished = true;
      });

      await bus.publish(event());

      expect(finished).toBe(true);
    });
  });

  /**
   * A subscriber must never be able to break the operation that published the
   * fact. The Trip is already CLOSED by the time anyone hears about it.
   */
  describe("handler isolation", () => {
    it("does not propagate a handler's failure to the publisher", async () => {
      bus.subscribe(EVENT_NAME, () => {
        throw new Error("handler exploded");
      });

      await expect(bus.publish(event())).resolves.toBeUndefined();
    });

    it("does not propagate a rejected promise either", async () => {
      bus.subscribe(EVENT_NAME, async () => {
        throw new Error("async failure");
      });

      await expect(bus.publish(event())).resolves.toBeUndefined();
    });

    it("still runs the remaining handlers after one fails", async () => {
      const survivor = jest.fn();
      bus.subscribe(EVENT_NAME, () => {
        throw new Error("first fails");
      });
      bus.subscribe(EVENT_NAME, survivor);

      await bus.publish(event());

      expect(survivor).toHaveBeenCalledTimes(1);
    });

    it("logs the failure rather than swallowing it", async () => {
      bus.subscribe(EVENT_NAME, () => {
        throw new Error("handler exploded");
      });

      await bus.publish(event());

      expect(logger.error).toHaveBeenCalledWith("Domain event handler failed", {
        eventName: EVENT_NAME,
        reason: "handler exploded",
      });
    });
  });

  describe("logging", () => {
    it("logs the event name and the subscriber count", async () => {
      bus.subscribe(EVENT_NAME, jest.fn());

      await bus.publish(event());

      expect(logger.log).toHaveBeenCalledWith("Domain event published", {
        eventName: EVENT_NAME,
        handlerCount: 1,
      });
    });

    it("logs each subscription", () => {
      bus.subscribe(EVENT_NAME, jest.fn());

      expect(logger.log).toHaveBeenCalledWith(
        "Domain event handler subscribed",
        { eventName: EVENT_NAME, handlerCount: 1 },
      );
    });
  });

  it("carries no infrastructure: no queue, no broker, no persistence", () => {
    const source = DomainEventBus.prototype.constructor.toString();

    expect(source).not.toContain("prisma");
    expect(source).not.toContain("setTimeout");
    expect(source).not.toContain("retry");
  });

  /**
   * The bus delivers at MOST once, in memory, and never retries.
   *
   * These are not aspirations to fix — they are the accepted limits of an
   * in-process bus, asserted so nobody later mistakes it for durable delivery.
   * The consequence is real: if the process dies between the publisher's commit
   * and a handler running, that event is gone. For pricing this leaves a Trip
   * CLOSED and unpriced, which is a recoverable state rather than a wrong
   * price. Anything stronger needs a transactional outbox, which is a
   * deliberate decision and not something this class should grow into.
   */
  describe("the accepted delivery limits", () => {
    it("forgets an event once it has been published", async () => {
      await bus.publish(event());

      // A subscriber that arrives afterwards receives nothing: there is no log
      // of past events to replay from.
      const late = jest.fn();
      bus.subscribe(EVENT_NAME, late);

      expect(late).not.toHaveBeenCalled();
    });

    it("does not retry a handler that failed", async () => {
      const handler = jest.fn().mockImplementation(() => {
        throw new Error("transient failure");
      });
      bus.subscribe(EVENT_NAME, handler);

      await bus.publish(event());

      // Once. A retry would need durable state the bus deliberately lacks.
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("exposes no way to replay, queue or acknowledge an event", () => {
      const methods = Object.getOwnPropertyNames(DomainEventBus.prototype);

      expect(methods).toEqual(["constructor", "subscribe", "publish", "runHandler"]);
    });

    it("keeps no record of what it has delivered", () => {
      const bookkeeping = Object.getOwnPropertyNames(bus).filter(
        (property) => property !== "handlersByEventName" && property !== "logger",
      );

      expect(bookkeeping).toEqual([]);
    });
  });
});
