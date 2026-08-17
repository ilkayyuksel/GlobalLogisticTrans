/**
 * One part of a multipart upload, as the multipart parser hands it over.
 *
 * Declared here rather than imported from the parser's own typings so that the
 * upload path depends on the four things it actually reads, and on nothing
 * else. It also keeps a stray field — a temporary path, a stream — from being
 * reachable by accident in code that must never touch the filesystem itself.
 *
 * `buffer` is in memory because uploads are configured with memory storage: a
 * transport order is measured in kilobytes, and never writing a temporary file
 * means there is no temporary file to forget to clean up. The only file this
 * system writes is the one `PdfDocumentService` stores, content-addressed, and
 * that write happens inside the import.
 */
export interface UploadedPdfFile {
  /** The name the client sent. Data only — it never influences a path. */
  readonly originalname: string;
  /** What the client claims the file is. Never trusted on its own. */
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}
