import type { CostConfirmation } from "@/lib/api/types";

/**
 * How a confirmation is named on screen: `CC4139505`.
 *
 * The prefix is PRESENTATION. The stored number is Eucon's own, digits only,
 * and nothing business-facing may depend on the two letters in front of it —
 * so this is the one place they are added, and never a value anything compares.
 */
export function toCostConfirmationLabel(
  confirmation: Pick<CostConfirmation, "ccNumber">,
): string {
  return `CC${confirmation.ccNumber}`;
}

/**
 * Whether this Trip carries a confirmed cost.
 *
 * A Trip with none shows nothing at all rather than a zero: nothing confirmed
 * and confirmed at nothing are different facts, and the second one has never
 * happened.
 */
export function hasCostConfirmation(trip: {
  costConfirmation: CostConfirmation | null;
}): boolean {
  return trip.costConfirmation !== null;
}

/** The trip facts the several-confirmations note is written from — all the backend's. */
export interface TripCostConfirmationFacts {
  readonly costConfirmations: readonly Pick<CostConfirmation, "ccNumber" | "amount">[];
  readonly costConfirmationTotal: string | null;
  readonly waitingTimeSupersedesCostConfirmations: boolean;
  /** The Trip's effective EK, or null when it has never been priced. */
  readonly ek: string | null;
}

/** The words the note is made of, in the reader's language. */
export interface CostConfirmationNoteWords {
  /** Contains `{count}`. */
  readonly count: string;
  readonly total: string;
  readonly ekContribution: string;
  /** Why the confirmations are not in EK. */
  readonly waitingTimeFirst: string;
  readonly notPriced: string;
}

/**
 * The note shown when a Trip has SEVERAL confirmations, or null for one or none.
 *
 * Nothing here is calculated: every amount — each confirmation, their total and
 * the EK — is the backend's own figure, only written out. Which of the two the
 * EK is comes from `waitingTimeSupersedesCostConfirmations`, never from a rule
 * repeated here.
 */
export function describeSeveralCostConfirmations(
  trip: TripCostConfirmationFacts,
  words: CostConfirmationNoteWords,
): string | null {
  if (trip.costConfirmations.length < 2) {
    return null;
  }

  const ek =
    trip.ek === null
      ? words.notPriced
      : `${toEuroText(trip.ek)}${trip.waitingTimeSupersedesCostConfirmations ? ` (${words.waitingTimeFirst})` : ""}`;

  return [
    words.count.replace("{count}", String(trip.costConfirmations.length)),
    ...trip.costConfirmations.map(
      (confirmation) => `• ${toCostConfirmationLabel(confirmation)} — ${toEuroText(confirmation.amount)}`,
    ),
    `${words.total}: ${trip.costConfirmationTotal === null ? "—" : toEuroText(trip.costConfirmationTotal)}`,
    `${words.ekContribution}: ${ek}`,
  ].join("\n");
}

/** `68.75` as `€ 68,75`: the fixed-2 string written the way both languages read it. */
function toEuroText(amount: string): string {
  return `€ ${amount.replace(".", ",")}`;
}
