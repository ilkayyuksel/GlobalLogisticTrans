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
 * ── THE THREE ACCEPTED FORMS ────────────────────────────────────────────────
 *   planning@eucon.nl   one exact address, and only that address
 *   *@eucon.nl          any local part at exactly that domain
 *   eucon               any address CONTAINING that text
 *
 * The wildcard means precisely `local-part + "@eucon.nl"`. It is matched by
 * splitting the sender at its single `@` and comparing the domain for EQUALITY,
 * never by a suffix test: `endsWith("eucon.nl")` would also accept
 * `planning@eucon.nl.evil.com`, which is exactly the attack this format invites
 * if implemented carelessly.
 *
 * ── WHY THE THIRD FORM EXISTS, AND WHAT IT COSTS ────────────────────────────
 * The sender does not use one domain. Transport orders arrive from `eucon.nl`,
 * from other domains carrying the same name, and from addresses where `eucon`
 * is the local part. Naming each one would mean an allowlist nobody can keep
 * complete, and an order silently ignored because a new domain appeared is
 * worse than the alternative.
 *
 * It is deliberately the LOOSEST form this file has, so it is fenced in:
 *
 *   * it is a LITERAL substring, never a pattern. `eurocon` does not contain
 *     `eucon`, and no configured value can be made to behave like a regular
 *     expression;
 *   * the sender must still be a real `local@domain` address before any
 *     matching happens at all;
 *   * an entry shorter than three characters is refused at startup. `a` would
 *     trust most of the internet, and an allowlist that wide is not one.
 *
 * `*`, `*@*` and anything resembling a regular expression are still refused by
 * the configuration validator.
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

/**
 * The shortest substring the allowlist accepts.
 *
 * Not a guess about real values — `eucon` is five — but a floor under the
 * damage a typo can do. One or two characters occur in almost every address,
 * so such an entry would trust anyone while looking like a configured rule.
 */
const MINIMUM_SUBSTRING_LENGTH = 3;

/**
 * A substring entry: the characters that appear in the parts of an address.
 *
 * No `@`, because an entry with one is an address or a domain wildcard and is
 * read as such. No `*`, no whitespace, and nothing that could be mistaken for
 * a pattern: the value is compared literally, and a configuration that looks
 * like a regular expression would promise something this file does not do.
 */
const SUBSTRING = /^[a-z0-9._-]+$/;

/**
 * The substring an entry stands for, or null when it is not that form.
 *
 * Entries containing `@` are addresses or wildcards and are handled by
 * `toPattern`; only an entry without one can be a substring.
 */
function toSubstring(entry: string): string | null {
  const normalised = entry.trim().toLowerCase();

  if (
    normalised.includes("@") ||
    normalised.length < MINIMUM_SUBSTRING_LENGTH ||
    !SUBSTRING.test(normalised)
  ) {
    return null;
  }

  return normalised;
}

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
  if (typeof entry !== "string") {
    return false;
  }

  return toPattern(entry) !== null || toSubstring(entry) !== null;
}

/**
 * Whether this sender is on the allowlist.
 *
 * Case-insensitive on both sides, and surrounding whitespace is ignored: an
 * address typed with capitals in the environment file must still match the
 * address the mailbox reports.
 *
 * The sender must be a plain `local@domain` address before anything is
 * compared. That guard is what keeps the substring form honest: it decides
 * which ADDRESSES are trusted, not which strings are.
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

  const address = `${sender.localPart}@${sender.domain}`;

  return trustedSenders.some(
    (entry) => matchesAddress(entry, sender) || matchesSubstring(entry, address),
  );
}

/** The exact-address and domain-wildcard forms, unchanged. */
function matchesAddress(
  entry: string,
  sender: TrustedSenderPattern,
): boolean {
  const trusted = toPattern(entry);

  if (trusted === null || trusted.domain !== sender.domain) {
    return false;
  }

  // A wildcard entry accepts any local part at that exact domain; an exact
  // entry accepts only its own.
  return trusted.localPart === null || trusted.localPart === sender.localPart;
}

/**
 * The substring form: does the whole address contain this text?
 *
 * Literally, and over the COMPLETE address — so `eucon` accepts
 * `planning@eucon.nl`, `planning@euconxx.com` and `eucon@example.com` alike,
 * and refuses `planning@eurocon.com`, which does not contain it.
 */
function matchesSubstring(entry: string, address: string): boolean {
  const substring = toSubstring(entry);

  return substring !== null && address.includes(substring);
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
