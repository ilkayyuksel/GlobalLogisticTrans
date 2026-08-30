import { Module } from "@nestjs/common";

import { CostConfirmationReadRepository } from "./cost-confirmation-read.repository";
import { CostConfirmationReadService } from "./cost-confirmation-read.service";

/**
 * Reading a Trip's confirmed cost — and nothing else.
 *
 * Recording a confirmation now recalculates the Trip's pricing, so
 * CostConfirmationModule depends on the Pricing Engine. The Engine still needs
 * to READ the confirmed amount, and reading it through the write module would
 * close that loop. This module is the read half, and it imports nothing:
 *
 *     CostConfirmationModule ──> PricingEngineModule
 *                                        │
 *                                        v
 *                          CostConfirmationReadModule ──> Prisma
 *
 * It must never import PricingEngineModule and must never grow a write.
 */
@Module({
  providers: [CostConfirmationReadService, CostConfirmationReadRepository],
  exports: [CostConfirmationReadService],
})
export class CostConfirmationReadModule {}
