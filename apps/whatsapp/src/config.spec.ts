import { ConfigurationError, readConfig } from "./config";
import { toJid } from "./jid";

/**
 * Configuration is refused rather than defaulted where a wrong value would be
 * dangerous. The service token is the whole of the service's access control, so
 * a missing or short one stops the process instead of starting an open one.
 */
const VALID_TOKEN = "a-service-token-long-enough-to-pass";

describe("reading the service configuration", () => {
  it("accepts a complete environment", () => {
    expect(
      readConfig({
        WHATSAPP_SERVICE_TOKEN: VALID_TOKEN,
        WHATSAPP_PORT: "3200",
        WHATSAPP_SESSION_DIR: "/app/session",
      }),
    ).toEqual({
      port: 3200,
      sessionDirectory: "/app/session",
      serviceToken: VALID_TOKEN,
    });
  });

  it("refuses a missing token", () => {
    expect(() => readConfig({})).toThrow(ConfigurationError);
  });

  /** A short token is a guessable one, and this endpoint sends as the company. */
  it("refuses a token that is too short", () => {
    expect(() => readConfig({ WHATSAPP_SERVICE_TOKEN: "short" })).toThrow(
      ConfigurationError,
    );
  });

  it("refuses a token that is only whitespace", () => {
    expect(() =>
      readConfig({ WHATSAPP_SERVICE_TOKEN: "                              " }),
    ).toThrow(ConfigurationError);
  });

  it("falls back to the container defaults for port and session directory", () => {
    const config = readConfig({ WHATSAPP_SERVICE_TOKEN: VALID_TOKEN });

    expect(config.port).toBe(3200);
    expect(config.sessionDirectory).toBe("/app/session");
  });

  it.each(["0", "70000", "not-a-port"])("refuses port %s", (port) => {
    expect(() =>
      readConfig({ WHATSAPP_SERVICE_TOKEN: VALID_TOKEN, WHATSAPP_PORT: port }),
    ).toThrow(ConfigurationError);
  });

  /**
   * There is deliberately no configured phone number: the account is whichever
   * one scanned the QR, and the session on disk is the identity.
   */
  it("reads no phone number from the environment", () => {
    const config = readConfig({
      WHATSAPP_SERVICE_TOKEN: VALID_TOKEN,
      WHATSAPP_PHONE_NUMBER: "+32470112233",
    });

    expect(JSON.stringify(config)).not.toContain("32470112233");
  });
});

describe("addressing a phone number", () => {
  it("builds the individual-chat JID WhatsApp expects", () => {
    expect(toJid("32470112233")).toBe("32470112233@s.whatsapp.net");
  });
});
