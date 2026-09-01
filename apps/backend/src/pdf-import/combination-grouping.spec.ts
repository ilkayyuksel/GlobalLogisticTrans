import { TripStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CombinationLeg,
  combinationLegOf,
  isGenuineCombination,
} from "../pricing-engine/combination-leg";
import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * Every genuine Combination belongs to exactly one TripGroup.
 *
 * ── WHAT A GENUINE COMBINATION IS ───────────────────────────────────────────
 * ONE transport order that printed two legs: an outbound DELIVERY and a return
 * COLLECTION. The parser detects that layout and ties the two together, and the
 * import creates one TripGroup and puts both legs in it — in the same
 * transaction that creates them, so a group with one member never exists.
 *
 * ── AND WHAT IT IS NOT ──────────────────────────────────────────────────────
 * A manual TripGroup is an operator convenience: any Trips at all, tied
 * together for their own reasons. It carries no claim about directions or
 * pairing and must never be priced as a Combination.
 *
 * These tests hold both halves in place at once — that the automatic group is
 * created, and that having a group is still not what MAKES a Combination. The
 * pricing rule reads `combinationLegOf`, which additionally requires both legs
 * to have come from the same document, and that is asserted here rather than
 * assumed.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

/** The one real two-page Combination: one document, two legs. */
const COMBINATION = "NEW/combination.pdf";
/** A real single-leg order, for the standalone case. */
const STANDALONE = "NEW/1page.pdf";

