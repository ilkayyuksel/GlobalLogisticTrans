/**
 * Hands a file to the browser.
 *
 * The one piece of this application that genuinely needs browser APIs, kept in
 * one place so the export and the PDF download cannot drift into two slightly
 * different versions of the same six lines.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
