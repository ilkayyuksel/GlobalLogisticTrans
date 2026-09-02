import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { PricingBootstrapInitializer } from "./pricing-bootstrap.initializer";
import { PricingBootstrapService } from "./pricing-bootstrap.service";
import { PricingComponentRepository } from "./pricing-component.repository";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";
import { SettingValueValidator } from "./validators/setting-value.validator";

/**
 * PrismaModule and LoggerModule are global, so only CustomPropertyModule is
 * imported: bootstrapping resolves the automatic property's id from the live
 * database by name — and creates the property when no active one bears that
 * name — and both belong to the module that owns properties.
 *
 * The direction is safe. Custom Properties do not read Settings, so this does
 * not close a cycle — unlike the Pricing Engine, which does read Settings and
 * is therefore never imported here.
 *
 * SettingsService is exported because configuration is read across the system —
 * the Pricing Engine, Import and Export all need it. Consumers depend on the
 * service, never on the repository, so database access stays behind one door.
 */
@Module({
  imports: [CustomPropertyModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    SettingsRepository,
    SettingValueValidator,
    PricingBootstrapService,
    PricingComponentRepository,
    PricingBootstrapInitializer,
  ],
  exports: [SettingsService, PricingBootstrapService],
})
export class SettingsModule {}
