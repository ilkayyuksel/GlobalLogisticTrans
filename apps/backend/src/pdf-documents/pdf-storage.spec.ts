import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { hashPdf, removeStoredPdf, storePdf } from "./pdf-storage";

const CONTENT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const OTHER_CONTENT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);

describe("pdf-storage", () => {
  let storageDirectory: string;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-pdf-"));
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe("hashPdf", () => {
    it("is deterministic, so the same document always lands in one place", () => {
      expect(hashPdf(CONTENT)).toBe(hashPdf(CONTENT));
    });

    it("separates different documents", () => {
      expect(hashPdf(CONTENT)).not.toBe(hashPdf(OTHER_CONTENT));
    });
  });

  describe("storePdf", () => {
    it("writes the bytes unchanged", async () => {
      const stored = await storePdf(storageDirectory, CONTENT);

      await expect(readFile(stored.absolutePath)).resolves.toEqual(
        Buffer.from(CONTENT),
      );
    });

    it("names the file after the content, never after the sender", async () => {
      const stored = await storePdf(storageDirectory, CONTENT);

      expect(basename(stored.storagePath)).toBe(`${hashPdf(CONTENT)}.pdf`);
    });

    it("reports the measured size rather than a declared one", async () => {
      const stored = await storePdf(storageDirectory, CONTENT);

      expect(stored.fileSizeBytes).toBe(CONTENT.byteLength);
    });

    it("creates the directory when it does not exist yet", async () => {
      const nested = join(storageDirectory, "deeper", "still");

      const stored = await storePdf(nested, CONTENT);

      await expect(readFile(stored.absolutePath)).resolves.toBeDefined();
    });

    it("rewrites the same path for the same document instead of piling up copies", async () => {
      const first = await storePdf(storageDirectory, CONTENT);
      const second = await storePdf(storageDirectory, CONTENT);

      expect(second.absolutePath).toBe(first.absolutePath);
    });

    /**
     * The filename arrives from an email attachment, so it is untrusted input.
     * Content addressing is what makes it impossible for a sender to choose
     * where their file lands — this proves no caller can even try.
     */
    it("takes no filename, so a sender cannot influence the path", () => {
      expect(storePdf).toHaveLength(2);
    });
  });

  describe("removeStoredPdf", () => {
    it("removes the file", async () => {
      const stored = await storePdf(storageDirectory, CONTENT);

      await removeStoredPdf(stored.absolutePath);

      await expect(readFile(stored.absolutePath)).rejects.toThrow();
    });

    it("stays silent when the file is already gone", async () => {
      const missing = join(storageDirectory, "not-there.pdf");

      await expect(removeStoredPdf(missing)).resolves.toBeUndefined();
    });

    /**
     * Cleanup runs while an import is already failing. Throwing here would
     * replace the reason the import failed with a filesystem error, which is
     * strictly less useful.
     */
    it("stays silent when the path is not a file at all", async () => {
      await expect(removeStoredPdf(storageDirectory)).resolves.toBeUndefined();
    });
  });

  it("keeps an unrelated file in the directory untouched", async () => {
    const unrelated = join(storageDirectory, "keep-me.pdf");
    await writeFile(unrelated, OTHER_CONTENT);

    const stored = await storePdf(storageDirectory, CONTENT);
    await removeStoredPdf(stored.absolutePath);

    await expect(readFile(unrelated)).resolves.toEqual(
      Buffer.from(OTHER_CONTENT),
    );
  });
});
