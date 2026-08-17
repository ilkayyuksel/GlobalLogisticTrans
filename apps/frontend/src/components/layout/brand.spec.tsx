import { render, screen } from "@testing-library/react";

import { Brand, BrandMark } from "./brand";

/**
 * The TRAXO identity.
 *
 * The assertions that matter are about WHICH file is used, because the two
 * wordmarks are identical in markup and opposite on screen: the navy-ink one on
 * a navy header is an invisible logo, and nothing else in a test would notice.
 *
 * The filenames describe the ink, not the theme — "darkmodus" is the DARK-inked
 * artwork, which belongs on a LIGHT surface — so these tests also serve as the
 * written record of that mapping.
 */
describe("Brand", () => {
  const WORDMARK = "TRAXO — Transport Operations";

  describe("on a dark surface", () => {
    it("uses the white-ink wordmark", () => {
      render(<Brand tone="onDark" />);

      expect(screen.getByAltText(WORDMARK)).toHaveAttribute(
        "src",
        expect.stringContaining("lightmodus"),
      );
    });

    /** One image, not a theme-swapped pair: this surface is navy either way. */
    it("renders a single image", () => {
      const { container } = render(<Brand tone="onDark" />);

      expect(container.querySelectorAll("img")).toHaveLength(1);
    });
  });

  describe("on a surface that follows the theme", () => {
    it("uses the navy-ink wordmark in light mode", () => {
      render(<Brand tone="auto" />);

      expect(screen.getByAltText(WORDMARK)).toHaveAttribute(
        "src",
        expect.stringContaining("darkmodus"),
      );
    });

    /**
     * Both are rendered and CSS decides, rather than JavaScript reading the
     * theme during render — which is what produces a flash of the wrong logo,
     * or a hydration mismatch.
     */
    it("carries the white-ink wordmark for dark mode, hidden until then", () => {
      const { container } = render(<Brand tone="auto" />);
      const images = [...container.querySelectorAll("img")];

      expect(images).toHaveLength(2);
      expect(images[0]).toHaveClass("dark:hidden");
      expect(images[1]).toHaveClass("hidden", "dark:block");
      expect(images[1].getAttribute("src")).toContain("lightmodus");
    });

    /** The second image repeats the first; announcing it twice is noise. */
    it("hides the duplicate from screen readers", () => {
      const { container } = render(<Brand tone="auto" />);
      const images = [...container.querySelectorAll("img")];

      expect(images[1]).toHaveAttribute("aria-hidden", "true");
      expect(images[1]).toHaveAttribute("alt", "");
    });
  });

  it("grows for the login page without changing the asset", () => {
    const { rerender } = render(<Brand size="header" />);
    const headerWidth = screen.getByAltText(WORDMARK).getAttribute("width");

    rerender(<Brand size="hero" />);
    const heroWidth = screen.getByAltText(WORDMARK).getAttribute("width");

    expect(Number(heroWidth)).toBeGreaterThan(Number(headerWidth));
    expect(screen.getByAltText(WORDMARK)).toHaveAttribute(
      "src",
      expect.stringContaining("lightmodus"),
    );
  });

  /** The wordmark IS the words, so no text repeats them. */
  it("renders the name as artwork rather than as text", () => {
    const { container } = render(<Brand />);

    expect(container.textContent).toBe("");
  });
});

describe("BrandMark", () => {
  it("uses the square app logo", () => {
    render(<BrandMark />);

    expect(screen.getByAltText("TRAXO")).toHaveAttribute(
      "src",
      expect.stringContaining("applogo"),
    );
  });

  /**
   * applogo.png has no alpha channel: the tile sits on an opaque black square.
   * Without a rounded clip and a little overscan it renders as a black box on
   * every surface that is not black.
   */
  it("clips the asset's opaque black margin", () => {
    const { container } = render(<BrandMark />);
    const frame = container.firstElementChild as HTMLElement;

    expect(frame).toHaveClass("overflow-hidden");
    expect(frame.className).toContain("rounded-");
    expect(container.querySelector("img")?.className).toContain("scale-");
  });

  it("takes the size it is given", () => {
    const { container } = render(<BrandMark size={48} />);

    expect(container.firstElementChild).toHaveStyle({
      width: "48px",
      height: "48px",
    });
  });

  it("can be decorative beside the product's name", () => {
    const { container } = render(<BrandMark isDecorative />);

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
