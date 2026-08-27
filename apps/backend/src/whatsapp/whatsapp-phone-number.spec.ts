import {
  PhoneNumberRefusal,
  toWhatsAppNumber,
} from "./whatsapp-phone-number";

/**
 * Turning a stored driver number into a WhatsApp address.
 *
 * The forms below are the ones this database actually holds — checked against
 * the `driver` table, not imagined — plus the ways an operator might reasonably
 * type one. Nothing here guesses a country: a number that does not say which
 * country it belongs to is refused, because guessing Belgium would eventually
 * send a transport order to a stranger.
 */
describe("addressing a driver's phone number for WhatsApp", () => {
  describe("the forms this system stores", () => {
    /** Exactly how the seeded and imported drivers are recorded. */
    it("accepts an international number written with spaces", () => {
      expect(toWhatsAppNumber("+32 470 11 22 33")).toEqual({
        whatsAppNumber: "32470112233",
        reason: null,
      });
    });

    it.each([
      ["+32470112233", "32470112233"],
      ["+32-470-11-22-33", "32470112233"],
      ["+32 (470) 11.22.33", "32470112233"],
      ["  +32 470 11 22 33  ", "32470112233"],
    ])("normalises %s", (stored, expected) => {
      expect(toWhatsAppNumber(stored).whatsAppNumber).toBe(expected);
    });

    /** `00` is what a keypad produces for `+`, and address books carry both. */
    it("accepts the 00 form of an international prefix", () => {
      expect(toWhatsAppNumber("0032 470 11 22 33").whatsAppNumber).toBe(
        "32470112233",
      );
    });

    it("accepts a number from another country unchanged", () => {
      expect(toWhatsAppNumber("+90 532 123 45 67").whatsAppNumber).toBe(
        "905321234567",
      );
    });
  });

  describe("the numbers it refuses", () => {
    it.each([null, "", "   "])("reports %p as missing", (stored) => {
      expect(toWhatsAppNumber(stored)).toEqual({
        whatsAppNumber: null,
        reason: PhoneNumberRefusal.MISSING,
      });
    });

    /**
     * The important refusal. "0470 11 22 33" is unambiguous to a Belgian reader
     * and unanswerable here, and prefixing +32 would be this system inventing a
     * country. A wrong guess sends a transport order to a stranger.
     */
    it("refuses a national number rather than guessing a country", () => {
      expect(toWhatsAppNumber("0470 11 22 33")).toEqual({
        whatsAppNumber: null,
        reason: PhoneNumberRefusal.NOT_INTERNATIONAL,
      });
    });

    it("refuses a number with letters or an extension", () => {
      expect(toWhatsAppNumber("+32 470 11 22 33 ext 4").reason).toBe(
        PhoneNumberRefusal.NOT_A_NUMBER,
      );
      expect(toWhatsAppNumber("+32 470 BEL CAR").reason).toBe(
        PhoneNumberRefusal.NOT_A_NUMBER,
      );
    });

    it("refuses a truncated entry", () => {
      expect(toWhatsAppNumber("+32").reason).toBe(
        PhoneNumberRefusal.NOT_A_NUMBER,
      );
    });

    /** E.164 stops at fifteen digits; anything longer is a typing accident. */
    it("refuses more digits than any real number has", () => {
      expect(toWhatsAppNumber("+3247011223344556677").reason).toBe(
        PhoneNumberRefusal.NOT_A_NUMBER,
      );
    });
  });

  /**
   * This produces an address for one send. The column keeps the form an
   * operator typed, which is the form they will recognise in the Driver screen.
   */
  it("returns a new value and never reports a rewrite of the stored one", () => {
    const stored = "+32 470 11 22 33";

    expect(toWhatsAppNumber(stored).whatsAppNumber).not.toBe(stored);
    expect(stored).toBe("+32 470 11 22 33");
  });
});
