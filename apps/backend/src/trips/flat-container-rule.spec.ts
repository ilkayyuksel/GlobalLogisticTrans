import {
  FLAT_CUSTOM_PROPERTY_NAME,
  requiresFlatProperty,
} from "./flat-container-rule";

/**
 * Which container types owe the Flat property.
 *
 * The whole rule is one predicate, and the tests that matter are the near
 * misses: a `startsWith` or an `includes` would pass every case below that says
 * "yes" and quietly charge for `20STUFF` as well. Each "no" here is a way of
 * writing the rule that would have been wrong.
 */
describe("requiresFlatProperty", () => {
  it.each(["20FL", "20ST"])("requires it for %s", (containerType) => {
    expect(requiresFlatProperty(containerType)).toBe(true);
  });

  it.each(["45PH", "45OS", "45RH", "20TK", "20RF"])(
    "does not require it for %s",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  /*
   * The codes that begin with one of the two. A flat rack is a 20FL and
   * nothing else; anything longer is a different container type whose charge
   * this rule knows nothing about.
   */
  it.each(["20FLX", "20STUFF", "20FL1", "20STX"])(
    "does not match %s, which merely begins with one",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  it.each(["X20FL", "A20ST"])(
    "does not match %s, which merely contains one",
    (containerType) => {
      expect(requiresFlatProperty(containerType)).toBe(false);
    },
  );

  /** The normalisation the Trip domain already applies, and no more. */
  describe("normalisation", () => {
    it.each(["20fl", "20Fl", "20sT", "20st"])(
      "ignores the capitals in %p",
      (containerType) => {
        expect(requiresFlatProperty(containerType)).toBe(true);
      },
    );

    it.each([" 20FL", "20FL ", "  20ST  ", "\t20FL\n"])(
      "ignores the surrounding whitespace in %p",
      (containerType) => {
        expect(requiresFlatProperty(containerType)).toBe(true);
      },
    );

    it("does not ignore whitespace inside the code", () => {
      expect(requiresFlatProperty("20 FL")).toBe(false);
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
