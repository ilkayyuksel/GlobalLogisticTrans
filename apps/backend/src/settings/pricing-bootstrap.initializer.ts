import { Injectable, OnApplicationBootstrap } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingBootstrapService } from "./pricing-bootstrap.service";

/**
 * Ensures the pricing foundation once, as the application finishes starting.
 *
 * ── WHY A STARTUP HOOK RATHER THAN A BUTTON ─────────────────────────────────
 * The button already existed. It was not pressed, and that is precisely how a
 * deployment ended up serving an API that answered `pricing: null` for every
 * Trip: the schema was migrated, the catalog was never created, and nothing
 * announced it. An initialization step that depends on somebody remembering is
 * not initialization.
 *
 * `onApplicationBootstrap` rather than `onModuleInit`: the compose stack runs
 * migrations to completion in their own container before the API starts, and
 * this runs after every module is ready, so the schema is present and Prisma is
 * connected.
 *
 * ── IT NEVER OVERWRITES, AND NEVER PRICES ───────────────────────────────────
 * Everything it does goes through `PricingBootstrapService.apply()`, which
 * creates only what is absent. On a configured database it writes nothing at
 * all, so restarting a healthy deployment is a no-op — which is what makes it
 * safe to run on every boot. It holds no Engine and no Trip service: no
 * historical Trip is repriced because configuration appeared, and a CLOSED Trip
 * without a snapshot still needs the explicit reprocess action.
 *
 * ── A FAILURE HERE MUST NOT STOP THE API ────────────────────────────────────
 * Two replicas booting together race for the same rows, and the partial unique
 * indexes are what decide that race — the loser gets a constraint violation
 * having done no harm. A database that is briefly unreachable produces the same
 * shape of problem. Neither is a reason to refuse every request, so the failure
 * is logged loudly and swallowed: the operator can still reach the application
 * and press the button the hook was covering for.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PricingBootstrapInitializer implements OnApplicationBootstrap {
  constructor(
    private readonly bootstrap: PricingBootstrapService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingBootstrapInitializer.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      const plan = await this.bootstrap.apply();

      if (plan.missingCount > 0 || plan.componentsMissingCount > 0) {
        this.logger.warn("Pricing configuration is still incomplete", {
          settingsMissing: plan.missingCount,
          componentsMissing: plan.componentsMissingCount,
          blocked: plan.blockedCount,
        });

        return;
      }

      this.logger.log("Pricing foundation verified at startup", {
        components: plan.components.length,
        settings: plan.settings.length,
        automaticPropertyPresent: plan.automaticProperty.isPresent,
      });
    } catch (error: unknown) {
      this.logger.error(
        "Pricing initialization failed at startup; the application is serving anyway",
        {
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
