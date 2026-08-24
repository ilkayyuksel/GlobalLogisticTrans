import {
  domainOf,
  isTrustedSender,
  isTrustedSenderPattern,
} from "./trusted-sender";

/**
 * The mailbox whitelist.
 *
 * A trusted sender can create Trips by emailing a PDF, so most of these tests
 * are about what must be REFUSED. The lookalike domains matter most: they are
 * what a careless `endsWith` implementation would accept, and they are exactly
 * what an attacker would register.
 */

describe("an exact address entry", () => {
  const ALLOWED = ["planning@eucon.nl"];

  it("accepts that one address", () => {
    expect(isTrustedSender("planning@eucon.nl", ALLOWED)).toBe(true);
  });

  /** Backward compatibility: an exact entry stays exact, never a domain. */
  it("accepts nothing else at the same domain", () => {
    expect(isTrustedSender("orders@eucon.nl", ALLOWED)).toBe(false);
    expect(isTrustedSender("john.doe@eucon.nl", ALLOWED)).toBe(false);
  });

  it("accepts a dotted local part when that is what was configured", () => {
    expect(isTrustedSender("john.doe@eucon.nl", ["john.doe@eucon.nl"])).toBe(
      true,
    );
  });
});

describe("a domain wildcard entry", () => {
  const ALLOWED = ["*@eucon.nl"];

  it.each(["planning@eucon.nl", "orders@eucon.nl", "john.doe@eucon.nl"])(
    "accepts %s",
    (sender) => {
      expect(isTrustedSender(sender, ALLOWED)).toBe(true);
    },
  );

  /**
   * ── THE LOOKALIKES ────────────────────────────────────────────────────────
   * Every address below ends with the string "eucon.nl" somewhere, and none of
   * them is at the domain eucon.nl. A suffix test would trust all of them.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it.each([
    ["a different domain", "planning@other.nl"],
    ["a domain that merely starts with it", "planning@eucon.nl.evil.com"],
    ["a subdomain", "planning@sub.eucon.nl"],
    ["a domain that ends with it", "planning@notreallyeucon.nl"],
    ["no address at all", "eucon.nl"],
    ["no local part", "@eucon.nl"],
    ["two at-signs", "planning@eucon.nl@evil.com"],
    ["nothing", ""],
  ])("refuses %s", (_case, sender) => {
    expect(isTrustedSender(sender, ALLOWED)).toBe(false);
  });

  it("matches the domain by equality, not by suffix", () => {
    // Stated as its own test because it is the whole point of the format.
    expect(isTrustedSender("planning@x-eucon.nl", ALLOWED)).toBe(false);
    expect(isTrustedSender("planning@eucon.nls", ALLOWED)).toBe(false);
  });
});

describe("normalisation", () => {
  it("matches case-insensitively on both sides", () => {
    expect(isTrustedSender("Planning@EUCON.NL", ["*@eucon.nl"])).toBe(true);
    expect(isTrustedSender("planning@eucon.nl", ["*@EUCON.NL"])).toBe(true);
    expect(isTrustedSender("PLANNING@EUCON.NL", ["Planning@Eucon.NL"])).toBe(
      true,
    );
  });

  it("ignores whitespace around a configured entry", () => {
    expect(isTrustedSender("planning@eucon.nl", ["  *@eucon.nl  "])).toBe(true);
  });

  it("ignores whitespace around the sender", () => {
    expect(isTrustedSender("  planning@eucon.nl ", ["*@eucon.nl"])).toBe(true);
  });
});

describe("several entries", () => {
  const ALLOWED = ["*@eucon.nl", "orders@other.be"];

  it("accepts a sender matching the wildcard entry", () => {
    expect(isTrustedSender("anyone@eucon.nl", ALLOWED)).toBe(true);
  });

  it("accepts a sender matching the exact entry", () => {
    expect(isTrustedSender("orders@other.be", ALLOWED)).toBe(true);
  });

  it("refuses a sender matching neither", () => {
    expect(isTrustedSender("planning@other.be", ALLOWED)).toBe(false);
  });
});

/**
 * An empty allowlist trusts NOBODY. A system importing nothing is a visible
 * fault; one importing from anyone is an invisible one.
 */
describe("an empty allowlist", () => {
  it.each(["planning@eucon.nl", "anyone@anywhere.com", ""])(
    "refuses %p",
    (sender) => {
      expect(isTrustedSender(sender, [])).toBe(false);
    },
  );
});

describe("which patterns the configuration accepts", () => {
  it.each([
    "planning@eucon.nl",
    "*@eucon.nl",
    "john.doe@sub.eucon.nl",
    "*@sub.eucon.nl",
    // The substring form. A bare domain is one too: written without an `@` it
    // asks for "any address containing this", which is what it looks like.
    "eucon",
    "eucon.nl",
    "eucon-transport",
  ])("accepts %p", (entry) => {
    expect(isTrustedSenderPattern(entry)).toBe(true);
  });

  /*
   * Too short to be an allowlist. Two characters occur in almost every address,
   * so such an entry would trust the internet while looking like a rule.
   */
  it.each(["a", "eu", "n"])("refuses %p as too short a substring", (entry) => {
    expect(isTrustedSenderPattern(entry)).toBe(false);
  });

  /*
   * Refused at startup, so a pattern that would widen the whitelist beyond one
   * named domain can never reach the matcher.
   */
  it.each([
    ["everything", "*"],
    ["every domain", "*@*"],
    ["a regular expression", ".*eucon.*"],
    ["a wildcarded domain", "*@*.eucon.nl"],
    ["no local part", "@eucon.nl"],
    ["no domain", "planning@"],
    ["a single-label domain", "planning@localhost"],
    ["a partial wildcard", "plan*@eucon.nl"],
    ["nothing", ""],
    ["whitespace", "   "],
  ])("refuses %s", (_case, entry) => {
    expect(isTrustedSenderPattern(entry)).toBe(false);
  });

  it("refuses a value that is not a string at all", () => {
    expect(isTrustedSenderPattern(undefined)).toBe(false);
    expect(isTrustedSenderPattern(42)).toBe(false);
  });
});

describe("what may be logged", () => {
  it("reports the domain of a sender", () => {
    expect(domainOf("Planning@EUCON.NL")).toBe("eucon.nl");
  });

  it("reports nothing for something that is not an address", () => {
    expect(domainOf("eucon.nl")).toBeNull();
  });
});

/**
 * ── ANY ADDRESS CONTAINING THE CONFIGURED TEXT ──────────────────────────────
 * The sender does not use one domain. Orders arrive from `eucon.nl`, from other
 * domains carrying the same name, and from addresses where `eucon` is the local
 * part — so the allowlist can name the SENDER rather than a list of domains
 * nobody can keep complete.
 *
 * Literal, never a pattern: `eurocon` does not contain `eucon`, and that is the
 * whole of the rule.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("a substring entry", () => {
  const trusted = ["eucon"];

  it.each([
    ["the original domain", "planning@eucon.nl"],
    ["another domain carrying the name", "planning@euconxx.com"],
    ["another country", "info@eucon.be"],
    ["the name as the local part", "eucon@example.com"],
    ["a subdomain", "orders@mail.eucon.nl"],
    ["a hyphenated domain", "planning@eucon-transport.com"],
  ])("accepts %s", (_case, sender) => {
    expect(isTrustedSender(sender, trusted)).toBe(true);
  });

  it("matches whatever the capitals are on either side", () => {
    expect(isTrustedSender("Info@EUCON.be", trusted)).toBe(true);
    expect(isTrustedSender("planning@eucon.nl", ["EUCON"])).toBe(true);
    expect(isTrustedSender("PLANNING@EuConXX.CoM", ["eUcOn"])).toBe(true);
  });

  it("ignores whitespace around the configured value", () => {
    expect(isTrustedSender("planning@eucon.nl", ["  eucon  "])).toBe(true);
  });

  /** A near-miss is a miss: `eurocon` simply does not contain `eucon`. */
  it.each([
    ["a similar-looking name", "planning@eurocon.com"],
    ["a name that shares letters", "planning@unicorn.com"],
    ["an unrelated sender", "orders@example.com"],
    ["the customer's own domain", "planning@lidl.de"],
  ])("refuses %s", (_case, sender) => {
    expect(isTrustedSender(sender, trusted)).toBe(false);
  });

  it("refuses something that is not an address at all", () => {
    // Even though the text contains it: the allowlist decides which ADDRESSES
    // are trusted, not which strings are.
    expect(isTrustedSender("eucon", trusted)).toBe(false);
    expect(isTrustedSender("@eucon.nl", trusted)).toBe(false);
    expect(isTrustedSender("", trusted)).toBe(false);
  });

  it("is a literal, not a pattern", () => {
    expect(isTrustedSender("planning@eucon.nl", ["e.con"])).toBe(false);
    expect(isTrustedSender("planning@eucon.nl", ["euc.n"])).toBe(false);
  });
});

