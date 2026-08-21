import { ApiProperty } from "@nestjs/swagger";

/**
 * A cost Eucon has confirmed for a Trip.
 *
 * Read-only in every sense: there is no create, update or delete endpoint for
 * one. It appears through the Trip it belongs to, and it is written only by the
 * import that read its document.
 */
export class CostConfirmationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    example: "4139505",
    description:
      "Eucon's own number, digits only. The interface shows it as CC4139505; the prefix is presentation, not data.",
  })
  ccNumber!: string;

  @ApiProperty({
    example: "WAIT",
    description:
      "The cost Eucon confirmed. WAIT is waiting time; the field is stored rather than assumed.",
  })
  costCode!: string;

  @ApiProperty({
    example: "27.50",
    description:
      "Fixed-2 decimal STRING, never a number: money is never a float. Confirmed externally and never recalculated here.",
  })
  amount!: string;

  @ApiProperty({ example: "EUR" })
  currency!: string;

  @ApiProperty({
    format: "date-time",
    description: "When the confirmation was issued, as its document states.",
  })
  receivedAt!: Date;

  @ApiProperty({
    format: "uuid",
    description: "The confirmation document, for viewing or download.",
  })
  pdfDocumentId!: string;
}
