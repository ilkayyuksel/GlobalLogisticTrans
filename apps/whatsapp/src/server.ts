import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import {
  WhatsAppStatus,
  WhatsAppUnavailableError,
  type WhatsAppConnection,
} from "./status";

/**
 * The service's only interface: three routes and a health check.
 *
 * ── DELIBERATELY NOT A GENERAL WHATSAPP API ─────────────────────────────────
 * There is no "send to any number" route in the sense that matters: this
 * service holds no phone book, no Trip data and no filesystem access. It
 * receives bytes and a number that the BACKEND derived from a Trip, and it
 * relays them. The trust decision — which driver, which document — is made
 * upstream against the database, where it can be made correctly.
 *
 * ── WHY THE HEALTH CHECK IS UNAUTHENTICATED ─────────────────────────────────
 * Docker's healthcheck has no token, and it must be able to tell "the process
 * is running" from "the process is wedged". It reports exactly that and nothing
 * about WhatsApp — a service that is up but unpaired is healthy, because
 * restarting it would not help.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A PDF the size of a transport order. Anything larger is refused unread. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export interface SendDocumentBody {
  readonly phoneNumber: string;
  readonly filename: string;
  readonly caption: string;
  readonly contentBase64: string;
}

export function createWhatsAppServer(
  connection: WhatsAppConnection,
  serviceToken: string,
): Server {
  return createServer((request, response) => {
    void route(request, response, connection, serviceToken).catch((error) => {
      // Last resort. The message is deliberately generic: an unexpected failure
      // here could carry a stack or a path, and neither belongs in a response.
      sendJson(response, 500, { error: "Internal error." });
      process.stderr.write(`whatsapp: unhandled request failure: ${nameOf(error)}\n`);
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  connection: WhatsAppConnection,
  serviceToken: string,
): Promise<void> {
  const path = (request.url ?? "").split("?")[0];

  if (request.method === "GET" && path === "/health") {
    sendJson(response, 200, { ok: true });

    return;
  }

  if (!isAuthorised(request, serviceToken)) {
    sendJson(response, 401, { error: "Unauthorised." });

    return;
  }

  if (request.method === "GET" && path === "/status") {
    sendJson(response, 200, { status: connection.status() });

    return;
  }

  if (request.method === "GET" && path === "/pairing") {
    sendJson(response, 200, {
      status: connection.status(),
      qr: connection.pendingQrCode(),
    });

    return;
  }

  if (request.method === "POST" && path === "/messages/document") {
    await sendDocument(request, response, connection);

    return;
  }

  sendJson(response, 404, { error: "Unknown route." });
}

async function sendDocument(
  request: IncomingMessage,
  response: ServerResponse,
  connection: WhatsAppConnection,
): Promise<void> {
  let body: SendDocumentBody;

  try {
    body = parseBody(await readBody(request));
  } catch (error: unknown) {
    sendJson(response, 400, { error: messageOf(error) });

    return;
  }

  try {
    await connection.sendDocument({
      phoneNumber: body.phoneNumber,
      filename: body.filename,
      caption: body.caption,
      content: Buffer.from(body.contentBase64, "base64"),
    });

    sendJson(response, 200, { ok: true });
  } catch (error: unknown) {
    /*
     * 503 for "not connected", 502 for a send that was attempted and failed.
     * The distinction is what lets the backend tell an operator whether to wait
     * or to look at the pairing, rather than showing one opaque failure.
     */
    if (error instanceof WhatsAppUnavailableError) {
      sendJson(response, 503, { error: "not_available", status: error.status });

      return;
    }

    process.stderr.write(`whatsapp: send failed: ${nameOf(error)}\n`);
    sendJson(response, 502, {
      error: "send_failed",
      status: WhatsAppStatus.ERROR,
    });
  }
}

/**
 * Constant-time comparison of the bearer token.
 *
 * `===` on a secret leaks its length and its matching prefix through timing.
 * The cost of doing it properly is one function call.
 */
function isAuthorised(request: IncomingMessage, serviceToken: string): boolean {
  const header = request.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(serviceToken);

  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}

function parseBody(raw: string): SendDocumentBody {
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The request body must be a JSON object.");
  }

  const body = parsed as Partial<SendDocumentBody>;

  for (const field of [
    "phoneNumber",
    "filename",
    "caption",
    "contentBase64",
  ] as const) {
    if (typeof body[field] !== "string" || body[field] === "") {
      throw new Error(`Missing or empty field: ${field}`);
    }
  }

  return body as SendDocumentBody;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error("The request body is too large."));
        request.destroy();

        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request was not valid.";
}

/** A failure's TYPE, for a log line. Never its message, which may carry data. */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
