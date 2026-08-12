/**
 * PDF → positioned text fragments.
 *
 * The parser works on FRAGMENTS with coordinates, not on reconstructed lines.
 * The fixtures show why: a Eucon order is a multi-column form, so two unrelated
 * values regularly share a row. Joining a row into one string glues them
 * together — `ONTEX Dourges` and the remark `ID = 878128594` become one line —
 * and any rule built on that string is guessing where one column ends.
 *
 * Keeping x and y lets a field ask the two questions that actually identify a
 * value in this document: "what is to the right of this label on the same row"
 * and "what is underneath this label in the same column".
 *
 * No OCR. If a page has no text layer this returns no fragments, and the caller
 * reports an unreadable PDF rather than reaching for image recognition.
 */

/** One positioned run of text, exactly as the PDF's text layer stores it. */
export interface Fragment {
  readonly page: number;
  /** Distance from the left edge, in PDF points. */
  readonly x: number;
  /** Distance from the bottom edge, in PDF points: larger y is higher up. */
  readonly y: number;
  readonly text: string;
}

export interface ExtractedDocument {
  readonly pageCount: number;
  readonly fragments: readonly Fragment[];
}

/** Raised only for a PDF that cannot be opened at all. */
export class UnreadablePdfError extends Error {}

/**
 * Rows in these documents are not perfectly aligned: a label and its value can
 * sit a fraction of a point apart. Three points is wide enough to hold them
 * together and far below the ~12pt line spacing, so it never merges two rows.
 */
export const ROW_TOLERANCE = 3;

/** Columns are far apart in this form; 6 points absorbs sub-pixel drift only. */
export const COLUMN_TOLERANCE = 6;

export async function extractDocument(
  source: Uint8Array,
): Promise<ExtractedDocument> {
  const pdfjs = await loadPdfjs();

  let document;
  try {
    document = await pdfjs.getDocument({
      data: source,
      // Everything below keeps extraction local, deterministic and text-only.
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      // Errors only. A damaged file is reported through the return value, so
      // pdfjs writing its own recovery notes to the console would be noise in
      // an import log the operator has to read.
      verbosity: 0,
    }).promise;
  } catch (error: unknown) {
    throw new UnreadablePdfError(
      error instanceof Error ? error.message : String(error),
    );
  }

  const fragments: Fragment[] = [];

  for (let page = 1; page <= document.numPages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent();

    for (const item of content.items) {
      const run = item as { str?: unknown; transform?: unknown };

      if (typeof run.str !== "string" || run.str.trim() === "") {
        continue;
      }

      const transform = run.transform as number[] | undefined;

      if (!transform || transform.length < 6) {
        continue;
      }

      fragments.push({
        page,
        x: transform[4],
        y: transform[5],
        text: collapseWhitespace(run.str),
      });
    }
  }

  await document.destroy();

  return { pageCount: document.numPages, fragments: sortForReading(fragments) };
}

/**
 * Reading order: page, then top to bottom, then left to right.
 *
 * Sorting is total — page, y, x and finally the text itself — so two fragments
 * can never compare equal and the order cannot depend on the input sequence.
 * That is what makes parsing the same PDF twice produce identical output.
 */
function sortForReading(fragments: Fragment[]): Fragment[] {
  return [...fragments].sort(
    (left, right) =>
      left.page - right.page ||
      right.y - left.y ||
      left.x - right.x ||
      left.text.localeCompare(right.text),
  );
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * pdfjs-dist v4 ships as ES modules only, so it must be loaded with a real
 * dynamic import. The legacy build is the one that runs under Node without a
 * browser worker.
 *
 * The import goes through `new Function` for one specific reason: this package
 * compiles to CommonJS, and both TypeScript and ts-jest rewrite a literal
 * `import(...)` into `require(...)`. `require` cannot load an ES module, and
 * pdfjs fails at its first `import.meta` — which is exactly what happened
 * before this indirection existed. A function body is opaque to both
 * compilers, so the import survives to runtime as an import.
 *
 * Revisit this if the package ever becomes ESM itself; until then it is the
 * smallest thing that makes one library work in both `tsc` output and Jest.
 */
const importEsm = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

async function loadPdfjs(): Promise<PdfjsModule> {
  return (await importEsm(
    "pdfjs-dist/legacy/build/pdf.mjs",
  )) as PdfjsModule;
}

interface PdfjsModule {
  getDocument(parameters: {
    data: Uint8Array;
    useWorkerFetch: boolean;
    isEvalSupported: boolean;
    useSystemFonts: boolean;
    disableFontFace: boolean;
    verbosity: number;
  }): { promise: Promise<PdfDocument> };
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
  destroy(): Promise<void>;
}
