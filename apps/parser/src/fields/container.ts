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
 * No closed list of container types.
 *
 * The documents show `45PH`, `45RH`, `20TK`, `20RF` and say "etc.", so
 * validating against a fixed set would reject a legitimate order the day a new
 * type appears. The shape is checked instead: digits then letters.
 */
const CONTAINER_TYPE = /^[0-9]{2}[A-Z0-9]{2,}$/;

export function extractContainerType(fragments: readonly Fragment[]): string {
  const labels = fragments.filter((fragment) => fragment.text === TYPE_LABEL);

  for (const label of labels) {
    const candidate = valuesRightOf(fragments, label)[0];

    if (candidate && CONTAINER_TYPE.test(candidate.text)) {
      return candidate.text;
    }
  }

  throw missingField(
    "containerType",
    labels.length === 0
      ? `No '${TYPE_LABEL}' label was found.`
      : `'${TYPE_LABEL}' was found but carried no value shaped like a container type.`,
  );
}

/**
 * The container number, or null when the document states none.
 *
 * A delivery prints it twice — once in the voyage block and once under
 * CONTAINER/CARGO — with the same value. The first is taken; the fixtures show
 * no document where the two disagree, and inventing a reconciliation rule for a
 * conflict that has never been observed would be speculation.
 */
export function extractContainerNumber(
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
