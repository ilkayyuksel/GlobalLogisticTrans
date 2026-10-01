import { validateEnvironment } from "./environment.variables";

/**
 * The failure forward's settings, as they arrive from the environment.
 *
 * Off by default, so a developer with no outgoing mailbox still starts the
 * backend. Switched on, every setting the forward needs is demanded at boot —
 * a credential discovered missing on the first broken order would mean that
 * order's alert silently never arrived.
 */

const BASE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/tms",
  API_PORT: "3000",
  AUTH0_DOMAIN: "example.eu.auth0.com",
  AUTH0_AUDIENCE: "https://traxo-api",
};

const COMPLETE = {
  ENABLE_IMPORT_FAILURE_FORWARD: "true",
  IMPORT_FAILURE_FORWARD_TO: "info@iytechsolutions.be",
  SMTP_HOST: "smtp.example.test",
  SMTP_USERNAME: "trano@example.test",
  SMTP_PASSWORD: "not-a-real-password",
  SMTP_FROM: "trano@example.test",
};

describe("ENABLE_IMPORT_FAILURE_FORWARD", () => {
  it("is off when not set, and then needs no SMTP settings", () => {
    const environment = validateEnvironment({ ...BASE });

    expect(environment.ENABLE_IMPORT_FAILURE_FORWARD).toBe(false);
  });

  it("starts when every setting is present", () => {
    const environment = validateEnvironment({ ...BASE, ...COMPLETE });

    expect(environment).toMatchObject({
      ENABLE_IMPORT_FAILURE_FORWARD: true,
      IMPORT_FAILURE_FORWARD_TO: "info@iytechsolutions.be",
      // STARTTLS on the submission port unless told otherwise.
      SMTP_PORT: 587,
      SMTP_SECURE: false,
    });
  });

  it.each([
    "IMPORT_FAILURE_FORWARD_TO",
    "SMTP_HOST",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ])("refuses to start without %s once switched on", (missing) => {
    const settings: Record<string, string> = { ...BASE, ...COMPLETE };
    delete settings[missing];

    expect(() => validateEnvironment(settings)).toThrow(missing);
  });

  it.each(["IMPORT_FAILURE_FORWARD_TO", "SMTP_FROM"])(
    "refuses an %s that is not an email address",
    (setting) => {
      expect(() =>
        validateEnvironment({ ...BASE, ...COMPLETE, [setting]: "not-an-address" }),
      ).toThrow(setting);
    },
  );

  it("accepts implicit TLS on 465", () => {
    expect(
      validateEnvironment({
        ...BASE,
        ...COMPLETE,
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
      }),
    ).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });
});
