import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ImportsPage from "./page";
import { ApiError } from "@/lib/api/client";
import { type ListImportedEmailsParams, listImportedEmails } from "@/lib/api/imports";
import type { ImportedEmail, Paginated } from "@/lib/api/types";

jest.mock("@/lib/api/imports");

const listMock = listImportedEmails as jest.MockedFunction<
  typeof listImportedEmails
>;

/**
 * Import monitoring.
 *
 * The screen answers four questions: did it arrive, was it handled, what did it
 * ask for, and did it produce a PDF. It is read-only, and a test asserts there
 * is nothing on it that could change a record.
 */

function buildEmail(overrides: Partial<ImportedEmail> = {}): ImportedEmail {
  return {
    id: "email-1",
    senderEmail: "orders@carrier.test",
    subject: "NEW: Trucking Order 1212816",
    receivedAt: "2026-08-13T06:00:00.000Z",
    processedAt: "2026-08-13T06:00:05.000Z",
    processingStatus: "PROCESSED",
    importType: "NEW",
    pdfDocumentId: "pdf-1",
    ...overrides,
  };
}

function buildPage(
  items: ImportedEmail[],
  meta: Partial<Paginated<ImportedEmail>["meta"]> = {},
): Paginated<ImportedEmail> {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
      ...meta,
    },
  };
}

function lastQuery(): ListImportedEmailsParams {
  const calls = listMock.mock.calls;
  const last = calls[calls.length - 1];

  if (!last) {
    throw new Error("The import list was never requested.");
  }

  return last[0] ?? {};
}

function rowFor(subject: string): HTMLElement {
  return screen.getByText(subject).closest("tr") as HTMLElement;
}

