import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TripDocumentHistory } from "./trip-document-history";
import { listTripDocuments } from "@/lib/api/trips";
import type { TripDocument } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/trips");

const listMock = listTripDocuments as jest.MockedFunction<
  typeof listTripDocuments
>;

/**
 * The documents of one Trip.
 *
 * ── WHAT THIS LIST IS FOR ───────────────────────────────────────────────────
 * Telling one UPDATE from another. Three updates to the same order look
 * identical unless the list says when each arrived and what each moved, so
 * those are the two things every entry carries — and they come from the
 * backend, which recorded them at the time.
 *
 * It must expose nothing more: no storage path, no email, no parser internals.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildDocument(overrides: Partial<TripDocument> = {}): TripDocument {
  return {
    pdfDocumentId: "pdf-1",
    action: "UPDATE",
    originalFilename: "transportorder1370334.pdf",
    occurredAt: "2026-08-20T09:00:00.000Z",
    changedFields: ["containerNumber"],
    outcome: "containerNumber: ABC123 → XYZ456",
    applied: true,
    createdTrip: false,
    ...overrides,
  };
}

function renderHistory(onView = jest.fn(), onDownload = jest.fn()) {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <TripDocumentHistory
          tripId="trip-1"
          onView={onView}
          onDownload={onDownload}
        />
      </LanguageProvider>
    </ThemeProvider>,
  );

  return { onView, onDownload };
}

function rowFor(filename: string): HTMLElement {
  return screen.getByText(filename).closest("li") as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the document history of a Trip", () => {
  it("lists the documents in the order the backend returned them", async () => {
    listMock.mockResolvedValue([
      buildDocument({ pdfDocumentId: "pdf-3", action: "CANCEL", originalFilename: "cancel.pdf", changedFields: [] }),
      buildDocument({ pdfDocumentId: "pdf-2", originalFilename: "update-2.pdf" }),
      buildDocument({ pdfDocumentId: "pdf-1", action: "NEW", originalFilename: "order.pdf", changedFields: [] }),
    ]);

    renderHistory();
    await screen.findByText("cancel.pdf");

    // The action badge and the filename share one line; the order is what this
    // test is about, and both halves of each entry read in that order.
    const filenames = screen
      .getAllByRole("listitem")
      .map(
        (item) =>
          [...item.querySelectorAll("span")]
            .map((span) => span.textContent ?? "")
            .find((text) => text.endsWith(".pdf")) ?? "",
      );

    expect(filenames).toEqual([
      "Annuleringcancel.pdf",
      "Updateupdate-2.pdf",
      "Nieuworder.pdf",
    ]);
  });

  it("names what each document was", async () => {
    listMock.mockResolvedValue([
      buildDocument({ action: "CANCEL", originalFilename: "cancel.pdf", changedFields: [] }),
      buildDocument({ pdfDocumentId: "pdf-2", originalFilename: "update.pdf" }),
      buildDocument({ pdfDocumentId: "pdf-3", action: "NEW", originalFilename: "order.pdf", changedFields: [] }),
    ]);

    renderHistory();
    await screen.findByText("cancel.pdf");

    expect(within(rowFor("cancel.pdf")).getByText("Annulering")).toBeInTheDocument();
    expect(within(rowFor("update.pdf")).getByText("Update")).toBeInTheDocument();
    expect(within(rowFor("order.pdf")).getByText("Nieuw")).toBeInTheDocument();
  });

  /** Two updates to the same order are only tellable apart by these two facts. */
  it("shows when each update arrived and what it changed", async () => {
    listMock.mockResolvedValue([
      buildDocument({
        pdfDocumentId: "pdf-2",
        originalFilename: "update-2.pdf",
        changedFields: ["terminal"],
      }),
      buildDocument({
        pdfDocumentId: "pdf-1",
        originalFilename: "update-1.pdf",
        changedFields: ["containerNumber"],
      }),
    ]);

    renderHistory();
    await screen.findByText("update-2.pdf");

    expect(within(rowFor("update-2.pdf")).getByText("Terminal")).toBeInTheDocument();
    expect(
      within(rowFor("update-1.pdf")).getByText("Container"),
    ).toBeInTheDocument();
    expect(rowFor("update-1.pdf").querySelector("time")).not.toBeNull();
  });

  it("says plainly when an update changed nothing", async () => {
    listMock.mockResolvedValue([buildDocument({ changedFields: [] })]);

    renderHistory();

    expect(
      await screen.findByText("Deze update wijzigde niets."),
    ).toBeInTheDocument();
  });

  it("marks a document that was not applied", async () => {
    listMock.mockResolvedValue([
      buildDocument({
        applied: false,
        changedFields: [],
        outcome: "Update received after cancellation.",
      }),
    ]);

    renderHistory();

    expect(await screen.findByText("Niet toegepast")).toBeInTheDocument();
  });

  it("offers viewing and downloading each document", async () => {
    listMock.mockResolvedValue([buildDocument()]);
    const user = userEvent.setup();
    const { onView, onDownload } = renderHistory();
    await screen.findByText("transportorder1370334.pdf");

    await user.click(screen.getByRole("button", { name: "Bekijken" }));
    await user.click(screen.getByRole("button", { name: "Downloaden" }));

    expect(onView).toHaveBeenCalledWith("pdf-1");
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ pdfDocumentId: "pdf-1" }),
    );
  });

  it("asks the backend once, for this Trip", async () => {
    listMock.mockResolvedValue([buildDocument()]);

    renderHistory();
    await screen.findByText("transportorder1370334.pdf");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0][0]).toBe("trip-1");
  });

  it("says so when a Trip has no documents", async () => {
    listMock.mockResolvedValue([]);

    renderHistory();

    expect(await screen.findByText("Nog geen documenten")).toBeInTheDocument();
  });

  it("reports a failed read rather than an empty list", async () => {
    listMock.mockRejectedValue(new Error("Service unavailable"));

    renderHistory();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      listMock.mockResolvedValue([buildDocument()]);

      renderHistory();

      expect(await screen.findByText("PDF geçmişi")).toBeInTheDocument();
      expect(screen.getByText("Güncelleme")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Görüntüle" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      listMock.mockResolvedValue([buildDocument()]);

      renderHistory();
      const row = rowFor(await screen.findByText("transportorder1370334.pdf").then(() => "transportorder1370334.pdf"));

      expect(row.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
  });
});

/**
 * An UPDATE that CREATED the Trip is not a revision of anything.
 *
 * It happens when the original order never reached us: the first document for
 * that booking is a revision of it, and the Trip is created from that document.
 * Saying so in the list is what keeps it from reading as though somebody
 * changed a Trip that had been there all along.
 */
describe("a document that created the Trip", () => {
  it("says so beside the filename", async () => {
    listMock.mockResolvedValue([
      buildDocument({ createdTrip: true, changedFields: [] }),
    ]);

    renderHistory();

    expect(await screen.findByText("Rit aangemaakt")).toBeInTheDocument();
  });

  it("says nothing of the sort for an ordinary update", async () => {
    listMock.mockResolvedValue([buildDocument()]);

    renderHistory();
    await screen.findByText("transportorder1370334.pdf");

    expect(screen.queryByText("Rit aangemaakt")).toBeNull();
  });

  it("is translated", async () => {
    window.localStorage.setItem("tms.language", "tr");
    listMock.mockResolvedValue([
      buildDocument({ createdTrip: true, changedFields: [] }),
    ]);

    renderHistory();

    expect(await screen.findByText("Sefer oluşturuldu")).toBeInTheDocument();
  });
});
