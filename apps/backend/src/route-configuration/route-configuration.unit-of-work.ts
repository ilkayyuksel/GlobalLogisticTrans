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
 * How long one import may hold its transaction.
 *
 * Prisma's default of five seconds is comfortable for the two or three writes an
 * ordinary request makes and much too short for a few hundred routes. The bound
 * is explicit rather than inherited, so a large import fails on its own merits
 * instead of on a timeout nobody chose.
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
 * A bulk import must be all or nothing, and configuring one route is already
 * several writes across two tables — a `route_pricing` row and a tunnel
 * `route_cost`. A transaction that covered only one of them would leave a route
 * priced without its tunnel, and a loop of ordinary service calls would leave
 * nineteen routes behind when the twentieth failed.
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
    const client = transaction as PrismaService;

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
