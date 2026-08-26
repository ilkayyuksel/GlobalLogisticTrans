import { normalizeContainerNumber } from "../src/fields/container";

/**
 * The canonical form of a container number.
 *
 * ── WHY THE RULE EXISTS ─────────────────────────────────────────────────────
 * A document prints `EUCU 145129/5` for a human to read; the identifier is
 * `EUCU1451295`. Two documents describing one container can print it
 * differently, and until they were reduced to the same string, matching an
 * UPDATE or a CANCEL against a stored Trip compared typography rather than
 * identity.
 *
 * ── AND WHAT IT MUST NEVER TOUCH ────────────────────────────────────────────
 * A BOOKING number. It prints as `ANRDUB2794719 /67036944`, where the slash
 * separates the booking from the TRIP number — applying this to one would fuse
 * two identifiers into a third that means nothing. Containers and bookings are
 * different things that happen to share a punctuation mark, and the tests below
 * pin that difference down.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("normalizeContainerNumber", () => {
  describe("what it removes", () => {
    it.each([
      ["EUCU 145129/5", "EUCU1451295"],
      ["EUCU 453232/2", "EUCU4532322"],
      ["PVDU 301326/0", "PVDU3013260"],
      ["CNEU 452297/0", "CNEU4522970"],
      ["EUCU 200024/9", "EUCU2000249"],
    ])("turns %s into %s", (printed, canonical) => {
      expect(normalizeContainerNumber(printed)).toBe(canonical);
    });

    it("removes a slash with no space", () => {
      expect(normalizeContainerNumber("EUCU145129/5")).toBe("EUCU1451295");
    });

    it("removes a space with no slash", () => {
      expect(normalizeContainerNumber("EUCU 1451295")).toBe("EUCU1451295");
    });

    it("removes a backslash used as a separator", () => {
      expect(normalizeContainerNumber("EUCU 145129\\5")).toBe("EUCU1451295");
    });

    it("removes several separators at once", () => {
      expect(normalizeContainerNumber("  EUCU / 145129 / 5 ")).toBe(
        "EUCU1451295",
      );
    });

    it.each(["\t", "\n", "\r"])("removes %j as whitespace", (character) => {
      expect(normalizeContainerNumber(`EUCU${character}1451295`)).toBe(
        "EUCU1451295",
      );
    });
  });

  describe("what it leaves alone", () => {
    it("returns an already canonical value unchanged", () => {
      expect(normalizeContainerNumber("EUCU1451295")).toBe("EUCU1451295");
    });

    it("is idempotent", () => {
      const once = normalizeContainerNumber("EUCU 145129/5") as string;

      expect(normalizeContainerNumber(once)).toBe(once);
    });

    /** No case rule: nothing has suggested two containers differ only by it. */
    it("does not change case", () => {
      expect(normalizeContainerNumber("eucu 145129/5")).toBe("eucu1451295");
    });

    it("keeps every letter and digit", () => {
      expect(normalizeContainerNumber("ABCD 1234567")).toBe("ABCD1234567");
    });

    /** Not a validator: this is canonical formatting, not a new standard. */
    it("does not reject a value that is not shaped like a container", () => {
      expect(normalizeContainerNumber("xtfncghtfg")).toBe("xtfncghtfg");
    });
  });

  describe("absence stays absence", () => {
    it.each([null, undefined])("turns %p into null", (value) => {
      expect(normalizeContainerNumber(value)).toBeNull();
    });

    it.each(["", "   ", "\t", "/", " / ", "\\"])(
      "turns %j into null, because it names nothing",
      (value) => {
        expect(normalizeContainerNumber(value)).toBeNull();
      },
    );

    /**
     * `????` is not a container number, but it is not formatting either. The
     * parser's own rule decides whether such a value is read at all; this
     * function does not invent a meaning for it, and it certainly does not
     * turn it into an identity.
     */
    it("does not silently accept ???? as an identity", () => {
      expect(normalizeContainerNumber("????")).toBe("????");
    });
  });

  /**
   * The rule this function must never be pointed at. These are the real booking
   * formats from the fixtures.
   */
  describe("booking numbers are a different thing", () => {
    it.each([
      "ANRDUB2794719",
      "ANRBEL2772352",
      "DUBANR2776470",
      "ANRCRK2786825",
    ])("leaves %s untouched if it were ever passed", (booking) => {
      // It carries no formatting, so the function is a no-op on one — which is
      // the only reason a mistake here would be survivable rather than silent.
      expect(normalizeContainerNumber(booking)).toBe(booking);
    });

    /**
     * The dangerous case, stated so nobody makes it: a booking printed WITH its
     * trip number would be fused into one meaningless string. This function is
     * never called on that value, and this test exists to say why.
     */
    it("would corrupt a booking printed with its trip number", () => {
      expect(normalizeContainerNumber("ANRDUB2794719 /67036944")).toBe(
        "ANRDUB279471967036944",
      );
    });
  });
});
