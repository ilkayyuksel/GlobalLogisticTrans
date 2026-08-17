import {
  MessageAction,
  SelectionOutcome,
  SelectionRules,
  selectMessage,
} from "./message-selection";

const RULES: SelectionRules = {
  trustedSenders: ["orders@carrier.test", "dispatch@carrier.test"],
  newSubjectPrefix: "NEW:",
};

function message(senderEmail: string, subject: string) {
  return { senderEmail, subject };
}

describe("selectMessage", () => {
  describe("a trusted sender announcing a new order", () => {
    it("is accepted", () => {
      const selection = selectMessage(
        message("orders@carrier.test", "NEW: Trucking Order 1212816"),
        RULES,
      );

      expect(selection.accepted).toBe(true);
      expect(selection.outcome).toBe(SelectionOutcome.ACCEPTED);
    });

    it("accepts any address on the allowlist, not just the first", () => {
      const selection = selectMessage(
        message("dispatch@carrier.test", "NEW: Trucking Order"),
        RULES,
      );

      expect(selection.accepted).toBe(true);
    });

    /** `importRules.md`: subjects are case insensitive. */
    it.each(["NEW: Order", "new: order", "New: Order", "nEw: Order"])(
      "matches the prefix case-insensitively in %p",
      (subject) => {
        expect(
          selectMessage(message("orders@carrier.test", subject), RULES)
            .accepted,
        ).toBe(true);
      },
    );

    it("ignores leading whitespace in the subject", () => {
      expect(
        selectMessage(message("orders@carrier.test", "   NEW: Order"), RULES)
          .accepted,
      ).toBe(true);
    });

    it("matches the sender case-insensitively", () => {
      expect(
        selectMessage(message("Orders@Carrier.TEST", "NEW: Order"), RULES)
          .accepted,
      ).toBe(true);
    });

    it("honours a configured prefix other than the default", () => {
      const selection = selectMessage(
        message("orders@carrier.test", "TRANSPORT: Order"),
        { ...RULES, newSubjectPrefix: "TRANSPORT:" },
      );

      expect(selection.accepted).toBe(true);
    });
  });

  describe("an untrusted sender", () => {
    it("is refused even with a valid NEW subject", () => {
      const selection = selectMessage(
        message("stranger@elsewhere.test", "NEW: Trucking Order"),
        RULES,
      );

      expect(selection.accepted).toBe(false);
      expect(selection.outcome).toBe(SelectionOutcome.UNTRUSTED_SENDER);
    });

    /**
     * Exact matching, deliberately. Trusting a domain suffix would trust every
     * address that domain can ever issue, which no requirement asks for.
     */
    it("does not trust a lookalike domain", () => {
      expect(
        selectMessage(
          message("orders@carrier.test.attacker.test", "NEW: Order"),
          RULES,
        ).accepted,
      ).toBe(false);
    });

    it("does not trust a different mailbox at a trusted domain", () => {
      expect(
        selectMessage(message("anyone@carrier.test", "NEW: Order"), RULES)
          .accepted,
      ).toBe(false);
    });

    it("refuses everyone when the allowlist is empty", () => {
      expect(
        selectMessage(message("orders@carrier.test", "NEW: Order"), {
          ...RULES,
          trustedSenders: [],
        }).accepted,
      ).toBe(false);
    });

    it("reports the sender as the reason, not the subject", () => {
      const selection = selectMessage(
        message("stranger@elsewhere.test", "CANCEL: Order"),
        RULES,
      );

      expect(selection.outcome).toBe(SelectionOutcome.UNTRUSTED_SENDER);
    });
  });

  /**
   * The three instructions this system carries out. The ACTION is read from the
   * subject and from nowhere else — never from the attached document, whose own
   * CANCELLED stamp is a separate statement handled by the importer.
   */
  describe("the instruction a subject asks for", () => {
    it.each([
      ["NEW: Trucking Order", MessageAction.NEW],
      ["new: trucking order", MessageAction.NEW],
      ["UPDATE: Booking Changed", MessageAction.UPDATE],
      ["update: booking changed", MessageAction.UPDATE],
      ["CANCEL: Booking Cancelled", MessageAction.CANCEL],
      ["cancel: booking cancelled", MessageAction.CANCEL],
    ])("reads %p as %s", (subject, expected) => {
      const selection = selectMessage(
        message("orders@carrier.test", subject),
        RULES,
      );

      expect(selection.accepted).toBe(true);
      expect(selection.action).toBe(expected);
      expect(selection.outcome).toBe(SelectionOutcome.ACCEPTED);
    });

    it("gives an unrecognised subject no action at all", () => {
      const selection = selectMessage(
        message("orders@carrier.test", "Fwd: lunch"),
        RULES,
      );

      expect(selection.accepted).toBe(false);
      expect(selection.action).toBeNull();
    });

    /** A stranger's instruction is not carried out, whatever it asks for. */
    it("gives an untrusted sender no action, even asking to cancel", () => {
      const selection = selectMessage(
        message("stranger@elsewhere.test", "CANCEL: Order"),
        RULES,
      );

      expect(selection.accepted).toBe(false);
      expect(selection.action).toBeNull();
    });
  });

  describe("anything else", () => {
    it.each(["Fwd: lunch", "", "   ", "Order", "RE: NEW: Order"])(
      "refuses %p as unrecognised",
      (subject) => {
        const selection = selectMessage(
          message("orders@carrier.test", subject),
          RULES,
        );

        expect(selection.accepted).toBe(false);
        expect(selection.outcome).toBe(SelectionOutcome.NO_RECOGNISED_PREFIX);
      },
    );

    it("requires the prefix at the start, not merely somewhere", () => {
      expect(
        selectMessage(
          message("orders@carrier.test", "Please handle NEW: Order"),
          RULES,
        ).accepted,
      ).toBe(false);
    });
  });
});
