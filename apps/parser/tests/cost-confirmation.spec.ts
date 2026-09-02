import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse, parseCostConfirmation } from "../src";

/**
 * EVERY real Cost Confirmation, through the real reader.
 *
 * ── WHAT MAKES THESE DOCUMENTS DIFFERENT ────────────────────────────────────
 * They are printed on the transport-order form and carry a complete copy of an
 * order — the same voyage, container and address blocks. What identifies one is
 * a block at the top:
 *
 *     COST CONFIRMATION NR 4132482 ANRDUB2789089 EUCU4530818
 *     Costcode: WAIT - Waiting Time
 *     Amount: EUR 25.00
 *
 * The money is the point. Everything below the block belongs to a Trip that
 * already exists, which is why reading one must never produce a transport
 * order.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = resolve(__dirname, "../../../docs/06-pdf");
const COST_CONFIRMATIONS = join(FIXTURES, "Cost-Combination");

interface ExpectedConfirmation {
  readonly file: string;
  readonly ccNumber: string;
  readonly bookingNumber: string;
  readonly amount: string;
  readonly costCode: string;
  readonly containerReference: string | null;
}

/**
 * Pinned from the documents themselves, not from their filenames.
 *
 * The filename happens to repeat the number and the booking; the parser is
 * forbidden to read it, so these values are what the PAGE says.
 */
const EXPECTED: readonly ExpectedConfirmation[] = [
  {
    file: "COST_CONFIRMATION_NR_4132482__ANRDUB2789089__EUCU4530818.pdf",
    ccNumber: "4132482",
    bookingNumber: "ANRDUB2789089",
    amount: "25.00",
    costCode: "WAIT",
    containerReference: "EUCU4530818",
  },
  {
    file: "COST_CONFIRMATION_NR_4133634__ANRDUB2791468__PVDU1139156.pdf",
    ccNumber: "4133634",
    bookingNumber: "ANRDUB2791468",
    amount: "41.25",
    costCode: "WAIT",
    containerReference: "PVDU1139156",
  },
  {
    file: "COST_CONFIRMATION_NR_4139509__ANRDUB2792284__EUCU4583166.pdf",
    ccNumber: "4139509",
    bookingNumber: "ANRDUB2792284",
    amount: "55.00",
    costCode: "WAIT",
    containerReference: "EUCU4583166",
  },
  {
    /*
     * The document prints `????` where the others print a container. Eucon's
     * own source value was unreadable; the confirmation is not.
     */
    file: "COST_CONFIRMATION_NR_4139511__ANRDUB2790211__XXXXXXXXXXXX.pdf",
    ccNumber: "4139511",
    bookingNumber: "ANRDUB2790211",
    amount: "96.25",
    costCode: "WAIT",
    containerReference: null,
  },
  {
    /* A clean container, and the case matching narrows strictly on it. */
    file: "CC-met-container.pdf",
    ccNumber: "4152218",
    bookingNumber: "ANRDUB2796277",
    amount: "41.25",
    costCode: "WAIT",
    containerReference: "EUCU4582658",
  },
  {
    /*
     * The header prints `1????` — the unreadable placeholder with a stray digit
     * in front of it. It names no container, so this confirmation is matched by
     * the container-less rule.
     */
    file: "CC-zonder-container.pdf",
    ccNumber: "4152206",
    bookingNumber: "ANRDUB2796313",
    amount: "165.00",
    costCode: "WAIT",
    containerReference: null,
  },
];

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

async function parseConfirmation(file: string) {
  return parseCostConfirmation(
    new Uint8Array(readFileSync(join(COST_CONFIRMATIONS, file))),
  );
}

describe("the Cost Confirmation fixtures", () => {
  /** A document added to the folder must not go untested. */
  it("covers every document in the folder", () => {
    const onDisk = existsSync(COST_CONFIRMATIONS)
      ? readdirSync(COST_CONFIRMATIONS)
          .filter((name) => name.endsWith(".pdf"))
          .sort()
      : [];

    expect(EXPECTED.map((entry) => entry.file).sort()).toEqual(onDisk);
  });
});

describe.each(EXPECTED)("$file", (expected) => {
  it("is recognised as a cost confirmation", async () => {
    const result = await parseConfirmation(expected.file);

    expect(result.ok).toBe(true);
  });

  it("reads the number, the booking and the amount", async () => {
    const result = await parseConfirmation(expected.file);

    if (!result.ok) throw new Error(`expected a parse: ${result.reason}`);

    expect(result.confirmation.ccNumber).toBe(expected.ccNumber);
    expect(result.confirmation.bookingNumber).toBe(expected.bookingNumber);
    expect(result.confirmation.amount).toBe(expected.amount);
    expect(result.confirmation.costCode).toBe(expected.costCode);
  });

  /** Money is a fixed-2 string end to end. A float would round it. */
  it("reads the amount as a fixed-2 string in euros", async () => {
    const result = await parseConfirmation(expected.file);

    if (!result.ok) throw new Error("expected a parse");

    expect(result.confirmation.amount).toMatch(/^\d+\.\d{2}$/);
    expect(result.confirmation.currency).toBe("EUR");
    expect(typeof result.confirmation.amount).toBe("string");
  });

  it("reads the container reference, or records that it is unreadable", async () => {
    const result = await parseConfirmation(expected.file);

    if (!result.ok) throw new Error("expected a parse");

    expect(result.confirmation.containerReference).toBe(
      expected.containerReference,
    );
  });

  it("keeps the block it read as evidence", async () => {
    const result = await parseConfirmation(expected.file);

    if (!result.ok) throw new Error("expected a parse");

    expect(result.confirmation.raw).toContain(expected.ccNumber);
    expect(result.confirmation.raw).toContain(`Amount: EUR ${expected.amount}`);
  });

  /**
   * The whole reason this is a separate reader: the document contains a
   * complete transport order, and reading one as an order would create a Trip
   * for a booking that already has one.
   */
  it("creates no transport order", async () => {
    const result = await parseConfirmation(expected.file);

    expect(result).not.toHaveProperty("trips");
  });
});

