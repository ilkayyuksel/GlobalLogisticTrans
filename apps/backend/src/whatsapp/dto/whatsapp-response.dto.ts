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

/**
 * The pairing state, for the administration screen.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * The session keys, the credentials, the private keys, the storage path and the
 * account's own phone number. None of them is needed to scan a code, and all of
 * them would be a far worse thing to expose than the code itself.
 *
 * The QR is a short-lived pairing CHALLENGE — it expires within seconds and
 * WhatsApp reissues it. It is still returned only to an authenticated TRANO
 * user: whoever scans it links a phone to this company's WhatsApp account.
 */
export class WhatsAppPairingResponseDto {
  @ApiProperty({
    enum: Object.values(WhatsAppStatus),
    example: WhatsAppStatus.PAIRING_REQUIRED,
  })
  status!: WhatsAppStatus;

  @ApiProperty({
    nullable: true,
    description:
      "The code to render as a QR, or null. Present only while the status is PAIRING_REQUIRED — never during an ordinary reconnect, where scanning is not what is needed.",
  })
  qr!: string | null;
}
