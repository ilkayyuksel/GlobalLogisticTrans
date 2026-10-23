import { Prisma } from "@prisma/client";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { owedOnCostLine } from "../pricing/trip-reconciliation";
import type { MissingTrip } from "./missing-trips.service";

/**
 * A missing transport whose Cost Confirmation lines ARE on the invoice: the
 * line added for it carries only the EK those lines do not already charge.
 *
 * The same rule a transport line on the invoice is held to
 * (`reconcileTripRows`): what the Trip's EC lines are owed is taken off its EK,
 * so no confirmation is charged twice. The Totaal follows its parts. Nothing
 * else of the stored price changes.
 */
export function withEkNotOnCostLines(
  missing: readonly MissingTrip[],
  matches: readonly InvoiceRowMatch[],
): MissingTrip[] {
  return missing.map((entry) => {
    if (entry.pricing === null) {
      return entry;
    }

    const pricing = entry.pricing;
    const covered = matches
      .filter((match) => match.status === InvoiceRowStatus.COST_LINE && match.trip?.id === entry.trip.id)
      .reduce((total, match) => total.plus(owedOnCostLine(pricing, match)), new Prisma.Decimal(0));

    if (covered.isZero()) {
      return entry;
    }

    const ek = Prisma.Decimal.max(pricing.ek.minus(covered), 0);

    return { ...entry, pricing: { ...pricing, ek, totaal: pricing.totaal.minus(pricing.ek.minus(ek)) } };
  });
}
