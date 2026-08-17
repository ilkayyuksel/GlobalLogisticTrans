"use client";

import { useCallback, useRef, useState } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { userFacingMessage } from "@/lib/api/client";
import { uploadTransportOrderPdfs } from "@/lib/api/imports";
import { useTranslation } from "@/lib/i18n/language-provider";
import { UploadFileRow } from "./upload-file-row";
import { looksLikePdf, type SelectedFile } from "./upload-file";

/**
 * Manual import of transport-order PDFs.
 *
 * THE BROWSER NEVER READS A PDF. Files are held as handles and sent as they
 * are; parsing, validation and Trip creation all happen in the backend, on the
 * same path an emailed order takes. A reader here would be a second, divergent
 * implementation of the one thing that must stay deterministic.
 *
 * The whole batch travels in one request and the backend reports per file, so a
 * document it cannot read costs only itself. Each file keeps its own state, and
 * files that already have a verdict are never sent again — which is what lets
 * an operator add another batch without reloading the page.
 */
export function PdfUpload() {
  const t = useTranslation();
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  /** A failure of the request itself, as opposed to one file being refused. */
  const [uploadError, setUploadError] = useState<string | null>(null);
  const nextId = useRef(0);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) {
      return;
    }

    const selected = Array.from(incoming).map<SelectedFile>((file) => ({
      id: `file-${nextId.current++}`,
      file,
      isPdf: looksLikePdf(file),
      state: "pending",
      result: null,
    }));

    setFiles((current) => [...current, ...selected]);
  }, []);

  const pending = files.filter(
    (selected) => selected.isPdf && selected.state === "pending",
  );

  async function upload() {
    if (pending.length === 0 || isUploading) {
      return;
    }

    const sent = pending;
    const sentIds = new Set(sent.map((selected) => selected.id));

    setUploadError(null);
    setIsUploading(true);
    setFiles((current) => markState(current, sentIds, "uploading"));

    try {
      const { results } = await uploadTransportOrderPdfs(
        sent.map((selected) => selected.file),
      );

      // Matched by position, not by name: the backend answers in the order it
      // was sent, and two files may legitimately carry the same name.
      setFiles((current) =>
        current.map((selected) => {
          const index = sent.findIndex((file) => file.id === selected.id);
          const result = index === -1 ? null : (results[index] ?? null);

          if (result === null) {
            // A file that was sent but not reported on cannot be called
            // imported. It returns to pending so it can be sent again rather
            // than sitting in a state it can never leave.
            return sentIds.has(selected.id)
              ? { ...selected, state: "pending" }
              : selected;
          }

          return {
            ...selected,
            state: result.ok ? "imported" : "failed",
            result,
          };
        }),
      );
    } catch (error: unknown) {
      // The request never happened, so nothing was imported. The files go back
      // to pending and the same button retries them.
      setUploadError(userFacingMessage(error));
      setFiles((current) => markState(current, sentIds, "pending"));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("upload.title")} description={t("upload.description")} />

      <CardBody>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDraggingOver(false);
            addFiles(event.dataTransfer.files);
          }}
          className={[
            "rounded-lg border-2 border-dashed px-4 py-8 text-center",
            isDraggingOver ? "border-primary bg-primary/5" : "border-border",
          ].join(" ")}
        >
          <p className="text-sm text-secondary">{t("upload.dropHere")}</p>
          <p className="mt-1 text-xs text-muted">{t("upload.onlyPdf")}</p>

          <label
            htmlFor="pdf-upload-input"
            className="mt-3 inline-block cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
          >
            {t("upload.choose")}
          </label>
          <input
            id="pdf-upload-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              // Lets the same file be chosen again after removing it.
              event.target.value = "";
            }}
          />
        </div>

        {files.length > 0 ? (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {files.map((selected) => (
              <UploadFileRow
                key={selected.id}
                selected={selected}
                onRemove={() =>
                  setFiles((current) =>
                    current.filter((entry) => entry.id !== selected.id),
                  )
                }
              />
            ))}
          </ul>
        ) : null}

        {uploadError ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            <span className="font-medium">{t("upload.batchFailed")}</span>{" "}
            {uploadError}
          </p>
        ) : null}

        {files.length > 0 ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void upload()}
              disabled={pending.length === 0 || isUploading}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading
                ? t("upload.uploading")
                : `${t("upload.send")} (${pending.length})`}
            </button>

            <button
              type="button"
              onClick={() => {
                setFiles([]);
                setUploadError(null);
              }}
              disabled={isUploading}
              className="text-sm font-medium text-secondary hover:text-foreground disabled:opacity-50"
            >
              {t("upload.clear")}
            </button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function markState(
  files: readonly SelectedFile[],
  ids: ReadonlySet<string>,
  state: SelectedFile["state"],
): SelectedFile[] {
  return files.map((selected) =>
    ids.has(selected.id) ? { ...selected, state } : selected,
  );
}
