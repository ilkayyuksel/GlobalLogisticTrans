import type { Trip } from "@prisma/client";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { WAITING_NOT_WRITTEN_NOTE } from "../remarks/customer-remark-vocabulary";
import type { RemarkChange } from "../remarks/remark-plan";
import { describeTrip, toDutchDate } from "./advice-words";

/**
 * What a person reading the check must know about one line: what is wrong,
 * what became of the line, and what to do — three separate sentences, never
 * one message glued onto another.
 *
 * ── SHOWN, NEVER DECIDED, HERE ──────────────────────────────────────────────
 * Every piece of advice restates what the match and the Remarks plan already
 * decided. Nothing is matched, priced or corrected again; a line's advice can
 * therefore never disagree with what the corrected document does.
 *
 *   INFO      nothing to do — said so the line is not mistaken for a problem
 *   WARNING   the check changed something, or could not write something; look
 *   ERROR     the line could not be resolved and is marked yellow; act
 */
export const AdviceSeverity = { INFO: "INFO", WARNING: "WARNING", ERROR: "ERROR" } as const;

export type AdviceSeverity = (typeof AdviceSeverity)[keyof typeof AdviceSeverity];

export interface RowAdvice {
  readonly severity: AdviceSeverity;
  /** What is the matter, in a few words. */
  readonly problem: string;
  /** What the check found, and what it did with the line. */
  readonly explanation: string;
  /** What the person should do. */
  readonly action: string;
}

export function adviseRow(
  match: InvoiceRowMatch,
  matches: readonly InvoiceRowMatch[],
  remarks?: RemarkChange,
): RowAdvice[] {
  return [
    ...correctionAdvice(match),
    ...statusAdvice(match, matches),
    ...(remarks?.notes.includes(WAITING_NOT_WRITTEN_NOTE) ? [WAITING_NOT_WRITTEN] : []),
  ];
}

const FOUND = "De rit is gevonden en wordt verder gecontroleerd zoals elke andere regel.";
const WRITTEN_RED = "Het gecorrigeerde Excel-bestand neemt deze waarde al over, in rood.";

function correctionAdvice(match: InvoiceRowMatch): RowAdvice[] {
  const { row } = match;
  const corrected = (problem: string, matchedOn: string, field: string, from: string, to: string): RowAdvice => ({
    severity: AdviceSeverity.WARNING,
    problem,
    explanation: `${matchedOn} komen overeen met één unieke rit in Trano. ${FOUND}`,
    action: `Corrigeer ${field} in Excel van ${from} naar ${to}. ${WRITTEN_RED}`,
  });

  return [
    ...(match.bookingCorrection
      ? [
          corrected(
            "Boekingsnummer komt niet overeen",
            "Datum en containernummer",
            "het boekingsnummer",
            match.bookingCorrection.invoiceBookingNumber,
            match.bookingCorrection.tripBookingNumber,
          ),
        ]
      : []),
    ...(match.containerCorrection
      ? [
          corrected(
            "Containernummer komt niet overeen",
            "Datum en boekingsnummer",
            "het containernummer",
            match.containerCorrection.invoiceContainerNumber || "(leeg)",
            match.containerCorrection.tripContainerNumber,
          ),
        ]
      : []),
    ...(match.dateCorrection
      ? [
          corrected(
            "Datum komt niet overeen",
            "Boekingsnummer en containernummer",
            "de datum",
            toDutchDate(row.planningDate),
            `${toDutchDate(match.dateCorrection.tripPlanningDate)} (de planningsdatum van de gevonden rit)`,
          ),
        ]
      : []),
  ];
}

function statusAdvice(match: InvoiceRowMatch, matches: readonly InvoiceRowMatch[]): RowAdvice[] {
  switch (match.status) {
    case InvoiceRowStatus.NOT_FOUND:
      return [NOT_FOUND];
    case InvoiceRowStatus.AMBIGUOUS:
      return [ambiguous(match.candidates)];
    case InvoiceRowStatus.CONFLICT:
      return [conflict(match, matches)];
    case InvoiceRowStatus.NOT_FINISHED:
      return [notFinished(match.candidates)];
    case InvoiceRowStatus.COST_LINE_UNRESOLVED:
      return [costLineUnresolved(match, matches)];
    case InvoiceRowStatus.ADDED_MISSING:
      return [ADDED_EARLIER];
    default:
      return [];
  }
}

const NOT_FOUND: RowAdvice = {
  severity: AdviceSeverity.ERROR,
  problem: "Geen unieke rit gevonden",
  explanation:
    "Geen enkele rit in Trano deelt minstens twee van de drie identificatievelden (datum, boekingsnummer, containernummer) met deze regel. De regel is niet gecontroleerd en geel gemarkeerd.",
  action:
    "Controleer het boekingsnummer, het containernummer en de datum in Excel. Bestaat de rit niet in Trano, kijk dan na of deze regel wel op de factuur hoort.",
};

