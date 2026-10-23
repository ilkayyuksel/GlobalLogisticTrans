import { NO_CONFIRMATION_FOUND } from "./cost-line-matching";
import { InvoiceRowStatus, type InvoiceRowMatch } from "./invoice-row-match";
import { describeTrip } from "./trip-words";

/**
 * The existing warning of a line the match could not resolve, explained: what
 * was tried and why it found no Trip, or which Trips it could not choose
 * between. A line that WAS matched gets no explanation — its status and its
 * correction notes say it already.
 *
 * ── AN EC LINE: THE TRANSPORT AND THE CONFIRMATION APART ────────────────────
 * Whether the transport an EC line is about was found, and on which row of
 * the invoice it stands, is said beside the confirmation that was not — so a
 * missing confirmation is never read as a failed transport match.
 *
 * Nothing is matched again here; this words what the match decided.
 */
export function withExplanations(matches: readonly InvoiceRowMatch[]): InvoiceRowMatch[] {
  return matches.map((match) => {
    const explanation = explain(match, matches);

    return explanation === null
      ? match
      : { ...match, problem: [match.problem, explanation].filter(Boolean).join(" ") };
  });
}

const ALL_PAIRS_TRIED =
  "Gecontroleerd: boekingsnummer + datum, containernummer + datum en boekingsnummer + containernummer.";

function explain(match: InvoiceRowMatch, matches: readonly InvoiceRowMatch[]): string | null {
  switch (match.status) {
    case InvoiceRowStatus.NOT_FOUND:
      return `${ALL_PAIRS_TRIED} Geen enkele rit in Trano deelt minstens twee van deze drie waarden met de regel.`;
    case InvoiceRowStatus.AMBIGUOUS:
      return `${match.candidates.length} ritten passen bij deze regel en er is niet gekozen: ${match.candidates
        .map(describeTrip)
        .join("; ")}.`;
    case InvoiceRowStatus.COST_LINE_UNRESOLVED:
      return match.problem?.startsWith(NO_CONFIRMATION_FOUND) ? explainCostLineTransport(match, matches) : null;
    default:
      return null;
  }
}

function explainCostLineTransport(match: InvoiceRowMatch, matches: readonly InvoiceRowMatch[]): string {
  const [trip] = match.candidates;

  if (trip === undefined) {
    return "Ook de rit zelf is niet gevonden.";
  }

  const ownRows = matches
    .filter((other) => other.row.costLine === null && other.trip?.id === trip.id)
    .map((other) => other.row.rowNumber);

  return ownRows.length > 0
    ? `De rit zelf is wel gematcht (Excel-rij ${ownRows.join(", ")}); alleen het EK-bedrag van deze regel is niet gecontroleerd.`
    : `De rit zelf is wel gevonden (${describeTrip(trip)}), maar staat niet als transportregel op deze factuur; hij wordt beoordeeld als ontbrekende rit.`;
}
