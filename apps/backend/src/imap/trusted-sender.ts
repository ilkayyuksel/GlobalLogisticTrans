/**
 * Who is allowed to send transport orders.
 *
 * ── THIS IS A WHITELIST, AND IT IS THE ONLY GATE ────────────────────────────
 * A trusted sender may create Trips by emailing a PDF. Nothing else about the
 * message is a credential — a subject line is trivially forged — so this file
 * is the security boundary of the whole mailbox import, and every rule in it is
 * deliberately narrow.
 *
 * An empty allowlist trusts NOBODY. It is never read as "trust anyone": a
 * misconfigured system that imports nothing is a visible fault, while one that
 * imports from anyone is an invisible one.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── THE TWO ACCEPTED FORMS ──────────────────────────────────────────────────
 *   planning@eucon.nl   one exact address, and only that address
 *   *@eucon.nl          any local part at exactly that domain
 *
 * The wildcard means precisely `local-part + "@eucon.nl"`. It is matched by
 * splitting the sender at its single `@` and comparing the domain for EQUALITY,
 * never by a suffix test: `endsWith("eucon.nl")` would also accept
 * `planning@eucon.nl.evil.com`, which is exactly the attack this format invites
 * if implemented carelessly.
 *
 * Nothing else is accepted. `*`, `*@*` and anything resembling a regular
 * expression are refused by the configuration validator, so a pattern that
 * would widen the whitelist beyond one named domain cannot reach this code.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The wildcard local part, and the only wildcard this format has. */
const ANY_LOCAL_PART = "*";

/**
 * A domain: labels of letters, digits and inner hyphens, separated by dots, at
 * least two labels. No wildcard character can satisfy it.
 */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * A local part: the characters real addresses use, minus `*`.
 *
 * `*` is a legal character in an address, and it is excluded anyway. The only
 * meaning this format gives it is "any local part", and it has that meaning
 * only when it stands alone. Allowing it elsewhere would accept `plan*@eucon.nl`
 * as a LITERAL local part — a pattern that reads like a prefix wildcard, is not
 * one, and would therefore match nothing while looking as though it worked.
 * Refusing it at startup is the honest outcome.
 */
const LOCAL_PART = /^[a-z0-9!#$%&'+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'+/=?^_`{|}~-]+)*$/;

/** One entry of the allowlist, already split into its two halves. */
interface TrustedSenderPattern {
  /** Null when the entry is a domain wildcard. */
  readonly localPart: string | null;
  readonly domain: string;
}

/**
 * Splits an address or wildcard into its halves, or null when it is neither.
 *
 * The single `@` is required: `eucon.nl` names no mailbox and `a@b@c` is not an
 * address, so both are refused rather than interpreted.
 */
function toPattern(entry: string): TrustedSenderPattern | null {
  const normalised = entry.trim().toLowerCase();
  const halves = normalised.split("@");

  if (halves.length !== 2) {
    return null;
  }

  const [localPart, domain] = halves;

  if (!DOMAIN.test(domain)) {
    return null;
  }

  if (localPart === ANY_LOCAL_PART) {
    return { localPart: null, domain };
  }

  return LOCAL_PART.test(localPart) ? { localPart, domain } : null;
}

/**
 * Whether an allowlist entry is one this system accepts.
 *
 * Used by the configuration validator, so a mistyped or dangerously broad
 * pattern stops the application at startup rather than at the first email.
 */
export function isTrustedSenderPattern(entry: unknown): boolean {
  return typeof entry === "string" && toPattern(entry) !== null;
}

/**
 * Whether this sender is on the allowlist.
 *
 * Case-insensitive on both sides, and surrounding whitespace is ignored: an
 * address typed with capitals in the environment file must still match the
 * address the mailbox reports.
 */
export function isTrustedSender(
  senderEmail: string,
  trustedSenders: readonly string[],
): boolean {
  const sender = toPattern(senderEmail);

  // A sender that is not a plain `local@domain` address matches nothing. In
  // particular `@eucon.nl`, which has no local part, is not a sender.
  if (sender === null || sender.localPart === null) {
    return false;
  }

  return trustedSenders.some((entry) => {
    const trusted = toPattern(entry);

    if (trusted === null || trusted.domain !== sender.domain) {
      return false;
    }

    // A wildcard entry accepts any local part at that exact domain; an exact
    // entry accepts only its own.
    return trusted.localPart === null || trusted.localPart === sender.localPart;
  });
}

/**
 * The sender's domain, for a log line.
 *
 * Logging which domain was refused is what makes a misconfigured allowlist
 * diagnosable. The local part is not included: it identifies a person.
 */
export function domainOf(senderEmail: string): string | null {
  return toPattern(senderEmail)?.domain ?? null;
}
