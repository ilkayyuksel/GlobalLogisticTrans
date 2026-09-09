import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "../src/index";

/**
 * An order whose address states no city — and what the parser does about it.
 *
 * ── THE DOCUMENT ────────────────────────────────────────────────────────────
 * `transportorder1377575.pdf` prints its loading address in full, and it simply
 * has no city in it:
 *
 *     LOADING 1:
 *     Address:  [8700]
 *               Novaya Handling
 *               Ten Hovestraat 32
 *               8700
 *     Date/time: 10/09/2026 06:00
 *
 * The last line is the postcode again. There is no city and no country
 * anywhere in the block.
 *
 * ── SO THIS IS NOT A PARSING FAILURE ────────────────────────────────────────
 * Every rule declined because there was nothing to read, not because it could
 * not read what was there. The parser reports `MALFORMED_ADDRESS` naming
 * `destinationCity` as the missing field, which is the doctrine this codebase
 * has applied throughout: an absent value is reported absent and never
 * invented. There is no postcode-to-city dataset in this project, and `8700`
 * on its own proves nothing — a bare postcode belongs to no country, which is
 * why `readBarePostcode` takes its country from an explicit prefix printed
 * elsewhere rather than from the digits.
 *
 * ── WHAT THIS TEST IS REALLY GUARDING ───────────────────────────────────────
 * The refusal is the easy half. The valuable half is that the block contains
 * three things that could each be mistaken for a city — a company name, a
 * street with a number, and the postcode repeated on its own line — and none
 * of them may ever become the destination. A street or a company stored as a
 * destination would match no configured route and would mislead an operator,
 * which is worse than an order reported as unreadable.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = join(__dirname, "..", "..", "..", "docs", "06-pdf");

async function parseFixture(name: string) {
  return parse(new Uint8Array(readFileSync(join(FIXTURES, name))));
}

describe("an order whose address names no city", () => {
  const FILE = "BUG-CITY/transportorder1377575.pdf";

  it("is refused rather than guessed at", async () => {
    const result = await parseFixture(FILE);

    expect(result.ok).toBe(false);
  });

  it("names the reason and the field that is missing", async () => {
    const result = await parseFixture(FILE);

    if (result.ok) {
      throw new Error("expected this document to be refused");
    }

    expect(result.reason).toBe("MALFORMED_ADDRESS");
    expect(result.missingFields).toEqual(["destinationCity"]);
  });

  /** The message quotes the block, so an operator can see what was read. */
  it("says what it read instead", async () => {
    const result = await parseFixture(FILE);

    if (result.ok) {
      throw new Error("expected this document to be refused");
    }

    expect(result.message).toContain("LOADING 1:");
    expect(result.message).toContain("Novaya Handling Ten Hovestraat 32 8700");
  });

  /**
   * The three near-misses. None of them is a city, and the refusal is the only
   * honest answer — but a future change to the address rules could quietly
   * start accepting one, and that would be a silent data error rather than a
   * visible failure.
   */
  it("takes none of the block's lines as a destination", async () => {
    const result = await parseFixture(FILE);

    expect(JSON.stringify(result)).not.toContain('"destinationCity":"');
  });

  /**
   * The terminal IS named on this page — `PSA Quay 869`, `BE-2040 Antwerp` —
   * and it must NOT be borrowed. The four-step address fallback reaches the
   * terminal block only when a numbered section is MISSING; here the section
   * exists and states an address, so borrowing Antwerp would report a
   * destination the document does not claim.
   */
  it("does not borrow the terminal's own city", async () => {
    const result = await parseFixture(FILE);

    if (result.ok) {
      throw new Error("expected this document to be refused");
    }

    expect(result.message).not.toContain("Antwerp");
  });

  /**
   * And no city is inferred from the postcode. This project has no
   * postcode-to-city source of any kind — `COUNTRY_BY_POSTCODE_PREFIX` maps
   * the LETTERS of a country prefix, never digits — so resolving `8700` would
   * mean inventing a dataset the parser is not entitled to.
   */
  it("infers nothing from the bare postcode", async () => {
    const result = await parseFixture(FILE);

    expect(result.ok).toBe(false);
  });
});
