import { missingField } from "../errors";
import { Fragment } from "../text/extract";
import { valuesRightOf } from "../text/normalize";

/**
 * Container type and container number.
 *
 * Container TYPE is always present and always required.
 *
 * Container NUMBER is present on a delivery, where the container already
 * exists, and absent on a collection, where the driver has not yet picked one
 * up. Absent means null and never an error — `pdfParserRules.md` is explicit
 * that a trip is never rejected for a missing container number, and a container
 * number is never invented.
 */

const TYPE_LABEL = "Cntr type:";
const NUMBER_LABEL = "Container:";

/**
 * The `Cntr type:` label as a text layer may actually emit it.
 *
 * Extraction already collapses runs of whitespace, but a PDF generator may
 * still drop or add a space around the words or the colon, or emit the label
 * and its value as ONE run (`Cntr type: 45PH`). The capture is that glued-on
 * value, empty when the value is a separate fragment to the right.
 */
const TYPE_LABEL_PATTERN = /^Cntr\s*type\s*:\s*(.*)$/;

/**
 * No closed list of container types.
 *
 * The documents show `45PH`, `45RH`, `20TK`, `20RF` and say "etc.", so
 * validating against a fixed set would reject a legitimate order the day a new
 * type appears. The shape is checked instead: digits then letters.
 */
const CONTAINER_TYPE = /^[0-9]{2}[A-Z0-9]{2,}$/;

export function extractContainerType(fragments: readonly Fragment[]): string {
  const labels = findContainerTypeLabels(fragments);

  for (const label of labels) {
    const candidate = containerTypeValue(fragments, label);

    if (candidate !== null && CONTAINER_TYPE.test(candidate)) {
      return candidate;
    }
  }

  throw missingField(
    "containerType",
    labels.length === 0
      ? `No '${TYPE_LABEL}' label was found.`
      : `'${TYPE_LABEL}' was found but carried no value shaped like a container type.`,
  );
}

/** True when these fragments print a `Cntr type:` label at all. */
export function hasContainerTypeLabel(fragments: readonly Fragment[]): boolean {
  return findContainerTypeLabels(fragments).length > 0;
}

function findContainerTypeLabels(fragments: readonly Fragment[]): Fragment[] {
  return fragments.filter((fragment) => TYPE_LABEL_PATTERN.test(fragment.text));
}

/** The value glued onto the label, otherwise the nearest one to its right. */
function containerTypeValue(
  fragments: readonly Fragment[],
  label: Fragment,
): string | null {
  const inline = TYPE_LABEL_PATTERN.exec(label.text)?.[1] ?? "";

  if (inline !== "") {
    return inline;
  }

  return valuesRightOf(fragments, label)[0]?.text ?? null;
}

/**
 * Characters a document uses to make a container number readable.
 *
 * `EUCU 145129/5` is printed for a human; the identifier is `EUCU1451295`. The
 * space and the slash are typography, not data — every real document uses the
 * same two, and stripping them is what makes two printings of one container
 * compare equal. A backslash is included because it is the same kind of
 * separator, not because any fixture has shown one.
 *
 * Nothing else is touched: letters and digits are the identity, and no case is
 * changed, because nothing has ever suggested two containers differ only by it.
 */
const CONTAINER_FORMATTING = /[\s/\\]/g;

/**
 * A container number in the one form this system stores and compares.
 *
 * ── THE SINGLE SOURCE OF THIS RULE ──────────────────────────────────────────
 * It lives in the parser package because that package is where a container
 * number first appears AND is already a dependency of the Backend, so both
 * sides share this exact function. There is deliberately no second, slightly
 * different normalisation in an importer, a repository, a DTO or the browser.
 *
 * ── BOOKING NUMBERS ARE NOT THIS ────────────────────────────────────────────
 * Never apply it to one. A booking prints as `ANRDUB2794719 /67036944`, where
 * the slash separates the booking from the TRIP number — removing it would
 * fuse two identifiers into one. Containers and bookings are different things
 * that happen to share a punctuation mark.
 *
 * Absence stays absence: null, empty and whitespace-only all give null, so a
 * value that says nothing cannot become an identity.
 */
export function normalizeContainerNumber(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const canonical = value.replace(CONTAINER_FORMATTING, "");

  return canonical === "" ? null : canonical;
}

/**
 * The container number, or null when the document states none.
 *
 * A delivery prints it twice — once in the voyage block and once under
 * CONTAINER/CARGO — with the same value. The first is taken; the fixtures show
 * no document where the two disagree, and inventing a reconciliation rule for a
 * conflict that has never been observed would be speculation.
 *
 * NORMALISED on the way out: `EUCU 145129/5` becomes `EUCU1451295`, which is
 * what the Trip stores and what matching compares. The value as printed is kept
 * in the parser metadata, where diagnostics can still see it.
 */
export function extractContainerNumber(
  fragments: readonly Fragment[],
): string | null {
  return normalizeContainerNumber(extractRawContainerNumber(fragments));
}

/** The container number exactly as the document printed it. Diagnostics only. */
export function extractRawContainerNumber(
  fragments: readonly Fragment[],
): string | null {
  for (const label of fragments.filter((f) => f.text === NUMBER_LABEL)) {
    const candidate = valuesRightOf(fragments, label)[0];

    if (candidate && candidate.text.length > 0) {
      return candidate.text;
    }
  }

  return null;
}
