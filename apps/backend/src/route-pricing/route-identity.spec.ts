import { isSameCombination, isSameRoad } from "./route-identity";

/**
 * What makes two route configurations the same one.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 * Three places used to answer it separately: the bulk importer kept its own
 * comparison, the Combination service asked the repository, and the database had
 * a unique index. When they disagreed, an import was refused for a reason no
 * screen could explain. One definition, tested here, is what keeps them agreeing.
 *
 * ── THE RULE THIS FILE EXISTS TO STATE ──────────────────────────────────────
 * A Combination is identified by its PAIR of legs, never by either leg alone.
 * Everything leaving MPET 1742 shares its outbound, and each of those is its own
 * Combination with its own return.
 */

const QUAY_LESSINES = { departure: "Quay 869", destination: "LESSINES" };
const LESSINES_BACK = { departure: "LESSINES", destination: "Quay 869" };
const LESSINES_KALLO = { departure: "LESSINES", destination: "Kallo" };

describe("isSameRoad", () => {
  it("is the same road when both ends match", () => {
    expect(isSameRoad(QUAY_LESSINES, { ...QUAY_LESSINES })).toBe(true);
  });

  it("is a different road when the destination differs", () => {
    expect(isSameRoad(QUAY_LESSINES, LESSINES_KALLO)).toBe(false);
  });

  /** A road runs one way: the reverse of it is the other leg, not the same one. */
  it("is a different road when the ends are swapped", () => {
    expect(isSameRoad(QUAY_LESSINES, LESSINES_BACK)).toBe(false);
  });

  /**
   * The canonical terminal rule, through the shared helper: the operator's
   * configuration and the documents disagree about the PSA prefix, and both mean
   * one place.
   */
  it("reads PSA Quay 869 and Quay 869 as one terminal", () => {
    expect(
      isSameRoad(QUAY_LESSINES, {
        departure: "PSA Quay 869",
        destination: "LESSINES",
      }),
    ).toBe(true);
  });
});

describe("isSameCombination", () => {
  it("is the same Combination when both legs match", () => {
    expect(
      isSameCombination(
        [QUAY_LESSINES, LESSINES_BACK],
        [{ ...QUAY_LESSINES }, { ...LESSINES_BACK }],
      ),
    ).toBe(true);
  });

  /**
   * The position tells an operator which leg is the outbound and is kept exactly
   * as configured — but pricing selects a leg by its road and never by its
   * position, so a swapped pair would price every Trip identically. It is the
   * same configuration written the other way round.
   */
  it("is the same Combination when the legs are swapped", () => {
    expect(
      isSameCombination(
        [QUAY_LESSINES, LESSINES_BACK],
        [LESSINES_BACK, QUAY_LESSINES],
      ),
    ).toBe(true);
  });

  /** THE point of this module: one shared leg is not one Combination. */
  it("is a different Combination when only one leg matches", () => {
    expect(
      isSameCombination(
        [QUAY_LESSINES, LESSINES_BACK],
        [QUAY_LESSINES, LESSINES_KALLO],
      ),
    ).toBe(false);
  });

  it("is a different Combination when neither leg matches", () => {
    expect(
      isSameCombination(
        [QUAY_LESSINES, LESSINES_BACK],
        [LESSINES_KALLO, { departure: "Kallo", destination: "LESSINES" }],
      ),
    ).toBe(false);
  });

  it("applies the terminal rule to both legs", () => {
    expect(
      isSameCombination(
        [QUAY_LESSINES, LESSINES_BACK],
        [
          { departure: "PSA Quay 869", destination: "LESSINES" },
          { departure: "LESSINES", destination: "Quay 869" },
        ],
      ),
    ).toBe(true);
  });

  /**
   * A group holding one road twice is refused before it can be stored, so this
   * comparison never has to pretend such a pair is meaningful — but it must not
   * report a one-legged list as equal to a two-legged one.
   */
  it("is not the same Combination as a list of a different length", () => {
    expect(isSameCombination([QUAY_LESSINES], [QUAY_LESSINES, LESSINES_BACK])).toBe(
      false,
    );
  });
});
