import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";

import { TripIdParamDto } from "../trips/dto/trip-id-param.dto";
import { SendPdfResponseDto, WhatsAppStatusResponseDto } from "./dto/whatsapp-response.dto";
import { TripWhatsAppService } from "./trip-whatsapp.service";

/**
 * Sending one Trip's transport order to its own driver.
 *
 * ── WHY THIS HANGS OFF A TRIP AND NOT OFF WHATSAPP ──────────────────────────
 * There is deliberately no `POST /whatsapp/send` taking a phone number and a
 * file. Such an endpoint would let any authenticated caller message any number
 * with any bytes, and every safeguard in this module — the right driver, the
 * right document, a Trip that may be sent for at all — would become advice
 * rather than a rule.
 *
 * The request names a Trip. Everything else is derived from the database.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Authentication is the application's existing global access-token guard; this
 * controller adds no exemption, so an unauthenticated request never arrives.
 */
@ApiTags("WhatsApp")
@Controller("trips")
export class TripWhatsAppController {
  constructor(private readonly tripWhatsAppService: TripWhatsAppService) {}

  /*
   * 200 rather than 201: nothing was created. A message was relayed, and the
   * response describes an event rather than a new resource with a location.
   */
  @Post(":id/whatsapp/send-pdf")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Send this Trip's transport order to its driver over WhatsApp",
    description:
      "Sends the latest applied UPDATE document, or the original NEW order when there is no UPDATE, as a PDF attachment to the Trip's effective driver. A CANCEL and a cost confirmation are never sent. The Trip is not modified in any way, whether the send succeeds or fails, and nothing is sent automatically — this endpoint is the only trigger.",
  })
  @ApiOkResponse({ type: SendPdfResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiUnprocessableEntityResponse({
    description:
      "The Trip cannot be sent for: no driver, no usable phone number, no transport document, or a status that is not part of the planning.",
  })
  @ApiServiceUnavailableResponse({
    description: "WhatsApp is not connected. Nothing was transmitted.",
  })
  @ApiBadGatewayResponse({
    description:
      "The document could not be read, or WhatsApp did not accept it. Nothing was delivered.",
  })
  sendPdf(@Param() params: TripIdParamDto): Promise<SendPdfResponseDto> {
    return this.tripWhatsAppService.sendTransportDocument(params.id);
  }
}

/**
 * Whether WhatsApp can currently deliver anything.
 *
 * Read by the Ritten list so the send button can refuse cleanly and say why,
 * rather than letting an operator discover the outage by pressing it. It
 * reports a state and never a credential: no session data, no QR, no number.
 */
@ApiTags("WhatsApp")
@Controller("whatsapp")
export class WhatsAppStatusController {
  constructor(private readonly tripWhatsAppService: TripWhatsAppService) {}

  @Get("status")
  @ApiOperation({
    summary: "Whether WhatsApp is available for sending",
    description:
      "CONNECTED means a send can be attempted. PAIRING_REQUIRED means an administrator has to link the account again. DISABLED means WhatsApp is switched off in this environment.",
  })
  @ApiOkResponse({ type: WhatsAppStatusResponseDto })
  async status(): Promise<WhatsAppStatusResponseDto> {
    return { status: await this.tripWhatsAppService.status() };
  }
}
