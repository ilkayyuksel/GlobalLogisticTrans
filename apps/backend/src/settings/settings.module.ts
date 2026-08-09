import { Module } from "@nestjs/common";

import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";
import { SettingValueValidator } from "./validators/setting-value.validator";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * SettingsService is exported because configuration is read across the system —
 * the Pricing Engine, Import and Export all need it. Consumers depend on the
 * service, never on the repository, so database access stays behind one door.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository, SettingValueValidator],
  exports: [SettingsService],
})
export class SettingsModule {}
