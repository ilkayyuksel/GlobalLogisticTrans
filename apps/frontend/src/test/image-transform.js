/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- Jest loads a transformer synchronously through require(), so this file must be CommonJS. */
const { basename } = require("node:path");
const { readFileSync } = require("node:fs");

/**
 * Turns an imported image into the object `next/image` expects — one per FILE.
 *
 * Next's own mock resolves every image to the same `/img.jpg`, which makes the
 * three TRAXO assets indistinguishable in a test. "Is the right logo used
 * here?" is precisely the question worth asking: the white-ink and navy-ink
 * wordmarks are identical in markup and opposite on screen, and getting them
 * the wrong way round renders an invisible logo.
 *
 * The real dimensions are read from the PNG header rather than invented, so a
 * component computing a height from the aspect ratio behaves as it does in a
 * browser.
 */
function pngSize(filename) {
  try {
    const header = readFileSync(filename).subarray(16, 24);

    return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
  } catch {
    return { width: 100, height: 100 };
  }
}

module.exports = {
  process(_source, filename) {
    const { width, height } = pngSize(filename);
    const asset = {
      src: `/_next/static/media/${basename(filename)}`,
      width,
      height,
      blurDataURL: "",
      blurWidth: 0,
      blurHeight: 0,
    };

    return { code: `module.exports = ${JSON.stringify(asset)};` };
  },
  getCacheKey(_source, filename) {
    return `image-transform:${filename}`;
  },
};
