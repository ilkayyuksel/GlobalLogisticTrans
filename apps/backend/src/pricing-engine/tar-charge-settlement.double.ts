import type { TarChargeSettlement } from "./tar-charge-settlement";

/**
 * A settlement that moves no TAR charge: for specs of a pricing trigger that
 * prices a stand-in Engine. The real settlement runs through the pricing
 * harness (`pricing-lifecycle.harness.ts`) and `tar-lifecycle.spec.ts`.
 */
export function noTarSettlement(): TarChargeSettlement {
  return {
    holdingBefore: async () => new Set<string>(),
    tripsToReprice: async () => [],
  } as unknown as TarChargeSettlement;
}