describe("ImportsPage", () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue(buildPage([buildEmail()]));
  });

  describe("loading", () => {
    it("shows a loading state first", () => {
      listMock.mockReturnValue(new Promise(() => undefined));

      render(<ImportsPage />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("lists the emails the scan has seen", async () => {
      render(<ImportsPage />);

      expect(
        await screen.findByText("NEW: Trucking Order 1212816"),
      ).toBeInTheDocument();
      expect(screen.getByText("orders@carrier.test")).toBeInTheDocument();
    });

    it("shows when the mail arrived", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        within(rowFor("NEW: Trucking Order 1212816")).getByText("2026-08-13 06:00"),
      ).toBeInTheDocument();
    });

    it("indicates that a PDF was stored", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        within(rowFor("NEW: Trucking Order 1212816")).getByText("Stored"),
      ).toBeInTheDocument();
    });

    it("indicates when no PDF was produced", async () => {
      listMock.mockResolvedValue(
        buildPage([buildEmail({ pdfDocumentId: null })]),
      );

      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        within(rowFor("NEW: Trucking Order 1212816")).getByText("None"),
      ).toBeInTheDocument();
    });
  });

  describe("statuses", () => {
    it.each([
      ["PROCESSED", /trips were created/i],
      ["FAILED", /no trips were created/i],
      ["IGNORED", /set aside on purpose/i],
      ["PROCESSING", /started, but not finished/i],
      ["RECEIVED", /not yet processed/i],
    ] as const)("explains what %s means", async (processingStatus, meaning) => {
      listMock.mockResolvedValue(
        buildPage([buildEmail({ processingStatus })]),
      );

      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      const row = rowFor("NEW: Trucking Order 1212816");

      expect(within(row).getByText(processingStatus)).toBeInTheDocument();
      expect(within(row).getByText(meaning)).toBeInTheDocument();
    });

    /**
     * The backend records THAT an import failed, not why — there is no error
     * column. The row must therefore say what happens next rather than imply a
     * reason it does not have.
     */
    it("tells the operator a failed import will be retried", async () => {
      listMock.mockResolvedValue(
        buildPage([
          buildEmail({ processingStatus: "FAILED", processedAt: null }),
        ]),
      );

      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        within(rowFor("NEW: Trucking Order 1212816")).getByText(
          /next scan will try again/i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("import types", () => {
    it("shows the type the subject asked for", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        within(rowFor("NEW: Trucking Order 1212816")).getByText("NEW"),
      ).toBeInTheDocument();
    });

    it.each(["UPDATE", "CANCEL"] as const)(
      "marks %s as not carried out yet",
      async (importType) => {
        listMock.mockResolvedValue(
          buildPage([buildEmail({ importType, processingStatus: "IGNORED" })]),
        );

        render(<ImportsPage />);
        await screen.findByText("NEW: Trucking Order 1212816");

        expect(
          within(rowFor("NEW: Trucking Order 1212816")).getByText(
            "Not carried out yet",
          ),
        ).toBeInTheDocument();
      },
    );
  });

  describe("filtering", () => {
    it("sends the chosen status", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      await userEvent.selectOptions(screen.getByLabelText("Status"), "FAILED");

      await waitFor(() => {
        expect(lastQuery().processingStatus).toBe("FAILED");
      });
    });

    it("sends the chosen import type", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      await userEvent.selectOptions(screen.getByLabelText("Type"), "CANCEL");

      await waitFor(() => {
        expect(lastQuery().importType).toBe("CANCEL");
      });
    });

    it("omits a filter set back to all", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      await userEvent.selectOptions(screen.getByLabelText("Status"), "FAILED");
      await waitFor(() => expect(lastQuery().processingStatus).toBe("FAILED"));

      await userEvent.selectOptions(screen.getByLabelText("Status"), "");

      await waitFor(() => {
        expect(lastQuery().processingStatus).toBeUndefined();
      });
    });

    it("sends only parameters the backend supports", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(Object.keys(lastQuery()).sort()).toEqual([
        "importType",
        "page",
        "pageSize",
        "processingStatus",
      ]);
    });
  });

  describe("pagination", () => {
    it("is hidden when everything fits", async () => {
      render(<ImportsPage />);
      await screen.findByText("NEW: Trucking Order 1212816");

      expect(
        screen.queryByRole("navigation", { name: "Pagination" }),
      ).not.toBeInTheDocument();
    });

    it("requests the next page", async () => {
      listMock.mockResolvedValue(
        buildPage([buildEmail()], { totalItems: 60, totalPages: 3 }),
      );

      render(<ImportsPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Next" }));

      await waitFor(() => expect(lastQuery().page).toBe(2));
    });

    it("returns to the first page when a filter changes", async () => {
      listMock.mockResolvedValue(
        buildPage([buildEmail()], { totalItems: 60, totalPages: 3 }),
      );

      render(<ImportsPage />);
      await userEvent.click(await screen.findByRole("button", { name: "Next" }));
      await waitFor(() => expect(lastQuery().page).toBe(2));

      await userEvent.selectOptions(screen.getByLabelText("Status"), "FAILED");

      await waitFor(() => expect(lastQuery().page).toBe(1));
    });
  });

  describe("empty and error states", () => {
    it("explains an empty list", async () => {
      listMock.mockResolvedValue(buildPage([]));

      render(<ImportsPage />);

      expect(await screen.findByText("No imports yet")).toBeInTheDocument();
    });

    it("distinguishes 'no matches' from 'nothing at all'", async () => {
      listMock.mockResolvedValue(buildPage([]));

      render(<ImportsPage />);
      await screen.findByText("No imports yet");

      await userEvent.selectOptions(screen.getByLabelText("Status"), "FAILED");

      expect(
        await screen.findByText("No imports match these filters"),
      ).toBeInTheDocument();
    });

    it("shows the backend's message on failure", async () => {
      listMock.mockRejectedValue(
        new ApiError("INTERNAL_ERROR", "The database is unavailable.", 500),
      );

      render(<ImportsPage />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The database is unavailable.",
      );
    });
  });

  /** The record of what happened must not be editable from this screen. */
  it("offers no way to change a record", async () => {
    render(<ImportsPage />);
    await screen.findByText("NEW: Trucking Order 1212816");

    expect(
      screen.queryByRole("button", { name: /delete|retry|edit|reprocess/i }),
    ).not.toBeInTheDocument();
  });
});
