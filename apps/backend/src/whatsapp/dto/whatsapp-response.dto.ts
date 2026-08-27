import { ApiProperty } from "@nestjs/swagger";

import { WhatsAppStatus } from "../whatsapp-sender";

/**
 * What a successful send reports back.
 *
 * The driver's NAME, so the confirmation can say who received it, and the
 * filename, so an operator can tell which document went. Deliberately no phone
 * number: the operator did not supply one, does not need to see one, and a
 * response is logged in more places than a Driver screen is.
 */
export class SendPdfResponseDto {
  @ApiProperty({
    description:
      "Always true. A send that did not happen is an error response, never a success carrying false.",
  })
  delivered!: true;

  @ApiProperty({ example: "Jan Peeters" })
  driverName!: string;

  @ApiProperty({
    example: "transport-order-ANRDUB2602247.pdf",
    description: "The name the document arrived under.",
  })
  filename!: string;
}

export class WhatsAppStatusResponseDto {
  @ApiProperty({
    enum: Object.values(WhatsAppStatus),
    example: WhatsAppStatus.CONNECTED,
  })
  status!: WhatsAppStatus;
}
