import { screen, within } from "@testing-library/react";

import {
  buildPage,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * A container number, on one line.
 *
 * ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
 * Nothing in the data. A container number is a single identifier that happens
 * to contain a space and a slash — `CNEU 452297/0` is what the documents print
 * and what the column stores, with no escape characters anywhere near it.
 *
 * The column was simply too narrow, and a browser breaks a line at BOTH of
 * those characters. So it wrapped after the space, and worse, after the slash —
 * leaving a line that ends in a bare "/" and reads like a stray backslash or an
 * escaped newline. Two lines also make a column of them impossible to scan.
 *
 * The fix is `whitespace-nowrap`, in a column exactly as wide as the numbers in
 * it: an ordinary number fits whole with no space reserved beside it, and an
 * unusually long one is cut off with an ellipsis rather than widening the whole
 * table. THE STORED VALUE IS UNTOUCHED, and these tests assert that too:
 * nothing is stripped, replaced or normalised on its way to the screen or on
 * its way back to the backend.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Exactly the format the real documents and the real column contain. */
const REAL = "CNEU 452297/0";

/** ISO 6346 without the separators — the other shape that turns up. */
const COMPACT = "MSKU1234567";

async function show(containerNumber: string | null): Promise<HTMLElement> {
  respondWith(requestMock, {
    trips: buildPage([buildTrip({ containerNumber })]),
  });
  renderRitten();

  await screen.findByRole("table");

  return screen.getByRole("row", { name: /ANRDUB2602247/ });
}

/** The cell the container number lives in. */
function containerCell(row: HTMLElement, value: string): HTMLElement {
  return within(row).getByText(value).closest("td") as HTMLElement;
}

describe("the container number in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  describe("the value that reaches the screen", () => {
    it("is the stored one, character for character", async () => {
      const row = await show(REAL);

      expect(within(row).getByText(REAL)).toBeInTheDocument();
    });

    it("shows no backslash", async () => {
      const row = await show(REAL);

      expect(containerCell(row, REAL).textContent).not.toContain("\\");
    });

    it("shows no escaped newline", async () => {
      const row = await show(REAL);

      expect(containerCell(row, REAL).textContent).not.toContain("\\n");
    });

    it("contains no line break of its own", async () => {
      const row = await show(REAL);

      expect(containerCell(row, REAL).textContent).not.toContain("\n");
      expect(containerCell(row, REAL).querySelector("br")).toBeNull();
    });

    it("keeps the space and the slash the format uses", async () => {
      const row = await show(REAL);

      // Neither is an artefact: both are part of the identifier.
      expect(containerCell(row, REAL).textContent).toContain(" ");
      expect(containerCell(row, REAL).textContent).toContain("/");
    });

    it("shows a compact number unchanged too", async () => {
      const row = await show(COMPACT);

      expect(within(row).getByText(COMPACT)).toBeInTheDocument();
    });
  });

  describe("the layout that keeps it there", () => {
    /** The rule that stops the browser breaking at the space and the slash. */
    it("never wraps", async () => {
      const row = await show(REAL);

      expect(containerCell(row, REAL).className).toMatch(/whitespace-nowrap/);
    });

    /**
     * Sized to the value, not to a reserved width. The heading asks for no
     * more than its content (`w-px`), so an ordinary number fits whole with no
     * empty space beside it.
     */
    it("takes the width of the value rather than a fixed one", async () => {
      const row = await show(REAL);
      const heading = screen.getByRole("columnheader", { name: "Container" });

      expect(heading.className).toMatch(/\bw-px\b/);
      expect(heading.className).not.toMatch(/min-w-/);
      expect(containerCell(row, REAL).className).not.toMatch(/min-w-|\bw-\[/);
    });

    /** A long value is cut off inside its cell instead of widening the table. */
    it("caps an unusually long value and keeps the whole of it in the tooltip", async () => {
      const long = "CNEU 452297/0 AND A FAR LONGER REFERENCE";
      const row = await show(long);
      const value = within(row).getByText(long);

      expect(value.className).toMatch(/\btruncate\b/);
      expect(value.className).toMatch(/max-w-\[8\.5rem\]/);
      expect(value).toHaveAttribute("title", long);
    });

    /** The table still scrolls sideways when a screen is too narrow for it. */
    it("leaves the table's horizontal scrolling intact", async () => {
      const row = await show(REAL);
      const table = row.closest("table") as HTMLElement;

      // As wide as its section, with no fixed minimum of its own.
      expect(table.className).toMatch(/\bw-full\b/);
      expect(table.className).not.toMatch(/min-w-/);
      expect(table.parentElement?.className).toMatch(/overflow-x-auto/);
    });

    it("stays on one line when the pricing columns are shown", async () => {
      const row = await show(REAL);

      // The rule is on the cell itself, so it holds however wide the table gets.
      expect(containerCell(row, REAL).className).toMatch(/whitespace-nowrap/);
    });
  });

  describe("what it does not change", () => {
    it("keeps the empty marker for a Trip with no container", async () => {
      const row = await show(null);

      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    });

    /** A display fix writes nothing: the stored value is not normalised. */
    it("sends no request to normalise anything", async () => {
      await show(REAL);

      expect(mutationCalls(requestMock)).toHaveLength(0);
    });

    it("still offers the cell for editing", async () => {
      await show(REAL);

      expect(
        screen.getByRole("button", { name: "Containernummer" }),
      ).toBeEnabled();
    });
  });
});
