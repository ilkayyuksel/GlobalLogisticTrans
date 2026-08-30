import { Module } from "@nestjs/common";

import { TripReadRepository } from "./trip-read.repository";
import { TripReadService } from "./trip-read.service";

/**
 * Reading a Trip's pricing inputs — and nothing else.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 * The Pricing Engine has to read Trips, and TripModule has to call the Pricing
 * Engine: assigning a Custom Property, editing a waiting time or recording a
 * Cost Confirmation must leave the Trip's pricing current, and those writes
 * live in the planning domain. With the Engine importing TripModule that is a
 * cycle, and a cycle hidden behind forwardRef is still a cycle — it only moves
 * the failure from boot time to the first null dependency.
 *
 * So the read is separated from the write. This module imports nothing — its
 * repository talks to Prisma, which is global — and therefore sits below both:
 *
 *     TripModule ─────────────┐
 *                             ├──> TripReadModule ──> Prisma
 *     PricingEngineModule ────┤        (read only)
 *                             │
 *     TripPricingModule ──────┘
 *
 * It is the same shape EffectivePricingModule already uses for the opposite
 * direction, and for the same reason.
 *
 * ── WHAT IT MUST NEVER DO ───────────────────────────────────────────────────
 * Import PricingEngineModule, or grow a write. The moment it does either, the
 * cycle is back and every module above it becomes untestable in isolation.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Module({
  providers: [TripReadService, TripReadRepository],
  // The repository stays inside: a caller reaching it directly would bypass the
  // conversion to exact decimal text that the calculation context depends on.
  exports: [TripReadService],
})
export class TripReadModule {}
