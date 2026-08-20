import { Prisma, TripDirection } from "@prisma/client";

import { CreatePdfDocumentData } from "../pdf-documents/pdf-document.repository";

/**
 * Everything one imported transport order asks the Trip domain to write.
 *
 * This is an internal command, not a DTO: it is never bound from a request, so
 * it carries no class-validator decorators and is not documented in Swagger.
 * The values have already been established by the parser and by the importer's
 * own validation before this type is constructed.
 *
 * It carries the two fields `CreateTripDto` deliberately withholds —
 * `tripGroupId`, expressed here as `asCombination`, and `parserMetadata` —
 * because only an import may set them, and keeping them off the public contract
 * is what stops a client from claiming a Trip was parsed when it was typed.
 */
export interface ImportTripsCommand {
  /** The document these Trips came from, written in the same transaction. */
  readonly pdfDocument: CreatePdfDocumentData;

  /**
   * Whether the Trips belong to one Combination.
   *
   * A boolean rather than an id, because the group does not exist yet: it is
   * created inside the transaction only if it is going to be used.
   */
  readonly asCombination: boolean;

  readonly trips: readonly ImportedTripData[];
}

/**
 * One Trip as the parser read it.
 *
 * Times are `HH:mm` strings and the date is `YYYY-MM-DD`, matching the parser's
 * output and the shape `toUtcTime` and `toUtcDate` already accept, so no
 * conversion happens outside the Trip domain.
 */
export interface ImportedTripData {
  readonly bookingNumber: string;
  readonly containerNumber: string | null;
  readonly containerType: string;
  /**
   * Exactly as the PDF named it. Null when the document names none.
   *
   * Stored verbatim: this string IS the Trip's terminal and the key that
   * RoutePricing and RouteCost are configured under, so nothing translates it.
   */
  readonly terminal: string | null;
  readonly destinationCity: string;
  /**
   * Null when the document states no country.
   *
   * Real orders exist that print a city and never name its country, and the
   * number beside it settles nothing — 59554 is Raillencourt-Sainte-Olle in
   * France and Lippstadt in Germany. The column is nullable, so an absent
   * country is stored as absent rather than guessed at.
   */
  readonly destinationCountry: string | null;
  readonly planningDate: string;
  readonly startTime: string | null;
  readonly endTime: string | null;

  /**
   * Which half of the transport this Trip is, as the document stated it.
   *
   * Business data: the Combination export labels a leg's start and end points
   * by it. Null only where a document said nothing.
   */
  readonly direction: TripDirection | null;

  /** Diagnostics only. No business decision may read from this. */
  readonly parserMetadata: Prisma.InputJsonValue;
}
