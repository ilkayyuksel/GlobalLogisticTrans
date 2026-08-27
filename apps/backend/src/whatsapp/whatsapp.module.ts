import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DriverModule } from "../drivers/driver.module";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentModule } from "../pdf-documents/pdf-document.module";
import { TripModule } from "../trips/trip.module";
import { DisabledWhatsAppSender } from "./disabled-whatsapp-sender";
import { HttpWhatsAppSender } from "./http-whatsapp-sender";
import { TripWhatsAppService } from "./trip-whatsapp.service";
import {
  TripWhatsAppController,
  WhatsAppStatusController,
} from "./whatsapp.controller";
import { WHATSAPP_SENDER, type WhatsAppSender } from "./whatsapp-sender";

/**
 * WhatsApp delivery, kept at arm's length from everything it uses.
 *
 * ── THE ONLY PLACE THE TRANSPORT IS CHOSEN ──────────────────────────────────
 * `WHATSAPP_ENABLED` decides which implementation of `WhatsAppSender` exists,
 * and this factory is the whole of that decision. Nothing downstream branches
 * on the flag: the service asks a sender to send, and a disabled deployment
 * simply has a sender that refuses honestly.
 *
 * When the official WhatsApp Cloud API replaces the unofficial Web transport,
 * the change is a third implementation and one more line here. No Trip code, no
 * controller and no test double moves.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Module({
  imports: [TripModule, DriverModule, PdfDocumentModule],
  controllers: [TripWhatsAppController, WhatsAppStatusController],
  providers: [
    TripWhatsAppService,
    {
      provide: WHATSAPP_SENDER,
      inject: [ConfigService, AppLoggerService],
      useFactory: (
        configService: ConfigService,
        logger: AppLoggerService,
      ): WhatsAppSender =>
        configService.get<boolean>("WHATSAPP_ENABLED")
          ? new HttpWhatsAppSender(configService, logger)
          : new DisabledWhatsAppSender(),
    },
  ],
})
export class WhatsAppModule {}
