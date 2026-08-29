import { request } from "./client";
import type { EffectivePricing } from "./types";

/**
 * Manual price corrections on one Trip.
 *
 * ── THESE ARE THE ONLY PRICING WRITES THE BROWSER MAKES ─────────────────────
 * Three components admit a correction — Tarief, Tol and Tunnel — and every
 * other amount follows from something else. The backend enforces that; this
 * module simply has no function that could ask for anything more.
 *
 * ── ONE REQUEST, ONE COMPLETE ANSWER ────────────────────────────────────────
 * Both operations return the WHOLE recalculated breakdown for that Trip, so a
 * row updates from the response and the list is never refetched. That is what
 * keeps Brandstof and Totaal correct after a Tarief correction without this
 * side calculating either of them.
 *
 * The answer is null when the Trip has never been priced. The correction is
 * still stored, and it applies as soon as the Engine prices the Trip.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PRICING_PATH = "/api/v1/trip-pricing";

/** The component codes an operator may correct, as the backend spells them. */
export const OVERRIDABLE_COMPONENTS = {
  tarief: "BASE_PRICE",
  tol: "TOLL",
  tunnel: "TUNNEL",
} as const;

export type OverridableComponent =
  (typeof OVERRIDABLE_COMPONENTS)[keyof typeof OVERRIDABLE_COMPONENTS];

/**
 * Records a correction for one component of one Trip.
 *
 * `amount` is a number because the endpoint validates a number bounded to two
 * decimals. Zero is a legitimate amount — a Trip genuinely without toll — and
 * is stored as an explicit 0.00, never treated as a withdrawal. Withdrawing is
 * `resetTripPricingOverride`.
 *
 * The author is taken from the verified access token by the backend and is
 * deliberately not a parameter here: a caller must not be able to claim one.
 */
export function saveTripPricingOverride(
  tripId: string,
  componentCode: OverridableComponent,
  amount: number,
  signal?: AbortSignal,
): Promise<EffectivePricing | null> {
  return request<EffectivePricing | null>(
    `${PRICING_PATH}/trip/${tripId}/overrides`,
    { method: "PUT", body: { componentCode, amount }, signal },
  );
}

/**
 * Withdraws a correction, returning the component to the calculated figure.
 *
 * Its own operation rather than a save of an empty value, because an empty box
 * is indistinguishable from zero and zero is a real amount. A component that
 * carries no correction answers 404, which is honest: nothing was restored.
 */
export function resetTripPricingOverride(
  tripId: string,
  componentCode: OverridableComponent,
  signal?: AbortSignal,
): Promise<EffectivePricing | null> {
  return request<EffectivePricing | null>(
    `${PRICING_PATH}/trip/${tripId}/overrides/${componentCode}`,
    { method: "DELETE", signal },
  );
}
