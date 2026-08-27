import { Injectable } from "@nestjs/common";

import {
  SendFailure,
  WhatsAppStatus,
  type SendResult,
  type WhatsAppSender,
} from "./whatsapp-sender";

/**
 * What is injected when `WHATSAPP_ENABLED` is false.
 *
 * ── WHY A REAL OBJECT RATHER THAN NOTHING ───────────────────────────────────
 * A developer with no WhatsApp service running must still be able to start the
 * backend, open the Ritten list and have it behave sensibly. With no provider
 * at all the module would fail to resolve; with a null one every call site would
 * grow a null check. This answers honestly instead: DISABLED, and every send
 * refused without pretending anything was transmitted.
 *
 * DISABLED is deliberately not DISCONNECTED. A disconnected service is expected
 * to come back; a disabled one will not until somebody changes configuration,
 * and the two deserve different sentences on screen.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class DisabledWhatsAppSender implements WhatsAppSender {
  async sendDocument(): Promise<SendResult> {
    return {
      delivered: false,
      failure: SendFailure.NOT_CONNECTED,
      status: WhatsAppStatus.DISABLED,
    };
  }

  async status(): Promise<WhatsAppStatus> {
    return WhatsAppStatus.DISABLED;
  }
}
