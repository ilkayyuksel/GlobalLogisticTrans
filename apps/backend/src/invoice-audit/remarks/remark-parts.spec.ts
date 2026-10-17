import { RemarkKind, isStated, toRemarkParts, toStatedCcNumbers, withRemarkParts } from "./remark-parts";

/** The Remarks as week 36 and week 41 write them. */
describe("Remarks parts", () => {
  const none = new Set<string>();

  describe("isStated", () => {
    it("finds tar however the customer writes it", () => {
      const tar = { kind: RemarkKind.TAR, text: "tar" };

      expect(isStated(tar, toRemarkParts("tar  "), none)).toBe(true);
      expect(isStated(tar, toRemarkParts("tar 869,Tar 1742 OP"), none)).toBe(true);
      expect(isStated(tar, toRemarkParts("flat,TAR"), none)).toBe(true);
      expect(isStated(tar, toRemarkParts("flat"), none)).toBe(false);
      // A word that merely starts with the letters is not TAR.
      expect(isStated(tar, toRemarkParts("tarief"), none)).toBe(false);
    });

    it("finds a property by its own name only", () => {
      const flat = { kind: RemarkKind.PROPERTY, text: "flat" };

      expect(isStated(flat, toRemarkParts("Flat,tar"), none)).toBe(true);
      expect(
        isStated({ kind: RemarkKind.PROPERTY, text: "aan/afkoppelen" }, toRemarkParts("tar,AANKOPPELEN"), none),
      ).toBe(false);
    });

    it("finds a confirmation on any row of the Trip", () => {
      const ec = { kind: RemarkKind.COST_CONFIRMATION, text: "EC 4220981", ccNumber: "4220981" };

      expect(isStated(ec, [], new Set(["4220981"]))).toBe(true);
      expect(isStated(ec, [], new Set(["4220982"]))).toBe(false);
    });

    it("finds a waiting time in the customer's own spelling", () => {
      const waiting = { kind: RemarkKind.WAITING, text: "wachtuur 10:00 tot 11:00" };

      expect(isStated(waiting, toRemarkParts("tar,wachtuur kaai 10:00 tot 11:00"), none)).toBe(true);
      expect(isStated(waiting, toRemarkParts("tar,EC 4160715,wachtuur 13u tot 15,30"), none)).toBe(true);
    });

    it("finds GEEN COMBI once written", () => {
      const geenCombi = { kind: RemarkKind.GEEN_COMBI, text: "GEEN COMBI" };

      expect(isStated(geenCombi, toRemarkParts("tar,geen combi"), none)).toBe(true);
      expect(isStated(geenCombi, toRemarkParts("tar"), none)).toBe(false);
    });
  });

  describe("withRemarkParts", () => {
    it("adds at the end with a comma and no space", () => {
      expect(withRemarkParts("tar,EC 4220979", ["GEEN COMBI"])).toBe("tar,EC 4220979,GEEN COMBI");
    });

    it("lets only trailing spaces give way to the comma", () => {
      expect(withRemarkParts("tar  ", ["EC 1"])).toBe("tar,EC 1");
      expect(withRemarkParts("  tar", ["EC 1"])).toBe("  tar,EC 1");
    });

    it("writes into an empty cell without a leading comma", () => {
      expect(withRemarkParts("", ["tar", "EC 1"])).toBe("tar,EC 1");
    });

    it("leaves the text exactly as it was when nothing is added", () => {
      expect(withRemarkParts("tar  ", [])).toBe("tar  ");
    });
  });

  it("reads the EC numbers a Remarks text names", () => {
    expect(toStatedCcNumbers("flat,tar,EC 467866,wachtuur kaai 8,45 tot 11:00")).toEqual(["467866"]);
  });
});
