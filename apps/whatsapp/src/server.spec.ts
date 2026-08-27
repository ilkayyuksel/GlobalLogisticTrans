import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createWhatsAppServer } from "./server";
import {
  WhatsAppStatus,
  WhatsAppUnavailableError,
  type SendDocumentRequest,
  type WhatsAppConnection,
} from "./status";

/**
 * The service's HTTP contract, tested against a FAKE connection.
 *
 * No WhatsApp account is involved and none ever should be: CI cannot scan a QR,
 * and a test that needed a real pairing would either be skipped forever or send
 * real messages to real phones. The seam that makes this possible is
 * `WhatsAppConnection` — the same seam that will let the official Cloud API
 * replace Baileys.
 */
const TOKEN = "test-token-that-is-long-enough";

class FakeConnection implements WhatsAppConnection {
  sent: SendDocumentRequest[] = [];
  failWith: Error | null = null;

  constructor(
    private currentStatus: WhatsAppStatus = WhatsAppStatus.CONNECTED,
    private qr: string | null = null,
  ) {}

  status(): WhatsAppStatus {
    return this.currentStatus;
  }

  pendingQrCode(): string | null {
    return this.qr;
  }

  async sendDocument(request: SendDocumentRequest): Promise<void> {
    if (this.failWith) {
      throw this.failWith;
    }

    this.sent.push(request);
  }

  async close(): Promise<void> {}
}

/** Starts the server on an ephemeral port and returns how to reach it. */
async function listening(connection: WhatsAppConnection) {
  const server = createWhatsAppServer(connection, TOKEN);

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const { port } = server.address() as AddressInfo;

  return {
    server,
    async call(
      path: string,
      init: RequestInit & { authorised?: boolean } = {},
    ) {
      const { authorised = true, ...rest } = init;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...rest,
        headers: {
          ...(authorised ? { authorization: `Bearer ${TOKEN}` } : {}),
          ...(rest.headers ?? {}),
        },
      });

      return { status: response.status, body: await response.json() };
    },
  };
}

async function stop(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("the WhatsApp service's HTTP interface", () => {
  let started: Awaited<ReturnType<typeof listening>> | null = null;

  afterEach(async () => {
    if (started) {
      await stop(started.server);
      started = null;
    }
  });

  describe("authentication", () => {
    /** The only route Docker's healthcheck can reach, and it says nothing. */
    it("answers the health check without a token", async () => {
      started = await listening(new FakeConnection());

      const response = await started.call("/health", { authorised: false });

      expect(response).toEqual({ status: 200, body: { ok: true } });
    });

    it.each(["/status", "/pairing"])(
      "refuses %s without a token",
      async (path) => {
        started = await listening(new FakeConnection());

        const response = await started.call(path, { authorised: false });

        expect(response.status).toBe(401);
      },
    );

    /** Sending as the company is the thing a stolen token would buy. */
    it("refuses a send without a token", async () => {
      const connection = new FakeConnection();
      started = await listening(connection);

      const response = await started.call("/messages/document", {
        authorised: false,
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(response.status).toBe(401);
      expect(connection.sent).toHaveLength(0);
    });

    it("refuses a token that is merely a prefix of the real one", async () => {
      started = await listening(new FakeConnection());

      const response = await started.call("/status", {
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.status).toBe(401);
    });
  });

  describe("status and pairing", () => {
    it.each([
      WhatsAppStatus.CONNECTED,
      WhatsAppStatus.CONNECTING,
      WhatsAppStatus.DISCONNECTED,
      WhatsAppStatus.PAIRING_REQUIRED,
      WhatsAppStatus.ERROR,
    ])("reports %s as the connection has it", async (status) => {
      started = await listening(new FakeConnection(status));

      const response = await started.call("/status");

      expect(response.body).toEqual({ status });
    });

    it("returns the pending QR to a caller holding the token", async () => {
      started = await listening(
        new FakeConnection(WhatsAppStatus.PAIRING_REQUIRED, "qr-payload"),
      );

      const response = await started.call("/pairing");

      expect(response.body).toEqual({
        status: WhatsAppStatus.PAIRING_REQUIRED,
        qr: "qr-payload",
      });
    });

    it("returns no QR once the account is paired", async () => {
      started = await listening(new FakeConnection(WhatsAppStatus.CONNECTED));

      const response = await started.call("/pairing");

      expect(response.body).toMatchObject({ qr: null });
    });
  });

  describe("sending a document", () => {
    it("passes the bytes, the filename and the caption through unchanged", async () => {
      const connection = new FakeConnection();
      started = await listening(connection);

      const response = await started.call("/messages/document", {
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(response).toEqual({ status: 200, body: { ok: true } });
      expect(connection.sent).toHaveLength(1);
      expect(connection.sent[0]).toMatchObject({
        phoneNumber: "32470112233",
        filename: "transport-order.pdf",
        caption: "TRANO – Transportorder",
      });
      expect(connection.sent[0].content.toString("utf8")).toBe("%PDF-1.7 fake");
    });

    /** One request, one message. Nothing here retries on the caller's behalf. */
    it("sends exactly once per request", async () => {
      const connection = new FakeConnection();
      started = await listening(connection);

      await started.call("/messages/document", {
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(connection.sent).toHaveLength(1);
    });

    /**
     * 503 says "not connected, nothing was transmitted" — the one outcome the
     * backend must be able to tell an operator to wait on.
     */
    it("answers 503 with the status when WhatsApp is not connected", async () => {
      const connection = new FakeConnection(WhatsAppStatus.PAIRING_REQUIRED);
      connection.failWith = new WhatsAppUnavailableError(
        WhatsAppStatus.PAIRING_REQUIRED,
      );
      started = await listening(connection);

      const response = await started.call("/messages/document", {
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: "not_available",
        status: WhatsAppStatus.PAIRING_REQUIRED,
      });
    });

    it("answers 502 when the send itself failed", async () => {
      const connection = new FakeConnection();
      connection.failWith = new Error("socket closed mid-send");
      started = await listening(connection);

      const response = await started.call("/messages/document", {
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({ error: "send_failed" });
    });

    /** A failure must never carry the library's own words to a client. */
    it("does not leak the underlying error message", async () => {
      const connection = new FakeConnection();
      connection.failWith = new Error("/app/session/creds.json is unreadable");
      started = await listening(connection);

      const response = await started.call("/messages/document", {
        method: "POST",
        body: JSON.stringify(validBody()),
      });

      expect(JSON.stringify(response.body)).not.toContain("/app/session");
    });

    it.each(["phoneNumber", "filename", "caption", "contentBase64"])(
      "refuses a body missing %s",
      async (field) => {
        const connection = new FakeConnection();
        started = await listening(connection);
        const body: Record<string, unknown> = { ...validBody() };
        delete body[field];

        const response = await started.call("/messages/document", {
          method: "POST",
          body: JSON.stringify(body),
        });

        expect(response.status).toBe(400);
        expect(connection.sent).toHaveLength(0);
      },
    );
  });

  it("answers 404 for anything else", async () => {
    started = await listening(new FakeConnection());

    const response = await started.call("/messages/text", { method: "POST" });

    expect(response.status).toBe(404);
  });
});

function validBody() {
  return {
    phoneNumber: "32470112233",
    filename: "transport-order.pdf",
    caption: "TRANO – Transportorder",
    contentBase64: Buffer.from("%PDF-1.7 fake").toString("base64"),
  };
}