function ambiguous(candidates: readonly Trip[]): RowAdvice {
  return {
    severity: AdviceSeverity.ERROR,
    problem: "Meerdere mogelijke ritten",
    explanation: `${candidates.length} ritten in Trano passen bij deze regel: ${candidates.map(describeTrip).join("; ")}. Er is niets gekozen en niets gecorrigeerd; de regel is geel gemarkeerd.`,
    action:
      "Vergelijk de datum, het boekingsnummer en het containernummer in Excel met de vermelde ritten en corrigeer de foutieve waarde in Excel.",
  };
}

function conflict(match: InvoiceRowMatch, matches: readonly InvoiceRowMatch[]): RowAdvice {
  const candidateIds = new Set(match.candidates.map((trip) => trip.id));
  const otherRows = matches
    .filter(
      (other) =>
        other !== match &&
        other.row.costLine === null &&
        [other.trip, ...other.candidates].some((trip) => trip !== null && candidateIds.has(trip.id)),
    )
    .map((other) => other.row.rowNumber);
  const rows = otherRows.length > 0 ? `Excel-rij ${otherRows.join(", ")}` : "een andere Excel-regel";

  return {
    severity: AdviceSeverity.ERROR,
    problem: "Twee Excel-regels verwijzen mogelijk naar dezelfde rit",
    explanation: `Deze regel wijst naar dezelfde Trano-rit als ${rows} (${match.candidates.map(describeTrip).join("; ")}). Er is niets gecorrigeerd; de regel is geel gemarkeerd.`,
    action:
      "Controleer de identificatievelden van beide rijen en corrigeer de foutieve waarde. Als beide regels werkelijk dezelfde rit voorstellen, los het duplicaat expliciet op.",
  };
}

function notFinished(candidates: readonly Trip[]): RowAdvice {
  return {
    severity: AdviceSeverity.WARNING,
    problem: "Rit nog niet afgewerkt",
    explanation: `De rit is gevonden maar is nog niet afgewerkt: ${candidates.map(describeTrip).join("; ")}. De prijs is niet gecontroleerd en de rit wordt niet betaald.`,
    action: "Werk de rit af in Trano als ze uitgevoerd is, en voer de controle daarna opnieuw uit.",
  };
}

/**
 * An EC line whose confirmation could not be linked. Its transport is a
 * separate line: whether THAT was matched is said plainly, because it is the
 * difference between "the transport was checked" and "it was not".
 */
function costLineUnresolved(match: InvoiceRowMatch, matches: readonly InvoiceRowMatch[]): RowAdvice {
  const { row } = match;
  const numbers = row.costLine?.ccNumbers ?? [];
  const transports = matches.filter(
    (other) =>
      other.row.costLine === null &&
      other.trip !== null &&
      (other.row.bookingNumber === row.bookingNumber || other.trip.bookingNumber === row.bookingNumber),
  );
  const tripState =
    transports.length > 0
      ? `De ritmatch is wel succesvol: de rit zelf staat op Excel-rij ${transports.map((other) => other.row.rowNumber).join(", ")} en is daar gewoon gecontroleerd.`
      : `De ritmatch is niet succesvol: op deze factuur is geen gematchte transportregel met boekingsnummer ${row.bookingNumber} gevonden.`;

  return {
    severity: AdviceSeverity.ERROR,
    problem: "EC-kostenbevestiging niet gekoppeld",
    explanation: `${tripState} ${match.problem ?? ""} Alleen het EK-bedrag van deze regel is niet gecontroleerd.`.replace(/\s+/g, " ").trim(),
    action: `Controleer het EC-nummer${numbers.length === 1 ? ` (${numbers[0]})` : ""} en het boekingsnummer van deze regel, en of de bijbehorende kostenbevestiging in Trano bestaat.`,
  };
}

const ADDED_EARLIER: RowAdvice = {
  severity: AdviceSeverity.INFO,
  problem: "Regel toegevoegd door een eerdere controle",
  explanation: "Deze rit ontbrak op de factuur en werd door een eerdere controle toegevoegd. De prijs wordt gecontroleerd zoals bij elke andere regel.",
  action: "Geen actie nodig.",
};

const WAITING_NOT_WRITTEN: RowAdvice = {
  severity: AdviceSeverity.WARNING,
  problem: "Wachttijd niet verwerkt",
  explanation:
    "De wachttijd heeft geen geldig tijdvenster binnen één dag en is daarom niet in de Remarks overgenomen. De prijs van de rit verandert hierdoor niet.",
  action: "Controleer de begin- en eindtijd van de wachttijd in Trano. Corrigeer ze alleen wanneer de brongegevens fout zijn.",
};
