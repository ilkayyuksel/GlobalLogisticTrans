import { ConfigService } from "@nestjs/config";

import { AppLoggerService } from "../logger/app-logger.service";
import { HttpWhatsAppSender } from "./http-whatsapp-sender";
import { DisabledWhatsAppSender } from "./disabled-whatsapp-sender";
import { WhatsAppStatus } from "./whatsapp-sender";

/**
 * The bridge between the browser and the internal WhatsApp service.
 *
 * ── WHY A BRIDGE EXISTS AT ALL ──────────────────────────────────────────────
 * The delivery service publishes no port and sits on an internal Docker
 * network, because the pairing code links a phone to this company's WhatsApp
 * account — a code reachable from the internet would let a stranger link
 * theirs. A browser therefore cannot reach `whatsapp:3200`, and must not be
 * able to. The backend calls it from inside the network, and the existing
 * authenticated session is what stands in front.
 *
 * These tests fix the shape of that relay: what is forwarded, what is refused,
 * and above all what is NEVER allowed through.
 */
const SERVICE_URL = "http://whatsapp:3200";
const SERVICE_TOKEN = "internal-service-token-long-enough";

function buildSender() {
  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === "WHATSAPP_SERVICE_URL" ? SERVICE_URL : SERVICE_TOKEN,
    ),
  } as unknown as ConfigService;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    sender: new HttpWhatsAppSender(
      configService,
      logger as unknown as AppLoggerService,
    ),
    logger,
  };
}

/** Answers as the internal service would, and records how it was called. */
function mockService(status: number, body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  global.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
}

describe("relaying the WhatsApp pairing state", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("how the internal service is called", () => {
    it("asks the configured internal service for /pairing", async () => {
      const fetchMock = mockService(200, {
        status: WhatsAppStatus.PAIRING_REQUIRED,
        qr: "wa-code",
      });
      const { sender } = buildSender();

      await sender.pairing();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("http://whatsapp:3200/pairing");
    });

    /** The service refuses anything without it, and it is never logged. */
    it("presents the shared service token", async () => {
      const fetchMock = mockService(200, {
        status: WhatsAppStatus.CONNECTED,
        qr: null,
      });
      const { sender, logger } = buildSender();

      await sender.pairing();

      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
        authorization: `Bearer ${SERVICE_TOKEN}`,
      });
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain(SERVICE_TOKEN);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        SERVICE_TOKEN,
      );
    });
  });

  describe("what crosses the boundary", () => {
    it("relays the status and the code while pairing is required", async () => {
      mockService(200, {
        status: WhatsAppStatus.PAIRING_REQUIRED,
        qr: "wa-code",
      });
      const { sender } = buildSender();

      await expect(sender.pairing()).resolves.toEqual({
        status: WhatsAppStatus.PAIRING_REQUIRED,
        qr: "wa-code",
      });
    });

    /**
     * The response is rebuilt field by field rather than forwarded, so a field
     * the service adds later cannot leak through by default. This is the test
     * that would fail if somebody replaced the mapping with a spread.
     */
    it("passes nothing but the status and the code", async () => {
      mockService(200, {
        status: WhatsAppStatus.PAIRING_REQUIRED,
        qr: "wa-code",
        creds: { noiseKey: "SECRET-KEY-MATERIAL" },
        sessionDirectory: "/app/session",
        phoneNumber: "+32470112233",
        me: { id: "32470112233@s.whatsapp.net" },
      });
      const { sender } = buildSender();

      const relayed = await sender.pairing();

      expect(Object.keys(relayed).sort()).toEqual(["qr", "status"]);

      const serialised = JSON.stringify(relayed);

      expect(serialised).not.toContain("SECRET-KEY-MATERIAL");
      expect(serialised).not.toContain("/app/session");
      expect(serialised).not.toContain("32470112233");
    });

    /**
     * A code shown during an ordinary reconnect would tell an operator to fetch
     * their phone when waiting a few seconds is all that is needed. The service
     * already guards this; the backend checks it again.
     */
    it.each([
      WhatsAppStatus.CONNECTED,
      WhatsAppStatus.CONNECTING,
      WhatsAppStatus.DISCONNECTED,
      WhatsAppStatus.ERROR,
    ])("withholds a stale code while %s", async (status) => {
      mockService(200, { status, qr: "stale-code" });
      const { sender } = buildSender();

      await expect(sender.pairing()).resolves.toEqual({ status, qr: null });
    });

    it("treats an empty code as no code", async () => {
      mockService(200, { status: WhatsAppStatus.PAIRING_REQUIRED, qr: "" });
      const { sender } = buildSender();

      expect((await sender.pairing()).qr).toBeNull();
    });

    it("treats an unrecognised status as an error, never as connected", async () => {
      mockService(200, { status: "SOMETHING_NEW", qr: "wa-code" });
      const { sender } = buildSender();

      await expect(sender.pairing()).resolves.toEqual({
        status: WhatsAppStatus.ERROR,
        qr: null,
      });
    });
  });

  describe("when the internal service cannot be reached", () => {
    it("reports an error rather than throwing at the controller", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("getaddrinfo ENOTFOUND whatsapp")) as never;
      const { sender } = buildSender();

      await expect(sender.pairing()).resolves.toEqual({
        status: WhatsAppStatus.ERROR,
        qr: null,
      });
    });

    /** A DNS error's message carries the internal hostname. Only the type. */
    it("logs the failure type and never the internal address", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("getaddrinfo ENOTFOUND whatsapp")) as never;
      const { sender, logger } = buildSender();

      await sender.pairing();

      expect(logger.error).toHaveBeenCalled();
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain("ENOTFOUND");
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        "whatsapp:3200",
      );
    });

    it("reports an error when the service refuses the token", async () => {
      mockService(401, { error: "Unauthorised." });
      const { sender } = buildSender();

      await expect(sender.pairing()).resolves.toEqual({
        status: WhatsAppStatus.ERROR,
        qr: null,
      });
    });
  });

  /** A deployment with WhatsApp switched off has nothing to pair against. */
  it("reports DISABLED and no code when WhatsApp is switched off", async () => {
    await expect(new DisabledWhatsAppSender().pairing()).resolves.toEqual({
      status: WhatsAppStatus.DISABLED,
      qr: null,
    });
  });
});
