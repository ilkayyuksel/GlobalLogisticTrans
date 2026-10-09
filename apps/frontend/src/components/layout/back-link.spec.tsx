import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";

import { BackLink } from "./back-link";
import { NavigationDriver, installViewport } from "@/test/scroll-harness";

// The router's Link needs a mounted App Router; what is under test is the
// decision taken in BackLink's own click handler, so a plain anchor will do.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props} />
  ),
}));

/**
 * D. "Terug naar ritten" is Back when the user came from the Ritten list.
 *
 * Then it returns to that very entry — date, view, filters and scroll — the
 * same one the browser's Back button returns to. Opened any other way, it is
 * the ordinary link it always was.
 */
describe("the internal Back link", () => {
  let driver: NavigationDriver;
  let back: jest.SpyInstance;

  beforeEach(() => {
    installViewport();
    back = jest.spyOn(window.history, "back").mockImplementation(() => undefined);
  });

  afterEach(() => {
    driver.dispose();
    back.mockRestore();
  });

  function clickBack(init: MouseEventInit = {}): boolean {
    render(<BackLink href="/trips">Terug naar ritten</BackLink>);

    // fireEvent answers false when the default was prevented.
    return fireEvent.click(screen.getByRole("link", { name: "Terug naar ritten" }), init);
  }

  it("goes Back to the Ritten entry it was opened from, filters and all", () => {
    driver = new NavigationDriver().start("/trips?view=week&date=2026-10-04&status=OPEN");
    driver.push("/trips/trip-1");

    const followedTheLink = clickBack();

    expect(back).toHaveBeenCalledTimes(1);
    expect(followedTheLink).toBe(false);
  });

  it("is an ordinary link on a detail page opened directly", () => {
    driver = new NavigationDriver().start("/trips/trip-1");

    const followedTheLink = clickBack();

    expect(back).not.toHaveBeenCalled();
    expect(followedTheLink).toBe(true);
  });

  it("is an ordinary link when the page was opened from somewhere else", () => {
    driver = new NavigationDriver().start("/dashboard");
    driver.push("/trips/trip-1");

    clickBack();

    expect(back).not.toHaveBeenCalled();
  });

  it("leaves a new-tab click to the browser", () => {
    driver = new NavigationDriver().start("/trips");
    driver.push("/trips/trip-1");

    clickBack({ ctrlKey: true });

    expect(back).not.toHaveBeenCalled();
  });
});
