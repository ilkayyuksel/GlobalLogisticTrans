import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import { loadPdf } from "@/lib/pdf/pdf-renderer";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

/*
 * pdf.js draws on a real canvas, which jsdom does not have. The renderer is the
 * boundary: these tests assert what the viewer asks of it — which bytes, which
 * pages, and that it is released — and pdf.js itself is proved in a browser.
 */
jest.mock("@/lib/pdf/pdf-renderer", () => ({ loadPdf: jest.fn() }));

const requestMock = request as jest.MockedFunction<typeof request>;
const loadPdfMock = loadPdf as jest.MockedFunction<typeof loadPdf>;

/** A two-page document as pdf.js would hand it over. */
function loadedPdf() {
  return {
    pageCount: 2,
    renderPage: jest.fn(() => ({ done: Promise.resolve(), cancel: jest.fn() })),
    destroy: jest.fn(() => Promise.resolve()),
  };
}

/** Built from NEXT_PUBLIC_API_URL, which jest.setup.ts fixes for the suite. */
const CONTENT_URL = "http://backend.test/api/v1/pdf-documents/pdf-1/content";

/**
 * Viewing and downloading the source transport order.
 *
 * The bytes come from the backend by document id, once per opening. Nothing
 * here reads a path or uploads anything again. The pages are drawn by pdf.js,
 * not by the browser's own PDF plugin — tablet browsers have none — and the
 * same bytes serve the download.
 */
