import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * What a document did to this Trip.
 *
 * The action is a FACT recorded at the time, never inferred from a filename:
 * NEW is the document the Trip was created from, UPDATE and CANCEL are the
 * events the audit trail holds.
 */
export const TripDocumentAction = {
  New: "NEW",
  Update: "UPDATE",
  Cancel: "CANCEL",
  CostConfirmation: "COST_CONFIRMATION",
} as const;

export type TripDocumentAction =
  (typeof TripDocumentAction)[keyof typeof TripDocumentAction];

/**
 * One document in a Trip's history.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * `storagePath` — a filesystem location no client may learn or construct.
 * The email body, its Message-ID and `parserMetadata` — internal, and none of
 * them helps anyone identify a document. What identifies one is its action, its
 * filename and the moment it arrived, and those are what is here.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class TripDocumentDto {
  @ApiProperty({
    format: "uuid",
    description: "Pass to GET /pdf-documents/{id}/content to view or download.",
  })
  pdfDocumentId!: string;

  @ApiProperty({ enum: Object.values(TripDocumentAction) })
  action!: TripDocumentAction;

  @ApiProperty({ example: "transportorder1370334.pdf" })
  originalFilename!: string;

  @ApiProperty({
    format: "date-time",
    description:
      "When this document acted on the Trip: the event time for an UPDATE or CANCEL, the upload time for the original order.",
  })
  occurredAt!: Date;

  @ApiProperty({
    type: [String],
    description:
      "The fields this document moved. Empty for a NEW or CANCEL document, and empty for an UPDATE that changed nothing.",
    example: ["containerNumber"],
  })
  changedFields!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      "What became of the document in one sentence — including why it was not applied, when it was not.",
  })
  outcome!: string | null;

  @ApiProperty({
    description:
      "False when the document arrived but changed nothing on this Trip: an update after cancellation, a repeated cancellation, or a new order for a booking number already held.",
  })
  applied!: boolean;

  @ApiProperty({
    description:
      "True when this document CREATED the Trip. An UPDATE for a booking nobody held creates one, and that is a different fact from an update applied to a Trip that already existed.",
  })
  createdTrip!: boolean;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class TripDocumentsDto {
  @ApiProperty({
    type: [TripDocumentDto],
    description: "Newest first. The original order is always last.",
  })
  items!: TripDocumentDto[];
}
