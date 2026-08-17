import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/** Built from NEXT_PUBLIC_API_URL, which jest.setup.ts fixes for the suite. */
const CONTENT_URL = "http://backend.test/api/v1/pdf-documents/pdf-1/content";

/**
 * Viewing and downloading the source transport order.
 *
 * The bytes come from the backend by document id. Nothing here reads a path,
 * uploads anything again or parses a PDF — the browser's own viewer renders
 * what the backend sent.
 */
describe("Ritten PDF", () => {
  let fetchMock: jest.Mock;
  let clicked: string[];

  beforeEach(() => {
    requestMock.mockReset();
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

  /** `menuLabel` differs per language, so the caller supplies it. */
  async function chooseAction(
    name: string,
    menuLabel = "Acties",
  ): Promise<void> {
    await userEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(`${menuLabel} ANRDUB2602247`),
      }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name }));
  }

  describe("viewing", () => {
    it("asks the backend for the document behind the Trip", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(CONTENT_URL, expect.anything());
      });
    });

    it("shows it in a viewer", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      const viewer = await within(dialog).findByTitle("PDF-weergave");

      expect(viewer).toHaveAttribute("src", "blob:traxo-pdf");
      expect(
        within(dialog).getByText(/Transportopdracht — ANRDUB2602247/),
      ).toBeInTheDocument();
    });

    it("offers a download from inside the viewer", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        await within(dialog).findByRole("button", { name: "PDF downloaden" }),
      );

      expect(clicked).toEqual(["ANRDUB2602247.pdf"]);
    });

    /** The object URL must not outlive the dialog. */
    it("releases the file when the dialog closes", async () => {
      renderRitten();
      await chooseAction("PDF bekijken");

      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByTitle("PDF-weergave");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Sluiten" }),
      );

      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:traxo-pdf");
      });
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
      expect(screen.queryByTitle("PDF-weergave")).not.toBeInTheDocument();
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
      await chooseAction("PDF'i görüntüle", "İşlemler");

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/Taşıma emri/)).toBeInTheDocument();
      expect(
        await within(dialog).findByRole("button", { name: "PDF'i indir" }),
      ).toBeInTheDocument();
    });
  });
});
