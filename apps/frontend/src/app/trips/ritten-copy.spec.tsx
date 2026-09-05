import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Copying a container or booking number out of the Ritten list.
 *
 * ── WHAT THESE GUARD ────────────────────────────────────────────────────────
 *   the PURE value reaches the clipboard — no label, no padding, nothing an
 *     operator would have to delete out of a customer's search box;
 *   the number's own behaviour survives: the booking link still navigates and
 *     the container cell still opens its editor, because a copy button that
 *     hijacks the row is worse than no copy button;
 *   nothing is offered where there is no value to copy;
 *   a clipboard that refuses does not break the row.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP = buildTrip({
  bookingNumber: "ANRDUB2602247",
  containerNumber: "EUCU1451295",
});

/**
 * Our own clipboard stub.
 *
 * MUST be installed after `userEvent.setup()`: user-event replaces
 * `navigator.clipboard` with a stub of its own, and calling this first would
 * hand the assertions a spy nothing writes to.
 */
function useClipboard(): { writeText: jest.Mock } {
  const writeText = jest.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });

  return { writeText };
}

async function showRow() {
  respondWith(requestMock, { trips: buildPage([TRIP]) });
  renderRitten();

  const cell = await screen.findByText("ANRDUB2602247");

  return cell.closest("tr") as HTMLElement;
}

describe("copying a number from the Ritten list", () => {
  it("puts the container number on the clipboard, and nothing else", async () => {
    const user = userEvent.setup();
    const { writeText } = useClipboard();
    const row = await showRow();

    await user.click(
      within(row).getByRole("button", { name: "Containernummer kopiëren" }),
    );

    expect(writeText).toHaveBeenCalledWith("EUCU1451295");
  });

  it("puts the booking number on the clipboard, and nothing else", async () => {
    const user = userEvent.setup();
    const { writeText } = useClipboard();
    const row = await showRow();

    await user.click(
      within(row).getByRole("button", { name: "Boekingsnummer kopiëren" }),
    );

    expect(writeText).toHaveBeenCalledWith("ANRDUB2602247");
  });

  /** The value only — never the label, and never with whitespace around it. */
  it("copies no surrounding text", async () => {
    const user = userEvent.setup();
    const { writeText } = useClipboard();
    const row = await showRow();

    await user.click(
      within(row).getByRole("button", { name: "Boekingsnummer kopiëren" }),
    );

    const copied = writeText.mock.calls[0][0] as string;

    expect(copied).toBe(copied.trim());
    expect(copied).not.toMatch(/kopi|Boeking|\s/);
  });

  it("confirms the copy where the operator is looking", async () => {
    const user = userEvent.setup();
    useClipboard();
    const row = await showRow();

    await user.click(
      within(row).getByRole("button", { name: "Boekingsnummer kopiëren" }),
    );

    expect(await within(row).findByText("Gekopieerd")).toBeInTheDocument();
  });

  describe("it does not take over the row", () => {
    /** A button inside the anchor would break the link; it is a sibling. */
    it("leaves the booking link navigating to the Trip", async () => {
      useClipboard();
      const row = await showRow();

      expect(
        within(row).getByRole("link", { name: "ANRDUB2602247" }),
      ).toHaveAttribute("href", `/trips/${TRIP.id}`);
    });

    it("does not open the Trip when the copy button is clicked", async () => {
      const user = userEvent.setup();
      useClipboard();
      const row = await showRow();

      await user.click(
        within(row).getByRole("button", { name: "Boekingsnummer kopiëren" }),
      );

      // Still the list: the row is there and no navigation replaced it.
      expect(within(row).getByRole("link", { name: "ANRDUB2602247" })).toBeInTheDocument();
    });

    it("leaves the container cell editable", async () => {
      useClipboard();
      const row = await showRow();

      expect(
        within(row).getByRole("button", { name: "Containernummer" }),
      ).toBeInTheDocument();
    });

    it("does not open the container editor when copying", async () => {
      const user = userEvent.setup();
      useClipboard();
      const row = await showRow();

      await user.click(
        within(row).getByRole("button", { name: "Containernummer kopiëren" }),
      );

      expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when there is nothing to copy", () => {
    it("offers no container copy button", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ containerNumber: null })]),
      });
      renderRitten();

      const row = (await screen.findByText("ANRDUB2602247")).closest(
        "tr",
      ) as HTMLElement;

      expect(
        within(row).queryByRole("button", { name: "Containernummer kopiëren" }),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * `navigator.clipboard` is absent over plain HTTP on a non-localhost origin
   * and can reject when permission is refused. The number is still on screen to
   * select by hand, so the failure stays quiet rather than becoming a banner.
   */
  it("survives a clipboard that refuses", async () => {
    const user = userEvent.setup();

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
      writable: true,
    });

    const row = await showRow();

    await user.click(
      within(row).getByRole("button", { name: "Boekingsnummer kopiëren" }),
    );

    expect(within(row).queryByText("Gekopieerd")).not.toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "ANRDUB2602247" }),
    ).toBeInTheDocument();
  });
});
