import { isTrustedSender } from "../imap/trusted-sender";
import { validateEnvironment } from "./environment.variables";

/**
 * The allowlist, as it arrives from the environment.
 *
 * A pattern that would widen the whitelist must stop the application at
 * startup, not at the first email: a system that refuses to boot is noticed,
 * while one quietly trusting the internet is not.
 */

/** Everything else the environment needs, so only the allowlist is under test. */
const BASE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/tms",
  API_PORT: "3000",
  AUTH0_DOMAIN: "example.eu.auth0.com",
  AUTH0_AUDIENCE: "https://traxo-api",
  ENABLE_IMAP: "true",
  IMAP_HOST: "imap.example.test",
  IMAP_PORT: "993",
  IMAP_USERNAME: "orders@example.test",
  IMAP_PASSWORD: "not-a-real-password",
  IMAP_FOLDER: "INBOX",
};

function withSenders(value: string) {
  return () => validateEnvironment({ ...BASE, IMAP_TRUSTED_SENDERS: value });
}

describe("IMAP_TRUSTED_SENDERS", () => {
  it.each([
    ["one exact address", "planning@eucon.nl"],
    ["a domain wildcard", "*@eucon.nl"],
    ["both forms together", "*@eucon.nl,orders@othercompany.be"],
    ["padded entries", "  *@eucon.nl ,  orders@other.be  "],
    ["mixed case", "*@EUCON.NL"],
  ])("accepts %s", (_case, value) => {
    expect(withSenders(value)).not.toThrow();
  });

  it("lowercases and trims what it stores", () => {
    const environment = validateEnvironment({
      ...BASE,
      IMAP_TRUSTED_SENDERS: "  *@EUCON.NL , Orders@Other.BE ",
    });

    expect(environment.IMAP_TRUSTED_SENDERS).toEqual([
      "*@eucon.nl",
      "orders@other.be",
    ]);
  });

  /*
   * Each of these would trust more than one named domain, or reads as though it
   * would. None may reach the matcher.
   */
  it.each([
    ["everything", "*"],
    ["every domain", "*@*"],
    ["a regular expression", ".*eucon.*"],
    ["a wildcarded domain", "*@*.eucon.nl"],
    ["a bare domain", "eucon.nl"],
    ["a partial wildcard", "plan*@eucon.nl"],
    ["one good entry and one dangerous one", "*@eucon.nl,*"],
  ])("refuses %s", (_case, value) => {
    expect(withSenders(value)).toThrow(/IMAP_TRUSTED_SENDERS/);
  });

  /**
   * An empty allowlist is accepted by the configuration and trusts NOBODY.
   *
   * The security requirement is that it is never read as "trust anyone", and
   * that is enforced where it matters — `isTrustedSender` matches an empty list
   * against nothing. Booting is deliberately still allowed: the rest of the
   * application must start even when the mailbox is not configured yet.
   */
  it("accepts an empty allowlist, which then trusts nobody", () => {
    const environment = validateEnvironment({
      ...BASE,
      IMAP_TRUSTED_SENDERS: "",
    });

    expect(environment.IMAP_TRUSTED_SENDERS).toEqual([]);
    expect(isTrustedSender("planning@eucon.nl", [])).toBe(false);
  });

  it("does not require an allowlist when IMAP is off", () => {
    expect(() =>
      validateEnvironment({
        ...BASE,
        ENABLE_IMAP: "false",
        IMAP_TRUSTED_SENDERS: "",
      }),
    ).not.toThrow();
  });
});
