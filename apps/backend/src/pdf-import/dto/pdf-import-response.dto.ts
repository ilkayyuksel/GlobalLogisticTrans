import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { TripResponseDto } from "../../trips/dto/trip-response.dto";
import {
  CancelledBooking,
  ConfirmedCost,
} from "../pdf-trip-importer.service";
import { UploadFailure } from "../upload-failure";

/**
 * Which family of document an uploaded file turned out to be.
 *
 * A manual upload accepts both, and they produce entirely different outcomes: a
 * transport order creates Trips, a cost confirmation attaches money to a Trip
 * that already exists and creates nothing. A caller that assumed every upload
 * was an order would report "0 Trips imported" for a confirmation that was in
 * fact recorded perfectly.
 *
 * It is present on a FAILURE too, so a refusal can be phrased in the terms of
 * the document the operator actually sent.
 */
export const UploadedDocumentKind = {
  TRANSPORT_ORDER: "TRANSPORT_ORDER",
  COST_CONFIRMATION: "COST_CONFIRMATION",
} as const;

export type UploadedDocumentKind =
  (typeof UploadedDocumentKind)[keyof typeof UploadedDocumentKind];

/**
 * What one uploaded file produced.
 *
 * The request succeeds as a whole and reports per file, because a batch of
 * transport orders is a batch of independent documents: one unreadable scan
 * must not discard the four good orders sent with it. `ok` is the discriminator
 * — `trips` and `combination` accompany a success, `code` and `message` a
 * failure — and no field carries anything internal: no path, no stack, no
 * parser state, and never the bytes.
 */
export class PdfImportFileResultDto {
  @ApiProperty({
    example: "transport-order.pdf",
    description: "The name the client sent, echoed so results can be matched.",
  })
  filename!: string;

  @ApiProperty({ description: "Whether this file was processed successfully." })
  ok!: boolean;

  @ApiProperty({
    enum: Object.values(UploadedDocumentKind),
    description:
      "Which family of document this file turned out to be. TRANSPORT_ORDER creates Trips; COST_CONFIRMATION attaches a confirmed cost to a Trip that already exists and creates none. Present on a failure too, so a refusal reads in the terms of the document that was sent.",
  })
  kind!: UploadedDocumentKind;

  @ApiPropertyOptional({
    type: [TripResponseDto],
    description:
      "The Trips created from this file, OPEN and unpriced. Present only when ok is true.",
  })
  trips?: TripResponseDto[];

  @ApiPropertyOptional({
    description:
      "True when the file was one Combination: two Trips under one TripGroup, each keeping its own booking number. Present only when ok is true.",
  })
  combination?: boolean;

  @ApiPropertyOptional({
    example: [{ bookingNumber: "ANRBEL2772352", outcome: "CANCELLED" }],
    description:
      "Present when the document stamped itself CANCELLED. One entry per booking it names, with what happened to the Trip holding it: CANCELLED (an OPEN Trip was cancelled), ALREADY_CANCELLED, REFUSED_CLOSED (finished work is never rewritten) or NO_MATCHING_TRIP. A cancelled document creates no Trip, so trips is empty.",
  })
  cancellations?: CancelledBooking[];

  @ApiPropertyOptional({
    example: [
      {
        ccNumber: "4156173",
        bookingNumber: "ANRDUB2794719",
        tripId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        amount: "68.75",
        currency: "EUR",
        outcome: "RECORDED",
      },
    ],
    description:
      "What a COST_CONFIRMATION file recorded: the confirmation number, the booking it named, the Trip it was attached to and the amount. RECORDED is the first time; ALREADY_RECORDED is the same confirmation arriving again, which changes nothing. Creates no Trip, so trips is empty.",
  })
  costConfirmations?: ConfirmedCost[];

  @ApiPropertyOptional({
    example: "IMPORT_UNREADABLE_PDF",
    description:
      "Stable identifier of the failure, for matching rather than display. Present only when ok is false.",
  })
  code?: string;

  @ApiPropertyOptional({
    description:
      "Why this file was refused, phrased for an operator. Present only when ok is false.",
  })
  message?: string;
}

export class PdfImportResponseDto {
  @ApiProperty({
    type: [PdfImportFileResultDto],
    description: "One entry per uploaded file, in the order they were sent.",
  })
  results!: PdfImportFileResultDto[];
}

export function importedFileResult(
  filename: string,
  trips: TripResponseDto[],
  combination: boolean,
): PdfImportFileResultDto {
  return {
    filename,
    ok: true,
    kind: UploadedDocumentKind.TRANSPORT_ORDER,
    trips,
    combination,
  };
}

/**
 * A cost confirmation was read and applied.
 *
 * `trips` is empty and `combination` is false, and both are stated rather than
 * omitted: a confirmation attaches money to a Trip that already exists, and a
 * caller must not have to infer "created nothing" from a missing field.
 */
export function costConfirmationFileResult(
  filename: string,
  costConfirmations: readonly ConfirmedCost[],
): PdfImportFileResultDto {
  return {
    filename,
    ok: true,
    kind: UploadedDocumentKind.COST_CONFIRMATION,
    trips: [],
    combination: false,
    costConfirmations: [...costConfirmations],
  };
}

/**
 * A cancelled document was handled. `ok` is true — the file was read and its
 * instruction carried out — and `trips` is empty, because a cancellation
 * cancels rather than creates.
 */
export function cancelledFileResult(
  filename: string,
  cancellations: readonly CancelledBooking[],
): PdfImportFileResultDto {
  return {
    filename,
    ok: true,
    kind: UploadedDocumentKind.TRANSPORT_ORDER,
    trips: [],
    combination: false,
    cancellations: [...cancellations],
  };
}

/**
 * A file that was refused.
 *
 * The kind defaults to a transport order, which is what a file is until
 * something identifies it otherwise — a document too broken to read is not a
 * cost confirmation just because it might have been one. The cost-confirmation
 * path passes its own kind so its refusals read in the operator's terms.
 */
export function refusedFileResult(
  filename: string,
  failure: UploadFailure,
  kind: UploadedDocumentKind = UploadedDocumentKind.TRANSPORT_ORDER,
): PdfImportFileResultDto {
  return {
    filename,
    ok: false,
    kind,
    code: failure.code,
    message: failure.message,
  };
}