describe("what a cost confirmation is not", () => {
  it("refuses an ordinary transport order", async () => {
    const result = await parseCostConfirmation(readFixture("NEW/1page.pdf"));

    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("NOT_A_COST_CONFIRMATION");
  });

  it("refuses a cancelled transport order", async () => {
    const result = await parseCostConfirmation(
      readFixture("CANCEL/cancelled_transportorder1367584.pdf"),
    );

    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("NOT_A_COST_CONFIRMATION");
  });

  it("refuses a file that is not a PDF at all", async () => {
    const result = await parseCostConfirmation(
      new Uint8Array(Buffer.from("this is not a PDF")),
    );

    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe("INVALID_PDF");
  });

  /**
   * And the other direction: a confirmation must not come out of the transport
   * parser as a Trip. It carries an order, so this is the mistake that would
   * duplicate one.
   */
  it("does not become a Trip when read as a transport order", async () => {
    const result = await parse(
      new Uint8Array(
        readFileSync(join(COST_CONFIRMATIONS, EXPECTED[0].file)),
      ),
    );

    expect(result.ok).toBe(false);
  });
});

describe("the amounts across the fixtures", () => {
  /**
   * Each document's own amount, and several different ones across them: no
   * amount is a constant baked into the reader.
   *
   * NOT one distinct amount per file — two real confirmations legitimately
   * confirm the same €41.25, which is a quarter-hour of waiting at the
   * configured rate and says nothing about the parser.
   */
  it("are the ones the documents state", async () => {
    const amounts: string[] = [];

    for (const expected of EXPECTED) {
      const result = await parseConfirmation(expected.file);

      if (!result.ok) throw new Error("expected a parse");

      expect(result.confirmation.amount).toBe(expected.amount);
      amounts.push(result.confirmation.amount);
    }

    expect(new Set(amounts).size).toBeGreaterThan(1);
    expect(amounts).toEqual(EXPECTED.map((entry) => entry.amount));
  });

  it("keeps the cents of a quarter-hour amount", async () => {
    const result = await parseConfirmation(EXPECTED[1].file);

    if (!result.ok) throw new Error("expected a parse");
    // 41.25, not 41.3 and not 41.
    expect(result.confirmation.amount).toBe("41.25");
  });
});

/**
 * ── THE ORDERED TRANSPORT DATE, AND WHAT COUNTS AS A CONTAINER ──────────────
 * Both are read from the real documents, and both decide which Trip a
 * confirmation belongs to: the date separates two transports on one booking,
 * and a confirmation naming a usable container is matched strictly on it.
 *
 * The two files added for this rule are the interesting ones. One prints a
 * clean container; the other prints `1????`, which is the unreadable
 * placeholder with a stray digit in front of it and names no container at all.
 */
describe("the fields Cost Confirmation matching depends on", () => {
  it.each([
    ["CC-met-container.pdf", "4152218", "2026-08-28", "EUCU4582658"],
    ["CC-zonder-container.pdf", "4152206", "2026-08-28", null],
    [
      "COST_CONFIRMATION_NR_4132482__ANRDUB2789089__EUCU4530818.pdf",
      "4132482",
      "2026-08-14",
      "EUCU4530818",
    ],
    [
      "COST_CONFIRMATION_NR_4139511__ANRDUB2790211__XXXXXXXXXXXX.pdf",
      "4139511",
      "2026-08-20",
      null,
    ],
  ])("reads %s", async (file, ccNumber, transportDate, container) => {
    const result = await parseConfirmation(file);

    if (!result.ok) throw new Error(`expected a parse: ${result.reason}`);

    expect(result.confirmation.ccNumber).toBe(ccNumber);
    expect(result.confirmation.transportDate).toBe(transportDate);
    expect(result.confirmation.containerReference).toBe(container);
  });

  /**
   * The date comes from the confirmation's own LOADING / DELIVERY section, not
   * from its print date — which is a different day on these documents, and
   * would silently match the wrong transport.
   */
  it("reads the transport date, never the print date", async () => {
    const result = await parseConfirmation("CC-met-container.pdf");

    if (!result.ok) throw new Error(result.reason);

    expect(result.confirmation.transportDate).toBe("2026-08-28");
    expect(result.confirmation.raw).not.toContain("2026-08-28");
  });

  /** Every confirmation we hold states a readable transport date. */
  it("reads a date from every real confirmation", async () => {
    for (const expected of EXPECTED) {
      const result = await parseConfirmation(expected.file);

      if (!result.ok) throw new Error(`${expected.file}: ${result.reason}`);

      expect(result.confirmation.transportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * A reference that is not a container is not a container. `1????` slipped
   * through the placeholder rule because it is not made ENTIRELY of question
   * marks, and a reference that names nothing must never take part in matching.
   */
  it("treats an unreadable reference as no container", async () => {
    const result = await parseConfirmation("CC-zonder-container.pdf");

    if (!result.ok) throw new Error(result.reason);

    expect(result.confirmation.raw).toContain("1????");
    expect(result.confirmation.containerReference).toBeNull();
  });
});
