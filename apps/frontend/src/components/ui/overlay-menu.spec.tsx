import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OverlayMenu } from "./overlay-menu";

/**
 * The dropdown that must not be clipped.
 *
 * Its whole reason for existing is that it renders outside the element it is
 * triggered from, so the first test is the structural one: the panel is not a
 * descendant of the table cell that opened it. The rest is the behaviour a
 * portal takes on in exchange — dismissal and keyboard movement, which nothing
 * above it can provide any more.
 */
describe("OverlayMenu", () => {
  function renderMenu(isDisabled = false) {
    return render(
      // A clipping ancestor, exactly like the Ritten table's scroll container.
      <div className="overflow-x-auto" data-testid="scroller">
        <OverlayMenu
          triggerLabel="Acties ANRDUB2602247"
          menuLabel="Acties"
          isDisabled={isDisabled}
        >
          {(close) => (
            <>
              <button type="button" role="menuitem" onClick={close}>
                Eerste
              </button>
              <button type="button" role="menuitem" onClick={close}>
                Tweede
              </button>
            </>
          )}
        </OverlayMenu>
      </div>,
    );
  }

  async function open(): Promise<HTMLElement> {
    await userEvent.click(
      screen.getByRole("button", { name: "Acties ANRDUB2602247" }),
    );

    return screen.getByRole("menu");
  }

  it("stays closed until it is asked for", () => {
    renderMenu();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  /** The point of the portal: no ancestor of the trigger can clip the panel. */
  it("renders the panel outside the scrolling container", async () => {
    renderMenu();
    const menu = await open();

    expect(screen.getByTestId("scroller")).not.toContainElement(menu);
    expect(document.body).toContainElement(menu);
  });

  it("reports its open state on the trigger", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Acties ANRDUB2602247" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await open();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes when the trigger is pressed again", async () => {
    renderMenu();
    await open();

    await userEvent.click(
      screen.getByRole("button", { name: "Acties ANRDUB2602247" }),
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when an item is chosen", async () => {
    renderMenu();
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Eerste" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a click anywhere outside it", async () => {
    renderMenu();
    await open();

    await userEvent.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    renderMenu();
    await open();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acties ANRDUB2602247" })).toHaveFocus();
  });

  /** Tabbing out of a portal would land somewhere unrelated to the row. */
  it("closes on Tab", async () => {
    renderMenu();
    await open();

    await userEvent.keyboard("{Tab}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("keyboard movement", () => {
    it("walks down the items and wraps", async () => {
      renderMenu();
      await open();

      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Eerste" })).toHaveFocus();

      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Tweede" })).toHaveFocus();

      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Eerste" })).toHaveFocus();
    });

    it("walks up from the bottom", async () => {
      renderMenu();
      await open();

      await userEvent.keyboard("{ArrowUp}");

      expect(screen.getByRole("menuitem", { name: "Tweede" })).toHaveFocus();
    });

    it("jumps to the ends", async () => {
      renderMenu();
      await open();

      await userEvent.keyboard("{End}");
      expect(screen.getByRole("menuitem", { name: "Tweede" })).toHaveFocus();

      await userEvent.keyboard("{Home}");
      expect(screen.getByRole("menuitem", { name: "Eerste" })).toHaveFocus();
    });
  });

  it("cannot be opened while the row is busy", async () => {
    renderMenu(true);

    const trigger = screen.getByRole("button", { name: "Acties ANRDUB2602247" });
    expect(trigger).toBeDisabled();

    await userEvent.click(trigger, { pointerEventsCheck: 0 });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
