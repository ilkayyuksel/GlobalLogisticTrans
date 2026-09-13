import type { PDFDocumentLoadingTask } from "pdfjs-dist";

/**
 * Draws PDF pages onto canvases with pdf.js.
 *
 * ── WHY NOT THE BROWSER'S OWN VIEWER ────────────────────────────────────────
 * An `<iframe>` pointed at a PDF only shows something where the browser brings
 * its own PDF plugin. Desktop Chrome, Edge and Firefox do; Chrome on Android
 * does not (`navigator.pdfViewerEnabled` is false) and iPad Safari shows a
 * blob-backed PDF frame blank or as a single static page. The viewer therefore
 * stayed empty on tablets while downloading the same file worked. pdf.js renders
 * the page itself, so every browser with a canvas shows the same result.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The LEGACY build, the same pdfjs-dist the parser already uses: it carries the
 * polyfills older tablet browsers need. It is loaded only when a PDF is opened,
 * so no page pays for it up front, and the worker keeps parsing off the main
 * thread.
 */

export interface PdfPageRendering {
  /** Settles when the page is drawn; rejects if drawing failed or was cancelled. */
  readonly done: Promise<void>;
  cancel(): void;
}

export interface LoadedPdf {
  readonly pageCount: number;
  /** Draws one page (1-based) at `cssWidth` CSS pixels wide, sharp on dense screens. */
  renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
  ): PdfPageRendering;
  /** Releases the worker's copy of the document. Call it when the viewer closes. */
  destroy(): Promise<void>;
}

type PdfJs = typeof import("pdfjs-dist");

let pdfJs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfJs ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>,
    import("./pdf-worker"),
  ]).then(([library, worker]) => {
    library.GlobalWorkerOptions.workerSrc = worker.PDF_WORKER_URL;

    return library;
  });

  return pdfJs;
}

/** Opens a PDF from its bytes. The bytes are handed to the worker, not copied. */
export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  const library = await loadPdfJs();
  const task: PDFDocumentLoadingTask = library.getDocument({
    data: new Uint8Array(data),
    // The document is untrusted input: never let it compile code.
    isEvalSupported: false,
  });
  const document = await task.promise;

  return {
    pageCount: document.numPages,

    renderPage(pageNumber, canvas, cssWidth) {
      let cancelRender = () => undefined as void;
      let isCancelled = false;

      const done = (async () => {
        const page = await document.getPage(pageNumber);
        const pixelRatio = window.devicePixelRatio || 1;
        const scale = cssWidth / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale: scale * pixelRatio });
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("This browser cannot draw on a canvas.");
        }

        if (isCancelled) {
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;

        const rendering = page.render({ canvasContext: context, viewport });

        cancelRender = () => rendering.cancel();
        await rendering.promise;
      })();

      return {
        done,
        cancel() {
          isCancelled = true;
          cancelRender();
        },
      };
    },

    destroy: () => task.destroy(),
  };
}