describe("Ritten PDF", () => {
  let fetchMock: jest.Mock;
  let clicked: string[];

  beforeEach(() => {
    requestMock.mockReset();
    loadPdfMock.mockReset();
    loadPdfMock.mockImplementation(() => Promise.resolve(loadedPdf()));
    window.localStorage.clear();
    clicked = [];

    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    Object.defineProperty(URL, "createObjectURL", {
      value: jest.fn(() => "blob:traxo-pdf"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: jest.fn(),
      writable: true,
    });

    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Both PDF actions are icon buttons in the row's PDF column — one click, no
   * menu. Their accessible name carries the booking number, which is what
   * keeps one row's document apart from the next one's.
   */
  async function chooseAction(name: string): Promise<void> {
    await userEvent.click(
      await screen.findByRole("button", { name: `${name} ANRDUB2602247` }),
    );
  }

  describe("viewing", () => {
    it("asks the backend for the document behind the Trip", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(CONTENT_URL, expect.anything());
      });
    });

    /** Every page drawn, in order — no browser PDF plugin involved. */
    it("shows every page in the viewer", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      const viewer = await within(dialog).findByRole("region", {
        name: "PDF-weergave",
      });

      expect(
        (await within(viewer).findAllByRole("img")).map((page) =>
          page.getAttribute("aria-label"),
        ),
      ).toEqual(["Pagina 1 van 2", "Pagina 2 van 2"]);
      expect(viewer.querySelector("iframe, embed, object")).toBeNull();
      expect(
        within(dialog).getByText(/Transportopdracht — ANRDUB2602247/),
      ).toBeInTheDocument();
    });

    it("draws the bytes the backend sent, and draws each page", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");
      await screen.findAllByRole("img", { name: /Pagina/ });

      const bytes = loadPdfMock.mock.calls[0][0];
      const document = await loadPdfMock.mock.results[0].value;

      // jsdom has no TextDecoder; the fixture is plain ASCII.
      expect(String.fromCharCode(...new Uint8Array(bytes))).toBe("%PDF-1.7");
      expect(document.renderPage.mock.calls.map(([page]: [number]) => page)).toEqual([1, 2]);
    });

    /** Viewing needs no object URL: nothing is left behind to revoke. */
    it("creates no object URL to view the file", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");
      await screen.findAllByRole("img", { name: /Pagina/ });

      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("shows a loading state until the pages can be drawn", async () => {
      loadPdfMock.mockReturnValue(new Promise(() => undefined));

      renderRitten();
      await chooseAction("PDF bekijken");

      const viewer = await screen.findByRole("region", { name: "PDF-weergave" });

      expect(within(viewer).getByRole("status")).toHaveTextContent("PDF laden");
    });

    it("offers a download from inside the viewer, from the same bytes", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        await within(dialog).findByRole("button", { name: "PDF downloaden" }),
      );

      expect(clicked).toEqual(["ANRDUB2602247.pdf"]);
      // One request for the viewer, none for the download.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /** pdf.js keeps the document in its worker until it is told to let go. */
    it("releases the document when the dialog closes", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      await within(dialog).findAllByRole("img", { name: /Pagina/ });
      const document = await loadPdfMock.mock.results[0].value;

      await userEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));

      await waitFor(() => expect(document.destroy).toHaveBeenCalledTimes(1));
    });

    it("opens again after closing, with a fresh document", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");
      let dialog = await screen.findByRole("dialog");
      await within(dialog).findAllByRole("img", { name: /Pagina/ });
      await userEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await chooseAction("PDF bekijken");
      dialog = await screen.findByRole("dialog");

      expect(await within(dialog).findAllByRole("img", { name: /Pagina/ })).toHaveLength(2);
      expect(loadPdfMock).toHaveBeenCalledTimes(2);
      expect((await loadPdfMock.mock.results[0].value).destroy).toHaveBeenCalled();
    });

    it("opens each Trip's own document", async () => {
      respondWith(requestMock, {
        trips: buildPage([
          buildTrip(),
          buildTrip({ id: "trip-2", bookingNumber: "ANRDUB0000002", pdfDocumentId: "pdf-2" }),
        ]),
      });

      renderRitten();
      await chooseAction("PDF bekijken");
      let dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await userEvent.click(
        await screen.findByRole("button", { name: "PDF bekijken ANRDUB0000002" }),
      );
      dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/ANRDUB0000002/)).toBeInTheDocument();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        CONTENT_URL,
        "http://backend.test/api/v1/pdf-documents/pdf-2/content",
      ]);
    });

    /** A file the backend served but pdf.js cannot read: say so, keep the download. */
    it("says so when the PDF cannot be drawn, and still offers the download", async () => {
      loadPdfMock.mockRejectedValue(new Error("Invalid PDF structure."));

      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");

      expect(
        await within(dialog).findByText(
          "Deze PDF kan hier niet worden weergegeven. Download hem om hem te bekijken.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "PDF downloaden" })).toBeEnabled();
    });
  });

  describe("downloading from the menu", () => {
    it("downloads without opening the viewer", async () => {
      renderRitten();
      await chooseAction("PDF downloaden");

      await waitFor(() => {
        expect(clicked).toEqual(["ANRDUB2602247.pdf"]);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("when it cannot be served", () => {
    /** The row exists, the stored file does not: the backend says 410. */
    it("shows the backend's reason for a missing file", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 410,
        json: () =>
          Promise.resolve({
            success: false,
            error: {
              code: "GONE",
              message:
                'The stored file for PDF document "pdf-1" is missing.',
            },
          }),
      });

      renderRitten();
      await chooseAction("PDF bekijken");

      expect(
        await screen.findByText(/is missing/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "PDF-weergave" }),
      ).not.toBeInTheDocument();
      expect(loadPdfMock).not.toHaveBeenCalled();
    });

    it("reports an unknown document", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "NOT_FOUND", message: "PDF document does not exist." },
          }),
      });

      renderRitten();
      await chooseAction("PDF bekijken");

      expect(
        await screen.findByText(/does not exist/),
      ).toBeInTheDocument();
    });

    it("reports an unreachable backend", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      renderRitten();
      await chooseAction("PDF bekijken");

      expect(
        await screen.findByText(/could not be reached/),
      ).toBeInTheDocument();
    });

    it("reports a failed download on the page, without a file", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 410,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "GONE", message: "Its content is gone." },
          }),
      });

      renderRitten();
      await chooseAction("PDF downloaden");

      expect(
        await screen.findByText("PDF kon niet geladen worden"),
      ).toBeInTheDocument();
      expect(clicked).toHaveLength(0);
    });
  });

  /**
   * The PDF column.
   *
   * Reaching the source document used to mean opening the action menu first.
   * These are the same two actions, in the column that was previously only
   * telling the operator that a document exists.
   */
  describe("the PDF column", () => {
    it("opens the viewer straight from the column", async () => {
      renderRitten();

      await userEvent.click(
        await screen.findByRole("button", {
          name: "PDF bekijken ANRDUB2602247",
        }),
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(CONTENT_URL, expect.anything());
      });
    });

    it("downloads straight from the column", async () => {
      renderRitten();

      await userEvent.click(
        await screen.findByRole("button", {
          name: "PDF downloaden ANRDUB2602247",
        }),
      );

      await waitFor(() => {
        expect(clicked).toHaveLength(1);
      });
    });

    /**
     * `pdfDocumentId` is non-nullable — a Trip cannot exist without the PDF it
     * was parsed from — so this is the defensive case: a payload that carries
     * the field empty. Both buttons stay visible rather than vanishing, so the
     * column keeps its shape down the list.
     */
    it("disables both when the Trip carries no usable document id", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ pdfDocumentId: "" })]),
      });

      renderRitten();

      expect(
        await screen.findByRole("button", { name: "PDF bekijken ANRDUB2602247" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "PDF downloaden ANRDUB2602247" }),
      ).toBeDisabled();
    });
  });

  describe("in Turkish", () => {
    it("translates the viewer", async () => {
      window.localStorage.setItem("tms.language", "tr");

      renderRitten();
      await chooseAction("PDF'i görüntüle");

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/Taşıma emri/)).toBeInTheDocument();
      expect(
        await within(dialog).findByRole("button", { name: "PDF'i indir" }),
      ).toBeInTheDocument();
    });
  });
});
