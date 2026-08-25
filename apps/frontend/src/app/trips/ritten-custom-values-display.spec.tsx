import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
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
 * What the Custom column shows when there is nothing to show.
 *
 * ── AN INSTRUCTION IS NOT A VALUE ───────────────────────────────────────────
 * The cell used to read "Custom waarden beheren" whenever a Trip carried no
 * Custom Properties. In a data column, down a list of fifty rows, that reads as
 * a value — and a column of identical blue prompts says nothing about which
 * Trips actually carry anything, which is the question the column exists to
 * answer.
 *
 * It now shows the same empty marker every other column uses. The cell is still
 * the way into the manager and its accessible name still says so; only the
 * visible prompt is gone. Nothing about managing Custom Properties was removed,
 * here or on the Trip detail page.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PLACEHOLDER = "Custom waarden beheren";

async function show(properties: { name: string; isActive?: boolean }[] = []) {
  respondWith(requestMock, {
    trips: buildPage([
      buildTrip({
        customProperties: properties.map((property, index) => ({
          id: `custom-${index}`,
          name: property.name,
          isActive: property.isActive ?? true,
        })),
      }),
    ]),
  });
  renderRitten();

  return screen.findByRole("table");
}

/** The Custom cell of the one row on screen. */
function customCell(table: HTMLElement, name = `${PLACEHOLDER} ANRDUB2602247`) {
  return within(table)
    .getByRole("button", { name })
    .closest("td") as HTMLElement;
}

describe("the Custom column with nothing assigned", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("when the Trip carries none", () => {
    it("shows the ordinary empty marker", async () => {
      const table = await show();

      expect(within(customCell(table)).getByText("—")).toBeInTheDocument();
    });

    it("shows no placeholder text", async () => {
      const table = await show();

      expect(customCell(table).textContent).not.toContain(PLACEHOLDER);
    });

    it("shows no placeholder anywhere in the table", async () => {
      const table = await show();

      expect(within(table).queryByText(PLACEHOLDER)).toBeNull();
    });

    it("invents no value", async () => {
      const table = await show();
      const cell = customCell(table);

      expect(cell.textContent?.trim()).toBe("—");
    });

    /** The way in is still there — it just does not shout. */
    it("still opens the manager", async () => {
      const table = await show();

      await userEvent.click(
        within(table).getByRole("button", {
          name: `${PLACEHOLDER} ANRDUB2602247`,
        }),
      );

      expect(
        await screen.findByRole("dialog", { name: /Custom waarden/ }),
      ).toBeInTheDocument();
    });

    it("still names what the control does, for a screen reader", async () => {
      const table = await show();

      expect(
        within(table).getByRole("button", {
          name: `${PLACEHOLDER} ANRDUB2602247`,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when the Trip carries some", () => {
    it("names them, as before", async () => {
      const table = await show([{ name: "TAR" }, { name: "Flat" }]);

      expect(within(table).getByText("TAR")).toBeInTheDocument();
      expect(within(table).getByText("Flat")).toBeInTheDocument();
    });

    it("shows no empty marker in that cell", async () => {
      const table = await show([{ name: "TAR" }]);

      expect(within(customCell(table)).queryByText("—")).toBeNull();
    });

    it("still marks a property that is no longer active", async () => {
      const table = await show([{ name: "Tol", isActive: false }]);

      expect(within(table).getByText("Tol")).toHaveClass("line-through");
    });

    it("still counts the ones that do not fit", async () => {
      const table = await show([
        { name: "TAR" },
        { name: "Flat" },
        { name: "Tol" },
      ]);

      expect(within(table).getByText("+1")).toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      const table = await show();

      const cell = customCell(table, "Özel değerleri yönet ANRDUB2602247");

      expect(within(cell).getByText("—")).toBeInTheDocument();
      expect(cell.textContent).not.toContain("Özel değerleri yönet");
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        const table = await show();

        const marker = within(customCell(table)).getByText("—");

        // The muted tone of an absent value, not the primary blue of a link.
        expect(marker.className).toMatch(/text-secondary/);
        expect(marker.className).not.toMatch(/text-primary/);
        expect(marker.className).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );
  });
});
