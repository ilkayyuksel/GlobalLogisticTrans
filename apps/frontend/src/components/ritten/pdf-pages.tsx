"use client";

import { useEffect, useRef, useState } from "react";

import { LoadingState } from "@/components/ui/states";
import { useTranslation } from "@/lib/i18n/language-provider";
import { loadPdf, type LoadedPdf } from "@/lib/pdf/pdf-renderer";

/**
 * Every page of one PDF, drawn by pdf.js into a scrollable column.
 *
 * It works from bytes that were already fetched — the caller's Blob — so
 * viewing costs no second request and needs no object URL. The pdf.js document
 * is destroyed when the viewer closes or the file changes, and a page that is
 * redrawn (a tablet turned from portrait to landscape) cancels its previous
 * drawing first.
 */

/** Used until the container has been laid out; jsdom never lays it out. */
const FALLBACK_WIDTH_PX = 800;

export function PdfPages({ file, label }: { file: Blob; label: string }) {
  const t = useTranslation();
  const columnRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    let opened: LoadedPdf | null = null;

    setPdf(null);
    setFailure(null);

    file
      .arrayBuffer()
      .then(loadPdf)
      .then((document) => {
        opened = document;

        if (isCurrent) {
          setPdf(document);
        } else {
          void document.destroy();
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setFailure(error);
        }
      });

    return () => {
      isCurrent = false;
      void opened?.destroy();
    };
  }, [file]);

  // The pages follow the column's width, so a turned tablet redraws them.
  useEffect(() => {
    const column = columnRef.current;

    if (!column) {
      return;
    }

    const measure = () => setWidth(column.clientWidth || FALLBACK_WIDTH_PX);

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measure);

    observer.observe(column);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      role="region"
      aria-label={label}
      className="h-[70vh] overflow-y-auto rounded-md border border-border bg-hover/40 p-2"
    >
      <div ref={columnRef} className="space-y-2">
        {!pdf && !failure ? <LoadingState label={t("ritten.pdf.loading")} /> : null}

        {failure ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            {t("ritten.pdf.renderFailed")}
          </p>
        ) : null}

        {pdf && width > 0
          ? Array.from({ length: pdf.pageCount }, (_, index) => (
              <PdfPage
                key={index + 1}
                pdf={pdf}
                pageNumber={index + 1}
                width={width}
                label={t("ritten.pdf.pageLabel")
                  .replace("{page}", String(index + 1))
                  .replace("{count}", String(pdf.pageCount))}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  width,
  label,
}: {
  pdf: LoadedPdf;
  pageNumber: number;
  width: number;
  label: string;
}) {
  const t = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rendering = pdf.renderPage(pageNumber, canvas, width);
    let isCurrent = true;

    rendering.done.catch(() => {
      // A cancelled drawing is a replaced one, not a failure.
      if (isCurrent) {
        setHasFailed(true);
      }
    });

    return () => {
      isCurrent = false;
      rendering.cancel();
    };
  }, [pdf, pageNumber, width]);

  return (
    <figure className="m-0">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="mx-auto block max-w-full bg-white shadow-sm"
      />
      {hasFailed ? (
        <figcaption role="alert" className="mt-1 text-center text-xs text-danger">
          {t("ritten.pdf.renderFailed")}
        </figcaption>
      ) : null}
    </figure>
  );
}
