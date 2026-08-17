import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { TripResponseDto } from "../../trips/dto/trip-response.dto";
import { CancelledBooking } from "../pdf-trip-importer.service";
import { UploadFailure } from "../upload-failure";

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

  @ApiProperty({ description: "Whether this file produced Trips." })
  ok!: boolean;

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
  return { filename, ok: true, trips, combination };
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
    trips: [],
    combination: false,
    cancellations: [...cancellations],
  };
}

export function refusedFileResult(
  filename: string,
  failure: UploadFailure,
): PdfImportFileResultDto {
  return {
    filename,
    ok: false,
    code: failure.code,
    message: failure.message,
  };
}
