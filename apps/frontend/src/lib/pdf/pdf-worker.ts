/**
 * Where pdf.js's worker is served from.
 *
 * A module of its own, imported only when a PDF is actually opened: the bundler
 * turns this `new URL(…, import.meta.url)` into the URL of the emitted worker
 * file, and keeping it out of `pdf-renderer.ts` means nothing that merely
 * imports the viewer — a page, a test — ever evaluates it.
 */
export const PDF_WORKER_URL = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
