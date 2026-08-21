import { Module } from "@nestjs/common";

import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

/**
 * Confirmed costs.
 *
 * No controller: a confirmation is never created, edited or deleted through the
 * API, and it is read through the Trip it belongs to. What this module exports
 * is the service the import path writes with and the Trip domain reads with.
 */
@Module({
  providers: [CostConfirmationService, CostConfirmationRepository],
  exports: [CostConfirmationService],
})
export class CostConfirmationModule {}
