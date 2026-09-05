import { hasTarNummer, meaningfulTarNummer } from "./tar-nummer";

/**
 * The one definition of "this Trip states a TAR-nummer".
 *
 * ── WHY IT IS TESTED ON ITS OWN ─────────────────────────────────────────────
 * Four layers ask this question — the DTO that stores the value, the group rule
 * that copies it, the WhatsApp caption that prints it and the Pricing Engine
 * that charges for it. The last of those decides money, so the definition is
 * pinned here once rather than re-asserted in four places that could drift.
 */
describe("whether a TAR-nummer is stated", () => {
  describe("absence", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an empty string", ""],
      ["spaces", "   "],
      ["a tab", "\t"],
      ["a newline", "\n"],
      ["a carriage return", "\r"],
      ["mixed whitespace", " \t\n "],
      ["a non-breaking space", " "],
    ])("%s states none", (_label, value) => {
      expect(hasTarNummer(value)).toBe(false);
      expect(meaningfulTarNummer(value)).toBeNull();
    });
  });

  describe("presence", () => {
    it.each(["TAR123", "12345", "tar/2026 nr 7", "AB-99/x", "🚚", "0"])(
      "%p is stated",
      (value) => {
        expect(hasTarNummer(value)).toBe(true);
        expect(meaningfulTarNummer(value)).toBe(value);
      },
    );

    /** "0" deserves its own mention: it is text, not a number, and not falsy. */
    it("treats a zero as a real value", () => {
      expect(hasTarNummer("0")).toBe(true);
    });
  });

  describe("padding", () => {
    it.each([
      ["  TAR123  ", "TAR123"],
      ["\tTAR123\n", "TAR123"],
      ["TAR 123", "TAR 123"],
    ])("reduces %p to %p", (value, expected) => {
      expect(meaningfulTarNummer(value)).toBe(expected);
    });

    /** Inner spacing is part of the value; only the edges are padding. */
    it("keeps spacing inside the value", () => {
      expect(meaningfulTarNummer("  tar/2026 nr 7  ")).toBe("tar/2026 nr 7");
    });
  });

  /** It judges presence, never shape: no format is enforced anywhere. */
  it("enforces no format", () => {
    for (const value of ["x", "!", "----", "0000000000"]) {
      expect(hasTarNummer(value)).toBe(true);
    }
  });

  it("is not fooled by a non-string", () => {
    expect(hasTarNummer(42 as unknown as string)).toBe(false);
    expect(meaningfulTarNummer({} as unknown as string)).toBeNull();
  });
});
