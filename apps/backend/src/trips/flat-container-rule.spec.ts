import {
  FLAT_CUSTOM_PROPERTY_NAME,
  requiresFlatProperty,
} from "./flat-container-rule";

/**
 * Which container types owe the Flat property.
 *
 * The whole rule is one predicate, and the tests that matter are the near
 * misses: a `startsWith` or an `includes` would pass every case below that says
 * "yes" and quietly charge for `40OSUFF` as well. Each "no" here is a way of
 * writing the rule that would have been wrong.
 */
describe("requiresFlatProperty", () => {
  /** Exactly these three (owner, 22 October 2026). */
  it.each(["20FL", "40FL", "45OS"])("requires it for %s", (containerType) => {
    expect(requiresFlatProperty(containerType)).toBe(true);
  });

  /** Their neighbours — the other flat racks and open sides — never. */
  it.each(["20ST", "40OS", "45FL", "20OS", "45ST", "20st", " 40OS "])("does not require it for %p", (containerType) => {
    expect(requiresFlatProperty(containerType)).toBe(false);
  });

  it.each(["45PH", "45RH", "20TK", "20RF", "45OSX", "45F"])(
    "does not require it for %s",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  /*
   * The codes that begin with one of the two. A flat rack is a 40FL and
   * nothing else; anything longer is a different container type whose charge
   * this rule knows nothing about.
   */
  it.each(["40FLX", "40OSUFF", "40FL1", "40OSX1"])(
    "does not match %s, which merely begins with one",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  it.each(["X40FL", "A40OS"])(
    "does not match %s, which merely contains one",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  /** The normalisation the Trip domain already applies, and no more. */
  describe("normalisation", () => {
    it.each(["40fl", "40Fl", "45oS", "45os", "20fl"])(
      "ignores the capitals in %p",
      (containerType) => {
        expect(requiresFlatProperty(containerType)).toBe(true);
      },
    );

    it.each([" 40FL", "40FL ", "  45OS  ", "\t20FL\n"])(
      "ignores the surrounding whitespace in %p",
      (containerType) => {
        expect(requiresFlatProperty(containerType)).toBe(true);
      },
    );

    it("does not ignore whitespace inside the code", () => {
      expect(requiresFlatProperty("40 FL")).toBe(false);
    });
  });

  /**
   * A Trip created by hand may have no container type yet — the phone call
   * came before the paperwork. It owes nothing until it does.
   */
  it.each([null, "", "   "])("requires nothing for %p", (containerType) => {
    expect(requiresFlatProperty(containerType)).toBe(false);
  });

  /**
   * The property is named, never identified by id. The name is what the
   * database holds, and getting its capitalisation wrong would silently find
   * no property at all.
   */
  it("names the property exactly as it is configured", () => {
    expect(FLAT_CUSTOM_PROPERTY_NAME).toBe("Flat");
  });
});
