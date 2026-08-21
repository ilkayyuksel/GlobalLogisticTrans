import { Fragment } from "../text/extract";

/**
 * The Cost Confirmation block Eucon prints at the top of a notification.
 *
 * ── WHAT THESE DOCUMENTS ARE ────────────────────────────────────────────────
 * They arrive on the SAME form as a transport order — the header still says
 * "TRANSPORT ORDER NOTIFICATION" and the voyage, container and address blocks
 * are all present. What makes one a Cost Confirmation is a block at the top:
 *
 *     COST CONFIRMATION NR 4132482 ANRDUB2789089 EUCU4530818
 *     Costcode: WAIT - Waiting Time
 *     Amount: EUR 25.00
 *     Remarks:
 *     calculation after 0.5 hrs
 *     zelf geladen
 *
 * That is the whole document as far as this system is concerned: a number, the
 * booking it belongs to, and the money Eucon has agreed to pay for it. The
 * transport details below are a copy of an order we already have, which is why
 * a Cost Confirmation NEVER creates a Trip.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IS OPTIONAL, AND WHY ───────────────────────────────────────────────
 * The container reference at the end of the first line is not always readable.
 * One real document prints `????` where the others print `EUCU4530818`. It is a
 * convenience copy of a value the Trip already holds, so an unreadable one is
 * recorded as absent — refusing the document over it would throw away a
 * confirmed amount because a field nobody needs was smudged.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** `COST CONFIRMATION NR <number> <booking> [<container>]`. */
const HEADER_LINE =
  /^COST CONFIRMATION\s+NR\s+(\d+)\s+([A-Z]{3}[A-Z0-9]{5,})(?:\s+(\S+))?/i;

/** `Costcode: WAIT - Waiting Time` — the code, then a human description. */
const COST_CODE_LINE = /^Costcode:\s*([A-Z0-9_-]+)\s*(?:-\s*(.*))?$/i;

/** `Amount: EUR 25.00` — a currency and a fixed-2 amount, in that order. */
const AMOUNT_LINE = /^Amount:\s*([A-Z]{3})\s*(-?\d+(?:[.,]\d{1,2})?)\s*$/i;

/**
 * A container reference that says nothing.
 *
 * Eucon prints `????` when its own source value is unreadable. Anything made
 * only of question marks or asterisks is that same "unknown", not a reference.
 */
const UNREADABLE = /^[?*]+$/;

export interface ExtractedCostConfirmation {
  /** The Eucon number, digits only. The `CC` prefix is presentation. */
  readonly ccNumber: string;
  readonly bookingNumber: string;
  /** Fixed-2 decimal string. Never a float — money is never a JS number. */
  readonly amount: string;
  readonly currency: string;
  /** `WAIT` on every document seen so far, but not assumed to be the only one. */
  readonly costCode: string;
  /** The human description beside the code, when the document prints one. */
  readonly costDescription: string | null;
  /** Null when the document prints an unreadable reference. */
  readonly containerReference: string | null;
  /** The lines under `Remarks:`, joined. Empty when there are none. */
  readonly remarks: string | null;
  /** The whole block, as evidence for what was read. */
  readonly raw: string;
}

/** Whether this document is a Cost Confirmation at all. */
export function findCostConfirmationHeader(
  fragments: readonly Fragment[],
): Fragment | null {
  return (
    fragments.find((fragment) => HEADER_LINE.test(fragment.text.trim())) ?? null
  );
}

/**
 * Reads the block, or says which part of it is missing.
 *
 * Returns a list of missing field names rather than throwing: the caller turns
 * them into a failure result, and an incomplete confirmation is an ordinary
 * outcome for a document that arrives by email.
 */
export function extractCostConfirmation(
  fragments: readonly Fragment[],
  header: Fragment,
):
  | { readonly ok: true; readonly value: ExtractedCostConfirmation }
  | { readonly ok: false; readonly missingFields: string[] } {
  const headerMatch = HEADER_LINE.exec(header.text.trim());

  if (!headerMatch) {
    return { ok: false, missingFields: ["ccNumber", "bookingNumber"] };
  }

  const [, ccNumber, bookingNumber, container] = headerMatch;
  const block = blockUnder(fragments, header);
  const amount = readAmount(block);
  const costCode = readCostCode(block);

  const missingFields = [
    ...(amount ? [] : ["amount"]),
    ...(costCode ? [] : ["costCode"]),
  ];

  if (!amount || !costCode) {
    return { ok: false, missingFields };
  }

  return {
    ok: true,
    value: {
      ccNumber,
      bookingNumber: bookingNumber.toUpperCase(),
      amount: amount.amount,
      currency: amount.currency,
      costCode: costCode.code,
      costDescription: costCode.description,
      containerReference:
        container && !UNREADABLE.test(container) ? container : null,
      remarks: readRemarks(block),
      raw: [header, ...block].map((fragment) => fragment.text).join("\n"),
    },
  };
}

/**
 * The lines belonging to the block: the same column, below the header, down to
 * the next section.
 *
 * `VOYAGE DETAILS` is where the ordinary transport form resumes, and nothing
 * below it is part of the confirmation.
 */
function blockUnder(
  fragments: readonly Fragment[],
  header: Fragment,
): Fragment[] {
  const floor = fragments
    .filter(
      (fragment) =>
        fragment.page === header.page &&
        fragment.y < header.y &&
        fragment.text.trim().toUpperCase() === "VOYAGE DETAILS",
    )
    .map((fragment) => fragment.y)[0];

  return fragments
    .filter(
      (fragment) =>
        fragment.page === header.page &&
        fragment.y < header.y &&
        (floor === undefined || fragment.y > floor) &&
        Math.abs(fragment.x - header.x) <= 2,
    )
    .sort((left, right) => right.y - left.y);
}

function readAmount(
  block: readonly Fragment[],
): { amount: string; currency: string } | null {
  for (const fragment of block) {
    const match = AMOUNT_LINE.exec(fragment.text.trim());

    if (match) {
      const [, currency, value] = match;

      return {
        currency: currency.toUpperCase(),
        // A comma is a decimal separator here, never a thousands separator:
        // the amounts are two decimals and the form is Dutch-Belgian.
        amount: toFixedTwo(value.replace(",", ".")),
      };
    }
  }

  return null;
}

function readCostCode(
  block: readonly Fragment[],
): { code: string; description: string | null } | null {
  for (const fragment of block) {
    const match = COST_CODE_LINE.exec(fragment.text.trim());

    if (match) {
      const [, code, description] = match;

      return {
        code: code.toUpperCase(),
        description: description?.trim() ? description.trim() : null,
      };
    }
  }

  return null;
}

/** Everything under `Remarks:`, in the order the document prints it. */
function readRemarks(block: readonly Fragment[]): string | null {
  const label = block.findIndex(
    (fragment) => fragment.text.trim().toLowerCase() === "remarks:",
  );

  if (label === -1) {
    return null;
  }

  const lines = block
    .slice(label + 1)
    .map((fragment) => fragment.text.trim())
    .filter((text) => text.length > 0);

  return lines.length > 0 ? lines.join(" ") : null;
}

/**
 * Money as the database stores it: a fixed-2 string.
 *
 * Parsed from the digits the document printed rather than through a float, so
 * `41.25` is `41.25` and not `41.249999`. The value is never arithmetic here —
 * it is only reshaped.
 */
function toFixedTwo(value: string): string {
  const [whole, fraction = ""] = value.split(".");

  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
