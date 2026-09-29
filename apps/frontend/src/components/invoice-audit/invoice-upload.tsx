"use client";

import { useRef, useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import {
  checkInvoiceWorkbook,
  type InvoiceAuditResult,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/** What the file input offers, and what the name has to end in. */
const XLSX = ".xlsx";

/**
 * Choosing a weekly invoice and sending it to be checked.
 *
 * ── THE BROWSER DOES NOT READ IT ────────────────────────────────────────────
 * The file goes up exactly as it is and comes back as an answer. Nothing here
 * opens the workbook, counts a row or decides what a column means — the backend
 * does all of it, so the screen and the document that gets corrected later can
 * never disagree about what the sheet said.
 *
 * The extension is checked before sending, which is a courtesy rather than a
 * rule: the real check is on the bytes, in the backend, and its refusal is what
 * this shows when a file slips past.
 */
export function InvoiceUpload({
  onChecked,
}: {
  /**
   * The answer AND the file it is about.
   *
   * The final processing needs the very bytes that were checked, so the page
   * keeps them rather than asking for the file a second time — a second pick
   * could be a different document.
   */
  onChecked: (
    checked: { result: InvoiceAuditResult; file: File } | null,
  ) => void;
}) {
  const t = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function select(files: FileList | null): void {
    const chosen = files?.[0] ?? null;

    setError(
      chosen && !chosen.name.toLowerCase().endsWith(XLSX)
        ? t("invoiceAudit.onlyXlsx")
        : null,
    );
    setFile(chosen);
    // A new file makes the previous answer stale; it is about another document.
    onChecked(null);
  }

  async function check(): Promise<void> {
    if (!file || isChecking) {
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      onChecked({ result: await checkInvoiceWorkbook(file), file });
    } catch (failure: unknown) {
      // The backend's own words: which columns are missing, or why the file was
      // refused. Never a stack trace — see `userFacingMessage`.
      setError(userFacingMessage(failure));
      onChecked(null);
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDraggingOver(false);
          select(event.dataTransfer.files);
        }}
        className={[
          "rounded-lg border-2 border-dashed px-4 py-8 text-center",
          isDraggingOver ? "border-primary bg-primary/5" : "border-border",
        ].join(" ")}
      >
        <p className="text-sm text-secondary">{t("invoiceAudit.dropHere")}</p>
        <p className="mt-1 text-xs text-muted">{t("invoiceAudit.onlyXlsx")}</p>

        <label
          htmlFor="invoice-upload-input"
          className="mt-3 inline-block cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
        >
          {t("invoiceAudit.choose")}
        </label>
        <input
          id="invoice-upload-input"
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            select(event.target.files);
            // Lets the same file be chosen again after it was cleared.
            event.target.value = "";
          }}
        />
      </div>

      {file ? (
        <p className="mt-3 text-sm text-foreground">
          <span className="font-medium">{file.name}</span>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={!file || isChecking}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChecking ? t("invoiceAudit.checking") : t("invoiceAudit.check")}
        </button>

        {file ? (
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setError(null);
              onChecked(null);
              input.current?.focus();
            }}
            disabled={isChecking}
            className="text-sm font-medium text-secondary hover:text-foreground disabled:opacity-50"
          >
            {t("invoiceAudit.clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
