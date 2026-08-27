import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  SendFailure,
  WhatsAppStatus,
  type SendDocumentCommand,
  type SendResult,
  type WhatsAppPairing,
  type WhatsAppSender,
} from "./whatsapp-sender";

/**
 * Talks to the WhatsApp delivery service over the internal network.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 * A transport adapter. It converts a domain command into one HTTP call and one
 * HTTP answer back into a domain result. It makes no decisions about Trips,
 * drivers or documents — those were all made before it was called, against the
 * database, where they can be made correctly.
 *
 * ── EVERY FAILURE IS A RESULT, NOT AN EXCEPTION ─────────────────────────────
 * A delivery service that is down, unpaired or unreachable is an ordinary
 * operational state of an unofficial WhatsApp integration, not a bug. Each one
 * becomes a `SendResult` the operator is shown as a sentence. Nothing here
 * retries: a retry that produced a second message would be worse than a failure
 * the operator can see and repeat deliberately.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Long enough for a multi-megabyte PDF on a slow link, short enough to fail. */
const SEND_TIMEOUT_MS = 60_000;
/** A status check is a local call on an internal network. */
const STATUS_TIMEOUT_MS = 5_000;

@Injectable()
export class HttpWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(HttpWhatsAppSender.name);
  }

  async sendDocument(command: SendDocumentCommand): Promise<SendResult> {
    try {
      const response = await this.call(
        "/messages/document",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phoneNumber: command.phoneNumber,
            filename: command.filename,
            caption: command.caption,
            contentBase64: command.content.toString("base64"),
          }),
        },
        SEND_TIMEOUT_MS,
      );

      if (response.ok) {
        return {
          delivered: true,
          failure: null,
          status: WhatsAppStatus.CONNECTED,
        };
      }

      return this.refusedBy(response);
    } catch (error: unknown) {
      /*
       * The service could not be reached — it is down, still starting, or the
       * URL is wrong. Deliberately NOT reported as a send failure: nothing was
       * transmitted, and telling an operator the message failed to send would
       * suggest WhatsApp saw it.
       */
      this.logger.error("The WhatsApp service could not be reached", {
        failure: nameOf(error),
      });

      return {
        delivered: false,
        failure: SendFailure.SERVICE_UNREACHABLE,
        status: WhatsAppStatus.ERROR,
      };
    }
  }

  async status(): Promise<WhatsAppStatus> {
    try {
      const response = await this.call("/status", {}, STATUS_TIMEOUT_MS);

      if (!response.ok) {
        return WhatsAppStatus.ERROR;
      }

      const body: unknown = await response.json();

      return toStatus((body as { status?: unknown }).status);
    } catch {
      // A service that cannot be reached is, from here, indistinguishable from
      // one that is down. Both mean the button must not promise a delivery.
      return WhatsAppStatus.ERROR;
    }
  }

  /**
   * The pairing code, relayed from the internal service.
   *
   * ── WHY THE BACKEND STANDS IN THE MIDDLE ────────────────────────────────
   * The delivery service publishes no port and lives on an internal Docker
   * network, which is what keeps a link-my-phone-to-your-company QR off the
   * internet. A browser cannot resolve `whatsapp:3200` and must not be able
   * to. So the browser asks the backend, the backend asks the service over the
   * internal network, and the authenticated session is checked on the way in.
   *
   * Only `status` and `qr` cross this boundary. The response is rebuilt field
   * by field rather than forwarded, so a future field added to the service's
   * own answer cannot leak through by default.
   */
  async pairing(): Promise<WhatsAppPairing> {
    try {
      const response = await this.call("/pairing", {}, STATUS_TIMEOUT_MS);

      if (!response.ok) {
        return { status: WhatsAppStatus.ERROR, qr: null };
      }

      const body = (await response.json()) as {
        status?: unknown;
        qr?: unknown;
      };
      const status = toStatus(body.status);

      return {
        status,
        /*
         * A QR is offered ONLY while pairing is genuinely required. The service
         * already guards this, and it is checked again here: a stale code shown
         * during an ordinary reconnect would tell an operator to scan when
         * waiting a few seconds is all that is needed.
         */
        qr:
          status === WhatsAppStatus.PAIRING_REQUIRED &&
          typeof body.qr === "string" &&
          body.qr.length > 0
            ? body.qr
            : null,
      };
    } catch (error: unknown) {
      this.logger.error("The WhatsApp service could not be reached for pairing", {
        failure: nameOf(error),
      });

      return { status: WhatsAppStatus.ERROR, qr: null };
    }
  }

  /**
   * Reads the delivery service's refusal.
   *
   * 503 means it never left: the connection was not up. 502 means WhatsApp was
   * asked and did not accept. The two lead to different sentences on screen, so
   * they are kept apart rather than collapsed into "failed".
   */
  private async refusedBy(response: Response): Promise<SendResult> {
    const body = (await response
      .json()
      .catch(() => ({}))) as { status?: unknown };
    const status = toStatus(body.status);

    if (response.status === 503) {
      this.logger.warn("WhatsApp refused a send: not connected", { status });

      return { delivered: false, failure: SendFailure.NOT_CONNECTED, status };
    }

    this.logger.error("WhatsApp did not accept a document", {
      httpStatus: response.status,
      status,
    });

    return { delivered: false, failure: SendFailure.SEND_FAILED, status };
  }

  private call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const baseUrl = this.configService.getOrThrow<string>(
      "WHATSAPP_SERVICE_URL",
    );
    const token = this.configService.getOrThrow<string>(
      "WHATSAPP_SERVICE_TOKEN",
    );

    return fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
}

/** Anything the service did not say clearly is an error, never a success. */
function toStatus(value: unknown): WhatsAppStatus {
  const known = Object.values(WhatsAppStatus) as string[];

  return typeof value === "string" && known.includes(value)
    ? (value as WhatsAppStatus)
    : WhatsAppStatus.ERROR;
}

/** A failure's TYPE for a log line — never its message, which may carry a URL. */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
