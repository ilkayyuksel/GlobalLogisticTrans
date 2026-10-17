/**
 * The place-in-brackets relations the owner has confirmed, for the invoice
 * check's judgement only.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
 * It does NOT make anything match. Route matching belongs to the pricing side
 * (`route-pricing/route-matcher.ts`) and is out of this module's reach. This
 * list answers one narrower question when the invoice check reads a stored
 * snapshot: a Trip to `Rumbeke` was priced on `ROESELARE (RUMBEKE)` — is that a
 * relation the owner stands behind?
 *
 * Only the owner's explicit confirmation of 15 October 2026 is here, as
 * recorded in `common/city-aliases.ts`. Every other "place in brackets" match —
 * a Trip to `Beveren` priced on `Kallo (Beveren)`, a Trip to `Muizen` priced on
 * `MECHELEN (MUIZEN)` — is unconfirmed, and the invoice line is marked for
 * review rather than corrected or settled on that price.
 *
 * A new entry is added only when the owner confirms it.
 */
export interface ApprovedBracketedPlace {
  /** The configured name, place in brackets included. */
  readonly configured: string;
  /** The place a Trip names, which is the one in the brackets. */
  readonly place: string;
}

export const APPROVED_BRACKETED_PLACES: readonly ApprovedBracketedPlace[] = [
  { configured: "ROESELARE (RUMBEKE)", place: "Rumbeke" },
];
