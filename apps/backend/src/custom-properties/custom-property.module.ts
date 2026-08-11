import { Module } from "@nestjs/common";

import { CustomPropertyController } from "./custom-property.controller";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * CustomPropertyService is exported because Trip will need it to validate that
 * an assigned property is active, and the Pricing Engine will read the
 * configured amount. Both depend on the service, never on the repository, so
 * database access stays behind a single door.
 */
@Module({
  controllers: [CustomPropertyController],
  providers: [CustomPropertyService, CustomPropertyRepository],
  exports: [CustomPropertyService],
})
export class CustomPropertyModule {}
