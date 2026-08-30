import { Module } from "@nestjs/common";

import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

/**
 * Confirmed costs — the WRITE side.
 *
 * No controller: a confirmation is never created, edited or deleted through the
 * API. It arrives as a document, so the import path is the only writer, and it
 * is read through the Trip it belongs to.
 *
 * ── WHY IT DEPENDS ON THE PRICING ENGINE ────────────────────────────────────
 * A confirmed amount IS the Trip's EK line, so recording one must leave the
 * Trip's pricing current. That is an awaited call, and the recalculated
 * breakdown travels back on the result.
 *
 * The Engine still has to READ confirmed amounts. It does so through
 * CostConfirmationReadModule — narrow, read-only, importing nothing but
 * Prisma — so the arrow points one way and no cycle forms:
 *
 *     CostConfirmationModule ──> PricingEngineModule
 *                                        │
 *                                        v
 *                      CostConfirmationReadModule ──> Prisma
 *
 * No forwardRef: it would hide the cycle rather than remove it.
 */
@Module({
  imports: [PricingEngineModule],
  providers: [CostConfirmationService, CostConfirmationRepository],
  exports: [CostConfirmationService],
})
export class CostConfirmationModule {}
