import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLoggerService } from "../logger/app-logger.service";
import { SmtpMailClient } from "./smtp-mail.client";

/**
 * The outgoing mail boundary, with nodemailer replaced at its edge.
 *
 * What matters here is what is handed to the transport — above all that a
 * password can never travel in the clear — and that a connection is closed
 * whether the send worked or not.
 */

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

const SETTINGS: Record<string, unknown> = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USERNAME: "trano@example.test",
  SMTP_PASSWORD: "not-a-real-password",
  SMTP_FROM: "trano@example.test",
};

function clientWith(overrides: Record<string, unknown> = {}) {
  const values = { ...SETTINGS, ...overrides };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const client = new SmtpMailClient(
    { getOrThrow: (key: string) => values[key] } as unknown as ConfigService,
    logger as unknown as AppLoggerService,
  );

  return { client, logger };
}

const MESSAGE = {
  to: "info@iytechsolutions.be",
  subject: "[TRANO IMPORT ERROR] NEW: [DEL] Quay 869 - COULOGNE",
  text: "Trano kon een e-mail niet verwerken.",
  attachments: [
    {
      filename: "origineel-bericht.eml",
      content: Buffer.from("Subject: original\r\n\r\nbody"),
      contentType: "message/rfc822",
    },
  ],
};

describe("SmtpMailClient", () => {
  let transport: { sendMail: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    transport = {
      sendMail: jest.fn().mockResolvedValue({ messageId: "<sent@trano>" }),
      close: jest.fn(),
    };
    createTransport.mockReset().mockReturnValue(transport);
  });

  it("sends from the system's own address", async () => {
    await clientWith().client.send(MESSAGE);

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "trano@example.test",
        to: "info@iytechsolutions.be",
        subject: MESSAGE.subject,
        text: MESSAGE.text,
      }),
    );
  });

  it("hands the original over as an attached message, unchanged", async () => {
    await clientWith().client.send(MESSAGE);

    const sent = transport.sendMail.mock.calls[0][0];

    expect(sent.attachments).toEqual([
      {
        filename: "origineel-bericht.eml",
        content: MESSAGE.attachments[0].content,
        contentType: "message/rfc822",
      },
    ]);
  });

  /** STARTTLS is REQUIRED on 587, so a password never crosses in plain text. */
  it("requires STARTTLS when the connection is not implicitly encrypted", async () => {
    await clientWith().client.send(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        port: 587,
        secure: false,
        requireTLS: true,
      }),
    );
  });

  it("uses implicit TLS on 465 without asking for an upgrade", async () => {
    await clientWith({ SMTP_PORT: 465, SMTP_SECURE: true }).client.send(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false }),
    );
  });

  it("closes the connection after sending", async () => {
    await clientWith().client.send(MESSAGE);

    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  /** The caller decides what a failure means; the connection is closed anyway. */
  it("closes the connection and rethrows when the server refuses", async () => {
    transport.sendMail.mockRejectedValue(new Error("535 authentication failed"));

    await expect(clientWith().client.send(MESSAGE)).rejects.toThrow(
      "535 authentication failed",
    );
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  /** The log names a domain and a count — never a password, subject or body. */
  it("logs no credential and no message content", async () => {
    const { client, logger } = clientWith();

    await client.send(MESSAGE);

    const logged = JSON.stringify([logger.log.mock.calls, logger.warn.mock.calls]);

    expect(logged).not.toContain("not-a-real-password");
    expect(logged).not.toContain("COULOGNE");
    expect(logged).not.toContain("Trano kon");
    expect(logged).toContain("iytechsolutions.be");
  });
});