function read(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/** The shape `combinationLegOf` needs, taken from what the import stored. */
function asMember(trip: Record<string, unknown>) {
  return {
    id: trip.id as string,
    tripGroupId: (trip.tripGroupId ?? null) as string | null,
    pdfDocumentId: (trip.pdfDocumentId ?? null) as string | null,
    direction: (trip.direction ?? null) as never,
  };
}

function legsOf(harness: RealDocumentHarness) {
  const members = harness.trips.map(asMember);

  return members.map((member) => combinationLegOf(member, members));
}

describe("a genuine Combination and its TripGroup", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-combination-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe("when the document prints both legs", () => {
    it("creates exactly one TripGroup", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(harness.tripGroups).toHaveLength(1);
    });

    it("puts both Trips in it", async () => {
      const result = await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(result.trips).toHaveLength(2);

      const groupIds = result.trips.map((trip) => trip.tripGroupId);

      expect(new Set(groupIds).size).toBe(1);
      expect(groupIds[0]).not.toBeNull();
    });

    it("puts exactly two Trips in it, and no third", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      const [group] = harness.tripGroups;
      const members = harness.trips.filter(
        (trip) => trip.tripGroupId === group,
      );

      expect(members).toHaveLength(2);
      expect(harness.trips).toHaveLength(2);
    });

    it("is one delivery and one collection", async () => {
      const result = await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(new Set(result.trips.map((trip) => trip.direction))).toEqual(
        new Set(["COLLECTION", "DELIVERY"]),
      );
    });

    /**
     * The group is what the domain resolver needs, but not all it needs: both
     * legs must also have come from the same document. Asserted through the
     * real resolver rather than by re-implementing its rule here.
     */
    it("is recognised as a genuine Combination by the pricing resolver", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      const legs = legsOf(harness);

      expect(legs.sort()).toEqual([
        CombinationLeg.COLLECTION,
        CombinationLeg.DELIVERY,
      ]);
      expect(legs.every(isGenuineCombination)).toBe(true);
    });

    /** Both legs came from one document, which is what makes it genuine. */
    it("attributes both legs to the same document", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      const documents = harness.trips.map((trip) => trip.pdfDocumentId);

      expect(new Set(documents).size).toBe(1);
      expect(harness.pdfDocuments).toHaveLength(1);
    });
  });

  /**
   * ── THE SAME ORDER TWICE ──────────────────────────────────────────────────
   * A re-sent order is the sender's latest word on a transport we already hold,
   * so it is applied to the Trips holding that identity. It must not create a
   * second group, and neither leg may drift out of the one it is in.
   */
  describe("when the same Combination arrives again", () => {
    it("creates no second TripGroup", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(harness.tripGroups).toHaveLength(1);
    });

    it("creates no third or fourth Trip", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(harness.trips).toHaveLength(2);
    });

    it("leaves both legs in the one group they were in", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      const before = harness.trips.map((trip) => trip.tripGroupId);

      await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(harness.trips.map((trip) => trip.tripGroupId)).toEqual(before);
      expect(new Set(before).size).toBe(1);
    });

    it("is still a genuine Combination afterwards", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(COMBINATION), COMBINATION);

      expect(legsOf(harness).every(isGenuineCombination)).toBe(true);
    });

    /** The same document arriving as a revision behaves the same way. */
    it("creates no second group when it arrives as a revision", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(harness.tripGroups).toHaveLength(1);
      expect(harness.trips).toHaveLength(2);
    });
  });

  /**
   * ── A COMBINATION THAT ARRIVES AS AN UPDATE ───────────────────────────────
   * When neither leg is held, the revision creates both — from ONE stored
   * document — so the pair is grouped and genuine exactly as a NEW order's
   * would be.
   */
  describe("when a Combination first arrives as a revision", () => {
    it("creates both legs in one group", async () => {
      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(harness.trips).toHaveLength(2);
      expect(harness.tripGroups).toHaveLength(1);
      expect(
        new Set(harness.trips.map((trip) => trip.tripGroupId)).size,
      ).toBe(1);
    });

    it("is a genuine Combination for pricing", async () => {
      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(legsOf(harness).every(isGenuineCombination)).toBe(true);
    });
  });

  /**
   * ── A STANDALONE ORDER ────────────────────────────────────────────────────
   * One leg, no pairing, and therefore no group at all. A group of one is never
   * a Combination.
   */
  describe("a standalone order", () => {
    it("creates no TripGroup", async () => {
      const result = await harness.importer.import(read(STANDALONE), STANDALONE);

      expect(result.trips).toHaveLength(1);
      expect(result.trips[0].tripGroupId).toBeNull();
      expect(harness.tripGroups).toEqual([]);
    });

    it("is not a Combination leg", async () => {
      await harness.importer.import(read(STANDALONE), STANDALONE);

      expect(legsOf(harness)).toEqual([CombinationLeg.NONE]);
    });
  });

  /**
   * ── A THIRD TRIP NEVER JOINS ──────────────────────────────────────────────
   * A standalone order imported alongside a Combination stays outside it. There
   * is no such thing as a three-leg Combination.
   */
  describe("a Combination beside an unrelated Trip", () => {
    it("leaves the third Trip out of the group", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(STANDALONE), STANDALONE);

      const [group] = harness.tripGroups;
      const members = harness.trips.filter((trip) => trip.tripGroupId === group);

      expect(harness.trips).toHaveLength(3);
      expect(members).toHaveLength(2);
    });

    it("creates no second group for it", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(STANDALONE), STANDALONE);

      expect(harness.tripGroups).toHaveLength(1);
    });

    it("prices the third Trip as an ordinary Trip", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);
      await harness.importer.import(read(STANDALONE), STANDALONE);

      const legs = legsOf(harness);

      expect(legs.filter(isGenuineCombination)).toHaveLength(2);
      expect(legs.filter((leg) => leg === CombinationLeg.NONE)).toHaveLength(1);
    });
  });

  /**
   * ── A MANUAL GROUP IS NOT A COMBINATION ───────────────────────────────────
   * Two standalone Trips an operator tied together share a group, and share
   * nothing else. They came from different documents, so the resolver reports
   * NONE and no Combination charge follows from the group id alone.
   *
   * This is the rule that must not be simplified to `tripGroupId !== null`.
   */
  describe("a manual group of two standalone Trips", () => {
    it("is not a genuine Combination, despite sharing a group", async () => {
      await harness.importer.import(read(STANDALONE), STANDALONE);
      await harness.importer.import(read(COMBINATION), COMBINATION);

      // An operator ties the standalone Trip to one leg by hand.
      const [standalone] = harness.trips;
      const manualGroup = "manual-group-1";

      standalone.tripGroupId = manualGroup;
      harness.trips[1].tripGroupId = manualGroup;

      const members = harness.trips.map(asMember);

      expect(
        combinationLegOf(asMember(standalone), members),
      ).toBe(CombinationLeg.NONE);
    });

    it("does not make two unrelated Trips a Combination", async () => {
      await harness.importer.import(read(STANDALONE), STANDALONE);

      const other = {
        ...harness.trips[0],
        id: "trip-manual-2",
        pdfDocumentId: "pdf-elsewhere",
        direction: "COLLECTION",
      };

      harness.trips.push(other);

      for (const trip of harness.trips) {
        trip.tripGroupId = "manual-group-1";
      }

      const members = harness.trips.map(asMember);

      for (const member of members) {
        expect(combinationLegOf(member, members)).toBe(CombinationLeg.NONE);
        expect(isGenuineCombination(combinationLegOf(member, members))).toBe(
          false,
        );
      }
    });
  });

  /**
   * ── ONE LEG ALREADY PLANNED ───────────────────────────────────────────────
   * The established rule, asserted rather than assumed, because it is the one
   * case where the outcome surprises people:
   *
   *   "A Combination is only recreated as one when BOTH of its legs are
   *    missing. With one leg already planned, grouping the new Trip would mean
   *    rearranging work somebody is already doing, which no document asks for."
   *
   * So a Combination document whose DELIVERY leg is already held creates the
   * COLLECTION leg UNGROUPED, and the pair is not a genuine Combination. The
   * two legs came from different documents, which is precisely what
   * `combinationLegOf` refuses to treat as one.
   *
   * This is recorded here so the behaviour is visible and deliberate. Changing
   * it is a business decision, not a refactor: pairing legs across two
   * documents would need the resolver's same-document rule to change with it,
   * and that rule is what keeps a manual group from being priced as a
   * Combination.
   */
  describe("when only one leg is already held", () => {
    /** The DELIVERY leg of the real Combination, planned from an earlier order. */
    function seedDeliveryLeg() {
      harness.trips.push({
        id: "trip-existing-delivery",
        bookingNumber: "DUBANR2598395",
        containerNumber: "PVDU3013260",
        originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
        planningDate: new Date("2025-05-22T00:00:00.000Z"),
        direction: "DELIVERY",
        status: TripStatus.OPEN,
        containerType: "45PH",
        terminal: "PSA Quay 869",
        destinationCity: "Kallo",
        destinationCountry: "Belgium",
        tripGroupId: null,
        // An EARLIER document: this leg was not created by the one arriving now.
        pdfDocumentId: "pdf-earlier",
      });
    }

    it("creates the missing leg without grouping it", async () => {
      seedDeliveryLeg();

      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(harness.trips).toHaveLength(2);
      expect(harness.tripGroups).toEqual([]);
      expect(
        harness.trips.every((trip) => (trip.tripGroupId ?? null) === null),
      ).toBe(true);
    });

    it("does not rearrange the leg somebody is already working on", async () => {
      seedDeliveryLeg();

      await harness.importer.revise(read(COMBINATION), COMBINATION);

      const existing = harness.trips.find(
        (trip) => trip.id === "trip-existing-delivery",
      );

      expect(existing?.tripGroupId ?? null).toBeNull();
    });

    /**
     * And the pair is NOT a genuine Combination, because the legs came from
     * different documents. Grouping them would not change that — it would only
     * produce a group the pricing resolver still reads as NONE.
     */
    it("is not a genuine Combination for pricing", async () => {
      seedDeliveryLeg();

      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(legsOf(harness).every((leg) => leg === CombinationLeg.NONE)).toBe(
        true,
      );
    });
  });

  /**
   * A DELETED leg keeps its group: deletion is reversible, and stripping the
   * relationship would make a restore unable to put the pair back together.
   */
  describe("when one leg is deleted", () => {
    it("keeps the group on both Trips", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      const [group] = harness.tripGroups;

      harness.trips[0].status = TripStatus.DELETED;

      expect(
        harness.trips.every((trip) => trip.tripGroupId === group),
      ).toBe(true);
    });

    it("creates no new group for the surviving leg", async () => {
      await harness.importer.import(read(COMBINATION), COMBINATION);

      harness.trips[0].status = TripStatus.DELETED;

      await harness.importer.revise(read(COMBINATION), COMBINATION);

      expect(harness.tripGroups).toHaveLength(1);
    });
  });
});
