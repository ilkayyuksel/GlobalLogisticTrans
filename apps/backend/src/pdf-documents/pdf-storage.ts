import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Where an imported PDF's bytes live on disk.
 *
 * Deliberately tiny: writing a file, removing a file, and hashing bytes. There
 * is no storage abstraction because there is one kind of file and one place it
 * goes.
 *
 * The filename is the SHA-256 of the content, never the uploaded filename. Two
 * reasons, and both matter: the name arrives from an email attachment, so using
 * it would let a sender choose a path (`../../.env`), and content addressing
 * means re-importing the same document rewrites the same bytes to the same
 * place instead of accumulating copies.
 *
 * The original filename is still recorded — on the PdfDocument row, where it is
 * data rather than a path.
 */

export interface StoredPdf {
  /** Path as recorded on the PdfDocument row, relative to the storage root. */
  readonly storagePath: string;
  /** Absolute path, used to clean the file up if the import then fails. */
  readonly absolutePath: string;
  readonly fileHash: string;
  readonly fileSizeBytes: number;
}

export function hashPdf(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Writes the PDF and reports where it went.
 *
 * The directory is created on demand so a fresh checkout or a new deployment
 * needs no setup step.
 */
export async function storePdf(
  storageDirectory: string,
  content: Uint8Array,
): Promise<StoredPdf> {
  const fileHash = hashPdf(content);
  const storagePath = `${fileHash}.pdf`;
  const root = resolveStorageRoot(storageDirectory);
  const absolutePath = join(root, storagePath);

  await mkdir(root, { recursive: true });
  await writeFile(absolutePath, content);

  return {
    storagePath,
    absolutePath,
    fileHash,
    fileSizeBytes: content.byteLength,
  };
}

/**
 * Reads a stored PDF back, or null when the file is no longer there.
 *
 * Null rather than an exception because "the row exists, the bytes do not" is a
 * state the caller has to report differently from "no such document" — one is a
 * storage problem, the other is a wrong id.
 *
 * The path is built from the storage root and the recorded `storagePath`, which
 * is always a content hash written by `storePdf`. Nothing a client sends
 * reaches this function.
 */
export async function readStoredPdf(
  storageDirectory: string,
  storagePath: string,
): Promise<Buffer | null> {
  try {
    return await readFile(join(resolveStorageRoot(storageDirectory), storagePath));
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return null;
    }

    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Removes a file written moments ago, when the import that wrote it failed.
 *
 * A database transaction cannot roll back the filesystem, so this is the
 * compensating half. It never throws: the import is already failing and is
 * about to report why, and a cleanup error would replace that diagnosis with a
 * less useful one. The worst case is one unreferenced file, which is harmless —
 * far better than losing the reason the import failed.
 */
export async function removeStoredPdf(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch {
    // Intentionally ignored; see above.
  }
}

function resolveStorageRoot(storageDirectory: string): string {
  return isAbsolute(storageDirectory)
    ? storageDirectory
    : resolve(process.cwd(), storageDirectory);
}
