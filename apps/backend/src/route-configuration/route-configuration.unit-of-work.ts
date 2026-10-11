import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingRepository } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import { RouteConfigurationService } from "./route-configuration.service";
import { RouteComponentCostService } from "./route-component-cost.service";

/**
 * How long one unit of work may hold its transaction.
 *
 * The bulk import now runs one per entry, which needs far less; the bound stays
 * explicit rather than inherited, so a slow write fails on a timeout somebody
 * chose.
 */
const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;

/** How long it may wait for a connection before giving up. */
const IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

/** The configuration services, bound to one transaction. */
export interface RouteConfigurationServices {
  readonly routes: RouteConfigurationService;
  readonly combinations: CombinationRouteConfigurationService;
}

/**
 * Runs work against the configuration services inside ONE database transaction.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Configuring one route is already several writes across two tables — a
 * `route_pricing` row (two, and a group, for a Combination) and its toll and
 * tunnel `route_cost` rows. A transaction that covered only some of them would
 * leave a route priced without its tunnel, or half a Combination. The bulk
 * import runs one of these per entry; leg sync and bulk removal one per action.
 *
 * ── AND WHY IT BUILDS THE SERVICES RATHER THAN BYPASSING THEM ────────────────
 * The alternative was to write the rows directly from the importer, which would
 * have meant a second definition of what configuring a route means — a second
 * duplicate check, a second way of writing a tunnel cost — and the two would
 * drift. So the whole stack is rebuilt against the transaction's client instead,
 * and an imported route is created by the SAME code path a hand-configured one is.
 *
 * This is the repository clone pattern one level up: `runInTransaction` on a
 * repository hands back a repository bound to the transaction, and this hands
 * back the services built on two such repositories. It performs no query itself.
 */
@Injectable()
export class RouteConfigurationUnitOfWork {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteConfigurationUnitOfWork.name);
  }

  run<TResult>(
    work: (services: RouteConfigurationServices) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(
      (transaction) => work(this.servicesFor(transaction)),
      {
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS,
      },
    );
  }

  /**
   * The same object graph the Nest container builds, on a transaction's client.
   *
   * Assembled by hand because the container's instances hold the ordinary client:
   * injecting them here would run their writes outside the transaction, which is
   * precisely the failure this class exists to prevent.
   */
  private servicesFor(transaction: unknown): RouteConfigurationServices {
    const client = transactionBound(transaction as PrismaService);

    const routePricingRepository = new RoutePricingRepository(client);
    const routeCostRepository = new RouteCostRepository(client);

    const routeCosts = new RouteComponentCostService(
      new RouteCostService(routeCostRepository, this.logger),
      routeCostRepository,
      this.logger,
    );

    return {
      routes: new RouteConfigurationService(
        new RoutePricingService(routePricingRepository, this.logger),
        routeCosts,
        this.logger,
      ),
      combinations: new CombinationRouteConfigurationService(
        new CombinationRoutePricingService(routePricingRepository, this.logger),
        routeCosts,
        this.logger,
      ),
    };
  }
}

/**
 * The transaction's client, with nested `$transaction` calls kept INSIDE it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * The services open transactions of their own: a Combination writes its group
 * and both legs through `RoutePricingRepository.runInTransaction`, and a route
 * cost page is read through a batch `$transaction([...])`. Called on a
 * transaction's client, Prisma starts a SEPARATE transaction for each — so a
 * Combination committed on its own, and a failure writing its tolls afterwards
 * left it stored without them. Here both forms simply run in the unit of work's
 * own transaction: one entry is all its rows or none of them.
 * ────────────────────────────────────────────────────────────────────────────
 */
function transactionBound(transaction: PrismaService): PrismaService {
  type Nested = readonly Promise<unknown>[] | ((client: PrismaService) => Promise<unknown>);

  const bound: PrismaService = new Proxy(transaction, {
    get: (target, property) =>
      property === "$transaction"
        ? (nested: Nested) => (typeof nested === "function" ? nested(bound) : Promise.all(nested))
        : Reflect.get(target, property, target),
  });

  return bound;
}