describe("the three forms side by side", () => {
  const trusted = ["eucon", "orders@partner.com", "*@carrier.example"];

  it("accepts a sender matching the substring", () => {
    expect(isTrustedSender("planning@euconxx.com", trusted)).toBe(true);
  });

  it("accepts a sender matching the exact address", () => {
    expect(isTrustedSender("orders@partner.com", trusted)).toBe(true);
  });

  it("accepts a sender matching the domain wildcard", () => {
    expect(isTrustedSender("anyone@carrier.example", trusted)).toBe(true);
  });

  it("refuses a sender matching none of them", () => {
    expect(isTrustedSender("someone@partner.com", trusted)).toBe(false);
    expect(isTrustedSender("planning@eurocon.com", trusted)).toBe(false);
  });

  /**
   * The forms that existed before this one must keep behaving exactly as they
   * did — a deployment configured with `*@eucon.nl` cannot start refusing mail
   * because a third form was added.
   */
  it("leaves the older forms unchanged", () => {
    expect(isTrustedSender("planning@eucon.nl", ["*@eucon.nl"])).toBe(true);
    expect(isTrustedSender("planning@eucon.nl", ["planning@eucon.nl"])).toBe(true);
    expect(isTrustedSender("other@eucon.nl", ["planning@eucon.nl"])).toBe(false);
    // Still by equality, never by suffix.
    expect(isTrustedSender("planning@eucon.nl.evil.com", ["*@eucon.nl"])).toBe(
      false,
    );
  });
});
