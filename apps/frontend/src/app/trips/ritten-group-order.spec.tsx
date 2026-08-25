import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import { toGroupDisplayOrder } from "@/lib/ritten/group-order";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The order the legs of a Combination are read in.
 *
 * ── DISPLAY ONLY ────────────────────────────────────────────────────────────
 * The backend keeps its own order — import, export, pricing and the Trips' own
 * ids are all untouched — and this is applied when the group is rendered. The
 * tests below hold both halves of that: DUB is shown first, and the array the
 * page fetched is not reordered underneath anyone.
 *
 * It is NOT an alphabetical sort. A booking with neither prefix keeps the place
 * it arrived in, because whatever order the backend gave it means something
 * this rule was never told about.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "97777777-7777-4777-8777-777777777777";

function leg(bookingNumber: string, id = bookingNumber): Trip {
  return buildTrip({ id, bookingNumber, tripGroupId: GROUP_ID });
}

describe("the display order of a Combination", () => {
  describe("the rule itself", () => {
    it("puts DUB before ANR", () => {
      const ordered = toGroupDisplayOrder([leg("ANRBEL2603249"), leg("DUBANR2598395")]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "DUBANR2598395",
        "ANRBEL2603249",
      ]);
    });

    it("leaves DUB first when it already is", () => {
      const ordered = toGroupDisplayOrder([leg("DUBANR2598395"), leg("ANRBEL2603249")]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "DUBANR2598395",
        "ANRBEL2603249",
      ]);
    });

    it("compares the prefix without regard to case", () => {
      const ordered = toGroupDisplayOrder([leg("anrbel2603249"), leg("dubanr2598395")]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "dubanr2598395",
        "anrbel2603249",
      ]);
    });

    /** Stable: two of the same prefix keep the order the backend gave them. */
    it("keeps the relative order of several DUB legs", () => {
      const ordered = toGroupDisplayOrder([
        leg("DUBANR1"),
        leg("DUBANR2"),
        leg("DUBANR3"),
      ]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "DUBANR1",
        "DUBANR2",
        "DUBANR3",
      ]);
    });

    it("keeps the relative order of several ANR legs", () => {
      const ordered = toGroupDisplayOrder([
        leg("ANRBEL3"),
        leg("ANRBEL1"),
        leg("ANRBEL2"),
      ]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "ANRBEL3",
        "ANRBEL1",
        "ANRBEL2",
      ]);
    });

    it("moves both prefixes around the ones it does not know", () => {
      const ordered = toGroupDisplayOrder([
        leg("ANRBEL2603249"),
        leg("ZZZOTHER1"),
        leg("DUBANR2598395"),
      ]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "DUBANR2598395",
        "ZZZOTHER1",
        "ANRBEL2603249",
      ]);
    });

    /** Not an alphabetic sort: unknown bookings are not reordered among themselves. */
    it("keeps the relative order of unrecognised bookings", () => {
      const ordered = toGroupDisplayOrder([
        leg("ZZZOTHER2"),
        leg("AAAOTHER1"),
        leg("MMMOTHER3"),
      ]);

      expect(ordered.map((trip) => trip.bookingNumber)).toEqual([
        "ZZZOTHER2",
        "AAAOTHER1",
        "MMMOTHER3",
      ]);
    });

    it("copes with a leg that has no booking number yet", () => {
      const ordered = toGroupDisplayOrder([
        buildTrip({ id: "none", bookingNumber: null }),
        leg("DUBANR2598395"),
      ]);

      expect(ordered.map((trip) => trip.id)).toEqual(["DUBANR2598395", "none"]);
    });

    /** The fetched response is shared; reordering it in place would move it for everyone. */
    it("returns a new array and leaves the source untouched", () => {
      const source: readonly Trip[] = Object.freeze([
        leg("ANRBEL2603249"),
        leg("DUBANR2598395"),
      ]);

      const ordered = toGroupDisplayOrder(source);

      expect(ordered).not.toBe(source);
      expect(source.map((trip) => trip.bookingNumber)).toEqual([
        "ANRBEL2603249",
        "DUBANR2598395",
      ]);
    });

    it("is applied again to the same input, with the same result", () => {
      const source = [leg("ANRBEL2603249"), leg("DUBANR2598395")];

      const first = toGroupDisplayOrder(source);
      const second = toGroupDisplayOrder(source);

      expect(second.map((trip) => trip.bookingNumber)).toEqual(
        first.map((trip) => trip.bookingNumber),
      );
    });
  });

  describe("in the Combination dialog", () => {
    beforeEach(() => {
      requestMock.mockReset();
      window.localStorage.clear();
    });

    /** The backend answers ANR first; the dialog still reads DUB first. */
    async function openCombination(members: Trip[]) {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: members,
      });
      renderRitten();

      await userEvent.click(await screen.findByText("G-9777"));

      return screen.findByRole("dialog");
    }

    function bookingsIn(dialog: HTMLElement): string[] {
      return within(dialog)
        .getAllByRole("link")
        .map((link) => link.textContent ?? "");
    }

    it("shows the DUB leg first and the ANR leg second", async () => {
      const dialog = await openCombination([
        leg("ANRBEL2603249", "anr"),
        leg("DUBANR2598395", "dub"),
      ]);

      expect(bookingsIn(dialog)).toEqual(["DUBANR2598395", "ANRBEL2603249"]);
    });

    it("leaves the order alone when the backend already sent DUB first", async () => {
      const dialog = await openCombination([
        leg("DUBANR2598395", "dub"),
        leg("ANRBEL2603249", "anr"),
      ]);

      expect(bookingsIn(dialog)).toEqual(["DUBANR2598395", "ANRBEL2603249"]);
    });

    /** Nothing is persisted: the request that fetched them is a plain read. */
    it("sends no request to record the order", async () => {
      await openCombination([leg("ANRBEL2603249", "anr"), leg("DUBANR2598395", "dub")]);

      const writes = requestMock.mock.calls.filter(
        ([, options]) =>
          ((options as { method?: string } | undefined)?.method ?? "GET") !==
          "GET",
      );

      expect(writes).toHaveLength(0);
    });

    /** Reopening fetches the ordinary data and applies the rule again. */
    it("applies the same order the second time it is opened", async () => {
      const dialog = await openCombination([
        leg("ANRBEL2603249", "anr"),
        leg("DUBANR2598395", "dub"),
      ]);

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Sluiten" }),
      );
      await userEvent.click(screen.getByText("G-9777"));

      expect(bookingsIn(await screen.findByRole("dialog"))).toEqual([
        "DUBANR2598395",
        "ANRBEL2603249",
      ]);
    });

    /** The list itself is not reordered — only the group view is. */
    it("does not reorder the Ritten table", async () => {
      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({ id: "anr", bookingNumber: "ANRBEL2603249" }),
          buildTrip({ id: "dub", bookingNumber: "DUBANR2598395" }),
        ]),
      });
      renderRitten();

      const rows = await screen.findAllByRole("link", {
        name: /^(ANR|DUB)/,
      });

      expect(rows.map((link) => link.textContent)).toEqual([
        "ANRBEL2603249",
        "DUBANR2598395",
      ]);
    });
  });
});
