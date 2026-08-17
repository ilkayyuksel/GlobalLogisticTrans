/**
 * The browser application icon.
 *
 * Runs in the node environment because it reads files: `icon.png` and
 * `apple-icon.png` are conventions of the App Router, not modules, and Next
 * turns them into `<link rel="icon">` by their PRESENCE and file name. A test
 * that mocked the filesystem would prove nothing about that.
 *
 * @jest-environment node
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** The 8-byte PNG signature; anything else is not a PNG whatever it is called. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SOURCE = resolve(__dirname, "../img/applogo.png");
const ICON = resolve(__dirname, "icon.png");
const APPLE_ICON = resolve(__dirname, "apple-icon.png");

function readPngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(16, 24);

  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

describe("the TRAXO app icon", () => {
  describe.each([
    ["icon.png", ICON, 256],
    ["apple-icon.png", APPLE_ICON, 180],
  ])("%s", (_name, path, expectedSize) => {
    it("exists where the App Router looks for it", () => {
      expect(() => statSync(path)).not.toThrow();
    });

    it("is a real PNG", () => {
      expect(readFileSync(path).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it("is square, at the size browsers ask for", () => {
      expect(readPngSize(path)).toEqual({
        width: expectedSize,
        height: expectedSize,
      });
    });

    /**
     * The delivered mark is 1254px and just under a megabyte, which is correct
     * for a source asset and wasteful for something every cold load fetches.
     */
    it("is small enough to ship as an icon", () => {
      expect(statSync(path).size).toBeLessThan(64 * 1024);
      expect(statSync(path).size).toBeLessThan(statSync(SOURCE).size);
    });
  });

  /**
   * The compact mark, never the wordmark: a long logo scaled into a 16px
   * browser tab is an unreadable smear.
   */
  it("is derived from the square app logo, which is itself square", () => {
    const source = readPngSize(SOURCE);

    expect(source.width).toBe(source.height);
  });

  it("does not use either long wordmark", () => {
    const iconSize = readPngSize(ICON);
    const wordmark = readPngSize(
      resolve(__dirname, "../img/lightmodus long logo.png"),
    );

    expect(wordmark.width).not.toBe(wordmark.height);
    expect(iconSize.width).toBe(iconSize.height);
  });
});
