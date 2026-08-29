import { Module } from "@nestjs/common";

import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingRepository } from "./trip-pricing.repository";

/**
 * Reading what a Trip is worth — and nothing else.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 * The Ritten list carries each Trip's effective pricing, so TripModule has to
 * be able to read it. TripPricingModule cannot supply that: it imports
 * TripModule for the Trip existence lookup its WRITE paths need, and importing
 * it back would close a cycle.
 *
 * So the read is separated from the write. This module imports nothing — its
 * three repositories talk to Prisma, which is global — and therefore sits below
 * both:
 *
 *     TripModule ─────────┐
 *                         ├──> EffectivePricingModule ──> Prisma
 *     TripPricingModule ──┘            (read only)
 *
 * The dependency still flows one way. Planning does not depend on the pricing
 * WRITE rules, the overrides, the Engine or the reprocess path; it depends only
 * on the ability to read a stored figure, which is the same thing the Excel
 * exports and the Trip detail panel depend on.
 *
 * ── WHAT IT DOES NOT EXPORT ─────────────────────────────────────────────────
 * Only the service. The repositories stay inside, the override repository above
 * all: a caller that could reach it could store a correction without passing
 * the rule that says which components admit one. TripPricingModule keeps its
 * own repository providers for its write paths for exactly that reason — the
 * two instances are stateless Prisma wrappers, and the separation is worth more
 * than sharing them.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Module({
  providers: [
    EffectivePricingService,
    TripPricingRepository,
    TripPricingItemRepository,
    TripPricingOverrideRepository,
  ],
  exports: [EffectivePricingService],
})
export class EffectivePricingModule {}
