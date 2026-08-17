/**
 * Which emails may create Trips, and which are set aside.
 *
 * Pure functions over values the mailbox already gave us. Nothing here connects,
 * downloads or writes, so the rules can be exercised exhaustively without a
 * mailbox — and selection is decided BEFORE any attachment is fetched, which is
 * what keeps an irrelevant email from costing a download.
 *
 * Two conditions must both hold: the sender is trusted, and the subject
 * announces one of the three instructions this system carries out — NEW,
 * UPDATE or CANCEL.
 */

/** What became of an email. Recorded and logged; never guessed at. */
export const SelectionOutcome = {
  ACCEPTED: "ACCEPTED",
  UNTRUSTED_SENDER: "UNTRUSTED_SENDER",
  NO_RECOGNISED_PREFIX: "NO_RECOGNISED_PREFIX",
} as const;

export type SelectionOutcome =
  (typeof SelectionOutcome)[keyof typeof SelectionOutcome];

/**
 * What the sender is asking for.
 *
 * The ACTION comes from the subject and from nowhere else. It is not the same
 * thing as the document's own status: a `CANCEL:` email is an instruction
 * addressed to us, while the CANCELLED stamp is something printed on the order.
 * Both exist, and each is read from its own source.
 */
export const MessageAction = {
  NEW: "NEW",
  UPDATE: "UPDATE",
  CANCEL: "CANCEL",
} as const;

export type MessageAction =
  (typeof MessageAction)[keyof typeof MessageAction];

const UPDATE_PREFIX = "UPDATE:";
const CANCEL_PREFIX = "CANCEL:";

export interface SelectionInput {
  readonly senderEmail: string;
  readonly subject: string;
}

export interface SelectionRules {
  /** Exact addresses, already lowercased by configuration. */
  readonly trustedSenders: readonly string[];
  readonly newSubjectPrefix: string;
}

export interface Selection {
  readonly outcome: SelectionOutcome;
  readonly accepted: boolean;
  /** What to do with it. Null exactly when the email was not accepted. */
  readonly action: MessageAction | null;
}

/**
 * Whether this email may be imported, and if not, why.
 *
 * The sender is checked first: an untrusted sender is untrusted whatever its
 * subject claims, and reporting the subject reason for a stranger's email would
 * suggest the address was fine.
 */
export function selectMessage(
  message: SelectionInput,
  rules: SelectionRules,
): Selection {
  if (!isTrustedSender(message.senderEmail, rules.trustedSenders)) {
    return refuse(SelectionOutcome.UNTRUSTED_SENDER);
  }

  const subject = message.subject.trim();

  if (startsWithPrefix(subject, rules.newSubjectPrefix)) {
    return accept(MessageAction.NEW);
  }

  if (startsWithPrefix(subject, UPDATE_PREFIX)) {
    return accept(MessageAction.UPDATE);
  }

  if (startsWithPrefix(subject, CANCEL_PREFIX)) {
    return accept(MessageAction.CANCEL);
  }

  return refuse(SelectionOutcome.NO_RECOGNISED_PREFIX);
}

/**
 * Exact address matching, case-insensitively.
 *
 * Deliberately not domain-suffix matching: trusting `@example.com` would trust
 * every address the domain can ever issue, and no requirement asks for that.
 * Extending the allowlist is a configuration change, which is visible.
 */
function isTrustedSender(
  senderEmail: string,
  trustedSenders: readonly string[],
): boolean {
  const sender = senderEmail.trim().toLowerCase();

  return trustedSenders.some((trusted) => trusted === sender);
}

function startsWithPrefix(subject: string, prefix: string): boolean {
  return subject.toLowerCase().startsWith(prefix.toLowerCase());
}

function accept(action: MessageAction): Selection {
  return { outcome: SelectionOutcome.ACCEPTED, accepted: true, action };
}

function refuse(outcome: SelectionOutcome): Selection {
  return { outcome, accepted: false, action: null };
}
