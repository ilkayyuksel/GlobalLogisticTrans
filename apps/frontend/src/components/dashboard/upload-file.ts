import type { PdfImportFileResult } from "@/lib/api/imports";

/**
 * One file in the upload widget, from selection to verdict.
 *
 * The `File` is kept as a handle and nothing more: it is passed to the API
 * layer and never opened here. Parsing a transport order is the backend's work,
 * and a second reader in the browser would be a second implementation to keep
 * in step with the first.
 */
export interface SelectedFile {
  /** Stable across re-renders; File objects are not comparable by identity. */
  readonly id: string;
  readonly file: File;
  /** False when this is not a PDF, in which case it is never sent. */
  readonly isPdf: boolean;
  readonly state: UploadState;
  /** The backend's verdict for this file, once there is one. */
  readonly result: PdfImportFileResult | null;
}

export type UploadState = "pending" | "uploading" | "imported" | "failed";

const PDF_MIME_TYPE = "application/pdf";

/**
 * Whether this file is worth sending.
 *
 * Both signals are accepted because some senders label a PDF as octet-stream.
 * This is a courtesy to the user rather than a security check — the backend
 * inspects the actual bytes and refuses anything that only claims to be a PDF.
 */
export function looksLikePdf(file: File): boolean {
  return (
    file.type === PDF_MIME_TYPE || file.name.toLowerCase().endsWith(".pdf")
  );
}

export function formatFileSize(bytes: number): string {
  const kilobytes = bytes / 1024;

  return kilobytes < 1024
    ? `${Math.max(1, Math.round(kilobytes))} KB`
    : `${(kilobytes / 1024).toFixed(1)} MB`;
}
