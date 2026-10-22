import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError, request } from "@/lib/api/client";
import {
  applyInvoiceAudit,
  type AppliedInvoiceAudit,
} from "@/lib/api/invoice-audit";
import { downloadBlob } from "@/lib/download";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import InvoiceAuditPage from "./page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

/*
 * The final processing answers with BYTES rather than the envelope, so it has
 * its own client function — and the browser API that saves a file is the one
 * thing jsdom cannot do for real.
 */
jest.mock("@/lib/api/invoice-audit", () => ({
  ...jest.requireActual("@/lib/api/invoice-audit"),
  applyInvoiceAudit: jest.fn(),
}));

jest.mock("@/lib/download", () => ({ downloadBlob: jest.fn() }));

const applyMock = applyInvoiceAudit as jest.MockedFunction<
  typeof applyInvoiceAudit
>;
const downloadMock = downloadBlob as jest.MockedFunction<typeof downloadBlob>;

function applied(overrides: Record<string, unknown> = {}) {
  return {
    file: new Blob(["PK"]),
    fileName: "week 13 - 2026 GLT - gecorrigeerd.xlsx",
    paidTrips: 1,
    alreadyPaid: 0,
    rowsAdded: 1,
    rowsMarked: 3,
    correctedCells: 2,
    ...overrides,
  };
}

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Excel factuurcontrole, as an operator uses it.
 *
 * ── WHAT THIS PAGE MAY AND MAY NOT DO ───────────────────────────────────────
 * It sends one workbook and shows what came back. It does not read the file,
 * does not compute a status of its own and does not write anything — so these
 * tests assert the request it makes, the answer it renders, and that a problem
 * row is visibly a problem.
 */

const CHECK_PATH = "/api/v1/invoice-audit/check";

function result(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "week 13 - 2026 GLT.xlsx",
    sheetName: "Sheet1",
    period: { from: "2026-03-23", to: "2026-03-27" },
    summary: {
      totalRows: 4,
      matched: 1,
      notFound: 1,
      notFinished: 1,
      ambiguous: 1,
      priceChecked: 1,
      priceUnchanged: 0,
      priceCorrected: 1,
      priceNotDistributable: 0,
      correctedCells: 2,
      missingTrips: 1,
      addedMissing: 0,
      containerCorrected: 0,
    },
    rows: [
      {
        rowNumber: 2,
        status: "MATCHED",
        planningDate: "2026-03-23",
        bookingNumber: "DUBANR2718284",
        containerNumber: "EUCU 4581604",
        normalizedContainerNumber: "EUCU4581604",
        trip: {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: "CLOSED",
          planningDate: "2026-03-23",
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
        candidates: [],
        sharedKeyRowNumbers: [],
        pricingStatus: "PRICING_CORRECTED",
        containerCorrection: null,
        differences: [
          {
            component: "Tarief",
            kind: "RAISE",
            column: "Tarief",
            invoiceValue: "364.00",
            expectedValue: "370.00",
            difference: "6.00",
            correctedValue: "370.00",
            correctionRowNumber: 2,
            keepsFormula: false,
            problem: null,
          },
          {
            component: "Backload",
            kind: "RAISE",
            column: "Backload",
            invoiceValue: null,
            expectedValue: "50.00",
            difference: "50.00",
            correctedValue: "50.00",
            correctionRowNumber: 2,
            keepsFormula: false,
            problem: null,
          },
        ],
      },
      {
        rowNumber: 3,
        status: "NOT_FOUND",
        planningDate: "2026-03-24",
        bookingNumber: "ANRDUB2725107",
        containerNumber: "TLLU 1595717",
        normalizedContainerNumber: "TLLU1595717",
        trip: null,
        candidates: [],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        containerCorrection: null,
        differences: [],
      },
      {
        rowNumber: 4,
        status: "NOT_FINISHED",
        planningDate: "2026-03-25",
        bookingNumber: "ANRBEL2642387",
        containerNumber: "PVDU 1131710",
        normalizedContainerNumber: "PVDU1131710",
        trip: null,
        candidates: [
          {
            id: "3f1b0d2e-0000-4000-8000-000000000002",
            status: "OPEN",
            planningDate: "2026-03-25",
            bookingNumber: "ANRBEL2642387",
            containerNumber: "PVDU1131710",
          },
        ],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        containerCorrection: null,
        differences: [],
      },
      {
        rowNumber: 5,
        status: "AMBIGUOUS",
        planningDate: "2026-03-26",
        bookingNumber: "ANRCRK2643680",
        containerNumber: "EUCU 2451936",
        normalizedContainerNumber: "EUCU2451936",
        trip: null,
        candidates: [
          {
            id: "a",
            status: "CLOSED",
            planningDate: "2026-03-26",
            bookingNumber: "ANRCRK2643680",
            containerNumber: "EUCU2451936",
          },
          {
            id: "b",
            status: "CLOSED",
            planningDate: "2026-03-26",
            bookingNumber: "ANRCRK2643680",
            containerNumber: "EUCU2451936",
          },
        ],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        containerCorrection: null,
        differences: [],
      },
    ],
    incompleteRowNumbers: [],
    blockedMissingTrips: [],
    missingTrips: [
      {
        tripId: "9c0f0d2e-0000-4000-8000-000000000009",
        planningDate: "2026-03-23",
        bookingNumber: "BELANR2720016",
        containerNumber: "EUCU2451828",
        route: "Quay 869 -> MELSELE",
        tarief: "517.20",
        totaal: "681.08",
        priceReliability: {
          reliable: true,
          problem: null,
          explanation: null,
          route: null,
        },
        remarks: "tar,EC 4220981",
        remarkNotes: [],
        combinationEnd: null,
        rowNumber: 108,
      },
    ],
    totalsStructure: { sound: true, problems: [] },
    fuelHeader: null,
    markedRowNumbers: [3, 4, 5],
    totals: {
      columns: [
        { column: "Tarief", before: "364.00", after: "370.00" },
        { column: "Fuel", before: "36.40", after: "36.40" },
      ],
      before: "400.40",
      after: "406.40",
    },
    payments: [
      {
        tripId: "3f1b0d2e-0000-4000-8000-000000000001",
        planningDate: "2026-03-23",
        bookingNumber: "DUBANR2718284",
        containerNumber: "EUCU4581604",
        rowNumbers: [2],
        payable: true,
        category: "RAISED",
        reasons: [],
        alreadyPaid: false,
      },
      {
        tripId: "3f1b0d2e-0000-4000-8000-000000000004",
        planningDate: "2026-03-23",
        bookingNumber: "ANRDUB2725107",
        containerNumber: "PVDU0000001",
        rowNumbers: [4],
        payable: false,
        category: null,
        reasons: ["NOT_CLOSED"],
        alreadyPaid: false,
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  // Dutch, as the application defaults to and as these assertions read.
  window.localStorage.setItem("tms.language", "nl");

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <InvoiceAuditPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function workbook(name = "week 13 - 2026 GLT.xlsx"): File {
  return new File(["PK"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** The hidden input the visible label opens. */
function fileInput(): HTMLInputElement {
  return document.getElementById("invoice-upload-input") as HTMLInputElement;
}

async function upload(
  file = workbook(),
  options: { applyAccept?: boolean } = {},
): Promise<void> {
  await userEvent.upload(fileInput(), file, options);
}

/** The table of invoice lines — the first table; the totals have their own. */
function linesTable(): HTMLElement {
  return screen.getAllByRole("table")[0];
}

function rowFor(bookingNumber: string): HTMLElement {
  // A matched line prints the booking twice — its own cell, and the Trip it was
  // matched to — so the first occurrence, which is the cell, is the anchor.
  return screen.getAllByText(bookingNumber)[0].closest("tr") as HTMLElement;
}

describe("Excel factuurcontrole", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue(result());
    applyMock.mockReset();
    applyMock.mockResolvedValue(applied());
    downloadMock.mockReset();
  });

  /** Uploads, checks, and waits for the answer to be on screen. */
  async function check(): Promise<void> {
    renderPage();
    await upload();
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));
    await screen.findAllByText("DUBANR2718284");
  }

  /**
   * ── NOTHING IS LOWERED, AND A DOUBTFUL PRICE IS SHOWN, NOT USED ──────────
   * The backend decides both; the page shows a figure the invoice states higher
   * as "not lowered", and puts the Trip's own road beside the road its price was
   * made on when that price is not relied on.
   */
  describe("prices that are not written", () => {
    const matchedRow = result().rows[0];

    it("shows a higher invoice amount as not lowered", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              pricingStatus: "INVOICE_HIGHER",
              priceReliability: {
                reliable: true,
                problem: null,
                explanation: null,
                route: null,
              },
              differences: [
                {
                  component: "Tarief",
                  kind: "INVOICE_HIGHER",
                  column: "Tarief",
                  invoiceValue: "334.00",
                  expectedValue: "300.00",
                  difference: "-34.00",
                  correctedValue: null,
                  correctionRowNumber: 2,
                  keepsFormula: false,
                  problem: null,
                },
              ],
            },
          ],
        }),
      );

      await check();

      const row = rowFor("DUBANR2718284");
      expect(within(row).getByText("Factuur hoger dan systeem")).toBeInTheDocument();
      expect(within(row).getByText(/€334\.00 · €300\.00 · niet verlaagd/)).toBeInTheDocument();
    });

    it("shows why a price is not relied on, with both roads and the match method", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              pricingStatus: "PRICE_UNRELIABLE",
              differences: [],
              priceReliability: {
                reliable: false,
                problem: "ROUTE_NOT_FOUND",
                explanation: "Voor de rit is geen route gevonden.",
                route: {
                  matchMethod: "NOT_FOUND",
                  tripRoute: "Eindhout → Quay 869",
                  pricedRoute: null,
                },
              },
            },
          ],
        }),
      );

      await check();

      const row = rowFor("DUBANR2718284");
      expect(within(row).getByText("Prijs onbetrouwbaar")).toBeInTheDocument();
      expect(within(row).getByText("Geen route gevonden")).toBeInTheDocument();
      expect(within(row).getByText("Eindhout → Quay 869")).toBeInTheDocument();
      expect(within(row).getByText(/Geen betrouwbare route gevonden/)).toBeInTheDocument();
    });

    /** The system matched Eindhout on LAAKDAL (EINDHOUT): its price is compared. */
    it("does not call a price unreliable for a route the system matched", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              priceReliability: {
                reliable: true,
                problem: null,
                explanation: null,
                route: {
                  matchMethod: "NORMALIZED",
                  tripRoute: "Eindhout → Quay 869",
                  pricedRoute: "LAAKDAL (EINDHOUT) → Quay 869",
                },
              },
            },
          ],
        }),
      );

      await check();

      const row = rowFor("DUBANR2718284");
      expect(within(row).getByText("Prijs aangepast")).toBeInTheDocument();
      expect(within(row).queryByText("Prijs onbetrouwbaar")).not.toBeInTheDocument();
      expect(within(row).queryByText(/Niet aantoonbaar/)).not.toBeInTheDocument();
    });
  });

  /**
   * ── WHAT THE IDENTIFICATION DECIDED, SHOWN ───────────────────────────────
   * A corrected booking, an EC line's confirmation, a Combination's verdict and
   * a transport held back from the invoice — all decided by the backend.
   */
  describe("how lines were identified", () => {
    const matchedRow = result().rows[0];

    /**
     * The recommended action is the backend's, worded from the line's actual
     * outcome; the screen lays out its three parts separately.
     */
    it("shows a corrected date and the recommended action, problem, explanation and action apart", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              planningDate: "2026-03-23",
              dateCorrection: { invoicePlanningDate: "2026-03-23", tripPlanningDate: "2026-03-24" },
              advice: [
                {
                  severity: "WARNING",
                  problem: "Datum komt niet overeen",
                  explanation: "Boekingsnummer en containernummer komen overeen met één unieke rit in Trano.",
                  action: "Corrigeer de datum in Excel van 23/03/2026 naar 24/03/2026.",
                },
              ],
            },
          ],
        }),
      );

      await check();

      const transport = rowFor("DUBANR2718284");
      expect(screen.getByRole("columnheader", { name: "Aanbevolen actie" })).toBeInTheDocument();
      expect(within(transport).getByText(/Datum gecorrigeerd → 2026-03-24/)).toBeInTheDocument();
      expect(within(transport).getByText("Waarschuwing")).toBeInTheDocument();
      expect(within(transport).getByText("Datum komt niet overeen")).toBeInTheDocument();
      expect(
        within(transport).getByText("Boekingsnummer en containernummer komen overeen met één unieke rit in Trano."),
      ).toBeInTheDocument();
      expect(within(transport).getByText("Corrigeer de datum in Excel van 23/03/2026 naar 24/03/2026.")).toBeInTheDocument();
    });

    it("shows an unresolved line's advice instead of repeating its short problem", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              status: "COST_LINE_UNRESOLVED",
              trip: null,
              pricingStatus: "NOT_COMPARED",
              differences: [],
              matchProblem: "Geen kostenbevestiging gevonden voor EC 4214683.",
              advice: [
                {
                  severity: "ERROR",
                  problem: "EC-kostenbevestiging niet gekoppeld",
                  explanation:
                    "De ritmatch is wel succesvol: de rit zelf staat op Excel-rij 39 en is daar gewoon gecontroleerd. Geen kostenbevestiging gevonden voor EC 4214683.",
                  action: "Controleer het EC-nummer (4214683).",
                },
              ],
            },
          ],
        }),
      );

      await check();

      const line = rowFor("DUBANR2718284");
      expect(within(line).getByText("Fout")).toBeInTheDocument();
      expect(within(line).getByText(/De ritmatch is wel succesvol/)).toBeInTheDocument();
      expect(within(line).queryByText("Geen kostenbevestiging gevonden voor EC 4214683.")).not.toBeInTheDocument();
    });

    it("shows a corrected booking, an EC line and a Combination verdict", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...matchedRow,
              bookingCorrection: {
                invoiceBookingNumber: "DUBANR2718000",
                tripBookingNumber: "DUBANR2718284",
              },
              combination: { verdict: "GEEN_COMBI", partnerRowNumber: 3, reason: null },
              remarks: {
                before: "tar  ",
                after: "tar,GEEN COMBI",
                added: ["GEEN COMBI"],
                notes: ["De wachttijd heeft geen venster binnen één dag en wordt daarom niet geschreven."],
              },
            },
            {
              ...matchedRow,
              rowNumber: 53,
              status: "COST_LINE",
              bookingNumber: "ANRDUB2812770",
              containerNumber: "",
              pricingStatus: "MATCHED_NO_CHANGES",
              differences: [],
              costConfirmation: { ccNumber: "4220981", amount: "110.00" },
            },
          ],
        }),
      );

      await check();

      const transport = rowFor("DUBANR2718284");
      expect(within(transport).getByText(/Booking gecorrigeerd → DUBANR2718284/)).toBeInTheDocument();
      expect(within(transport).getByText(/GEEN COMBI, Backload verwijderd · met rij 3/)).toBeInTheDocument();
      expect(within(transport).getByText("Remarks aangevuld: GEEN COMBI")).toBeInTheDocument();
      expect(
        within(transport).getByText(
          "De wachttijd heeft geen venster binnen één dag en wordt daarom niet geschreven.",
        ),
      ).toBeInTheDocument();

      const costLine = rowFor("ANRDUB2812770");
      expect(within(costLine).getByText("EC-regel")).toBeInTheDocument();
      expect(within(costLine).getByText("EC 4220981 · €110.00")).toBeInTheDocument();
    });

    it("lists a transport it did not add, with the rows that block it", async () => {
      requestMock.mockResolvedValue(
        result({
          blockedMissingTrips: [
            {
              tripId: "9c0f0d2e-0000-4000-8000-000000000010",
              planningDate: "2026-10-06",
              bookingNumber: "ANRDUB2810849",
              containerNumber: "EUCU4541197",
              blockingRowNumbers: [3],
            },
          ],
        }),
      );

      await check();

      expect(
        screen.getByText("Niet toegevoegd, mogelijk al op de factuur:"),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "ANRDUB2810849" })).toBeInTheDocument();
    });
  });

  describe("before anything is checked", () => {
    it("says what the page will do and asks nothing of the server", () => {
      renderPage();

      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it("cannot be checked without a file", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: "Controleren" }),
      ).toBeDisabled();
    });
  });

  describe("checking a workbook", () => {
    it("sends the file to the check endpoint", async () => {
      renderPage();
      await upload();

      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

      const [path, options] = requestMock.mock.calls[0];
      expect(path).toBe(CHECK_PATH);
      expect(options?.method).toBe("POST");
      expect(options?.body).toBeInstanceOf(FormData);
      expect((options?.body as FormData).get("file")).toBeInstanceOf(File);
    });

    it("shows that it is working while the check runs", async () => {
      let finish: (value: unknown) => void = () => {};
      requestMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const busy = await screen.findByRole("button", {
        name: "Bezig met controleren…",
      });
      expect(busy).toBeDisabled();

      finish(result());
      await screen.findByText("week 13 - 2026 GLT.xlsx");
    });

    it("shows the counts and the period the file covers", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      expect(
        await screen.findByText("23 maart 2026 - 27 maart 2026"),
      ).toBeInTheDocument();

      const summary = screen
        .getByText("Factuurregels")
        .closest("dl") as HTMLElement;
      expect(
        within(summary).getByText("Bestand").nextSibling,
      ).toHaveTextContent("week 13 - 2026 GLT.xlsx");
      expect(within(summary).getByText("4")).toBeInTheDocument();
    });

    it("shows one row per invoice line, with its Excel row number", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(within(linesTable()).getAllByRole("row")).toHaveLength(5); // the header and four lines
      expect(
        within(rowFor("DUBANR2718284")).getByText("2"),
      ).toBeInTheDocument();
      expect(
        within(rowFor("ANRCRK2643680")).getByText("5"),
      ).toBeInTheDocument();
    });

    it("links a matched line to the Trip it was matched to", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const link = within(rowFor("DUBANR2718284")).getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "/trips/3f1b0d2e-0000-4000-8000-000000000001",
      );
      expect(link).toHaveTextContent("CLOSED");
    });
  });

  describe("the problem rows", () => {
    /**
     * The three answers an operator has to act on carry one highlight, and it
     * is the same set the corrected workbook will mark yellow later.
     */
    it.each([
      ["ANRDUB2725107", "Niet gevonden"],
      ["ANRBEL2642387", "Niet afgewerkt"],
      ["ANRCRK2643680", "Meerdere matches"],
    ])("marks %s as a problem", async (booking, label) => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText(booking);

      const row = rowFor(booking);
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(row.className).toContain("bg-[#fdfd66]");
    });

    it("leaves a matched line unmarked", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(rowFor("DUBANR2718284").className).not.toContain("bg-[#fdfd66]");
    });

    it("names the unfinished Trip rather than linking to nothing", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText("ANRBEL2642387");

      const row = rowFor("ANRBEL2642387");
      expect(within(row).queryByRole("link")).not.toBeInTheDocument();
      expect(row).toHaveTextContent("OPEN");
    });
  });

  describe("the pricing check", () => {
    it("says which lines were corrected and which were already right", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const row = rowFor("DUBANR2718284");
      expect(within(row).getByText("Prijs aangepast")).toBeInTheDocument();
      expect(row).toHaveTextContent("Tarief: €364.00 → €370.00");
      expect(row).toHaveTextContent("Backload: €— → €50.00");
    });

    it("marks a line whose prices were already correct", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...result().rows[0],
              pricingStatus: "MATCHED_NO_CHANGES",
              containerCorrection: null,
              differences: [],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(
        within(rowFor("DUBANR2718284")).getByText("Gecontroleerd"),
      ).toBeInTheDocument();
    });

    /** A difference the document gives no place to is shown, not written. */
    it("says when a difference could not be placed on a cell", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...result().rows[0],
              pricingStatus: "NOT_DISTRIBUTABLE",
              containerCorrection: null,
              differences: [
                {
                  component: "EK",
                  kind: "NOT_PLACEABLE",
                  column: null,
                  invoiceValue: "200.00",
                  expectedValue: "250.00",
                  difference: "50.00",
                  correctedValue: null,
                  correctionRowNumber: 2,
                  keepsFormula: false,
                  problem: "EK is stated on 2 rows of this invoice",
                },
              ],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const row = rowFor("DUBANR2718284");
      expect(
        within(row).getByText("Verschil niet toewijsbaar"),
      ).toBeInTheDocument();
      expect(row).toHaveTextContent("EK: €200.00 → €250.00");
      expect(row).toHaveTextContent(
        "staat op meerdere regels, niets gewijzigd",
      );
    });

    /** A line with no Trip is never compared, and shows no pricing verdict. */
    it.each(["ANRDUB2725107", "ANRBEL2642387", "ANRCRK2643680"])(
      "compares nothing for %s",
      async (booking) => {
        renderPage();
        await upload();
        await userEvent.click(
          screen.getByRole("button", { name: "Controleren" }),
        );

        await screen.findByText(booking);

        const row = rowFor(booking);
        expect(
          within(row).queryByText("Prijs aangepast"),
        ).not.toBeInTheDocument();
        expect(
          within(row).queryByText("Gecontroleerd"),
        ).not.toBeInTheDocument();
      },
    );

    it("counts the corrections in the summary", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const summary = screen
        .getByText("Aangepaste cellen")
        .closest("dl") as HTMLElement;

      expect(
        within(summary).getByText("Aangepaste cellen").nextSibling,
      ).toHaveTextContent("2");
      expect(
        within(summary).getByText("Prijs aangepast").nextSibling,
      ).toHaveTextContent("1");
    });
  });

  describe("lines sharing one key", () => {
    it("shows both rows and says which rows share the key", async () => {
      requestMock.mockResolvedValue(
        result({
          summary: {
            totalRows: 2,
            matched: 2,
            notFound: 0,
            notFinished: 0,
            ambiguous: 0,
            priceChecked: 2,
            priceUnchanged: 2,
            priceCorrected: 0,
            priceNotDistributable: 0,
            correctedCells: 0,
            missingTrips: 0,
            addedMissing: 0,
            containerCorrected: 0,
          },
          rows: [
            {
              ...result().rows[0],
              rowNumber: 8,
              sharedKeyRowNumbers: [9],
              pricingStatus: "MATCHED_NO_CHANGES",
              containerCorrection: null,
              differences: [],
            },
            {
              ...result().rows[0],
              rowNumber: 9,
              sharedKeyRowNumbers: [8],
              pricingStatus: "MATCHED_NO_CHANGES",
              containerCorrection: null,
              differences: [],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const rows = within(linesTable()).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("zelfde sleutel als rij 9");
      expect(rows[1]).toHaveTextContent("zelfde sleutel als rij 8");
    });
  });

  /**
   * ── THE TRANSPORTS THE INVOICE FORGOT ─────────────────────────────────────
   * Finished, unpaid and not on the document. They are not problems and are not
   * highlighted: the corrected workbook adds them as ordinary lines, and the
   * screen says which row each one will take.
   */
  describe("missing finished transports", () => {
    it("lists them with the row the corrected file gives them", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText("Ontbrekende afgewerkte ritten:");

      const entry = screen
        .getByText("BELANR2720016")
        .closest("li") as HTMLElement;

      expect(entry).toHaveTextContent("Rij 108");
      expect(entry).toHaveTextContent("EUCU2451828");
      expect(entry).toHaveTextContent("2026-03-23");
      expect(entry).toHaveTextContent("Quay 869 -> MELSELE");
      expect(entry).toHaveTextContent("€681.08");
      expect(entry).toHaveTextContent("toegevoegd aan factuur");
    });

    it("links each of them to its Trip", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const link = await screen.findByRole("link", { name: "BELANR2720016" });

      expect(link).toHaveAttribute(
        "href",
        "/trips/9c0f0d2e-0000-4000-8000-000000000009",
      );
    });

    it("counts them in the summary", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const summary = screen
        .getByText("Ontbrekende ritten")
        .closest("dl") as HTMLElement;

      expect(
        within(summary).getByText("Ontbrekende ritten").nextSibling,
      ).toHaveTextContent("1");
    });

    it("says nothing at all when the invoice is complete", async () => {
      requestMock.mockResolvedValue(
        result({
          summary: { ...result().summary, missingTrips: 0 },
          missingTrips: [],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(
        screen.queryByText("Ontbrekende afgewerkte ritten:"),
      ).not.toBeInTheDocument();
    });

    it("shows the Remarks the added line gets", async () => {
      renderPage();
      await upload();
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      const entry = (await screen.findByText("BELANR2720016")).closest("li") as HTMLElement;

      expect(entry).toHaveTextContent("Remarks: tar,EC 4220981");
    });

    it("says a line without a reliable price is added without amounts, and why", async () => {
      const [missing] = result().missingTrips;

      requestMock.mockResolvedValue(
        result({
          missingTrips: [
            {
              ...missing,
              priceReliability: {
                reliable: false,
                problem: "NO_SNAPSHOT",
                explanation: "never priced",
                route: null,
              },
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      const entry = (await screen.findByText("BELANR2720016")).closest("li") as HTMLElement;

      expect(entry).toHaveTextContent("toegevoegd zonder bedragen, geel gemarkeerd");
      expect(entry).toHaveTextContent("Rit is nooit geprijsd");
      expect(entry).not.toHaveTextContent("€681.08");
    });

    it("says nothing is added when the document's totals deviate, and lists them", async () => {
      const [missing] = result().missingTrips;

      requestMock.mockResolvedValue(
        result({
          missingTrips: [{ ...missing, rowNumber: null }],
          totalsStructure: {
            sound: false,
            problems: ["Backload: the total covers rows 2–138, not 2–141 (SUM(N2:N138))"],
          },
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      const entry = (await screen.findByText("BELANR2720016")).closest("li") as HTMLElement;

      expect(entry).toHaveTextContent("niet toegevoegd, totalen wijken af");
      expect(entry).not.toHaveTextContent("Rij");
      expect(screen.getByText("Totalen wijken af")).toBeInTheDocument();
      expect(screen.getByText(/SUM\(N2:N138\)/)).toBeInTheDocument();
    });
  });

  describe("the Fuel header", () => {
    it("shows the header and label it rewrites", async () => {
      requestMock.mockResolvedValue(
        result({
          fuelHeader: {
            percentage: "24",
            header: { address: "M1", before: "Fuel 23%", after: "Fuel 24%" },
            label: { address: "K131", before: "Fuel 23% ", after: "Fuel 24% " },
          },
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(screen.getByRole("button", { name: "Controleren" }));

      const note = (await screen.findByText("Fuel-kop aangepast:")).closest("p") as HTMLElement;

      expect(note).toHaveTextContent("M1: “Fuel 23%” → “Fuel 24%”");
      expect(note).toHaveTextContent("K131: “Fuel 23%” → “Fuel 24%”");
    });
  });

  /**
   * ── THE FINAL STEP IS A DECISION ──────────────────────────────────────────
   * Checking changes nothing and may be repeated. Processing produces the
   * corrected file — a second, deliberate action that says what it will do,
   * pays nothing, and cannot be started twice.
   */
  describe("processing the invoice", () => {
    it("is not offered before anything has been checked", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: "Verwerken en downloaden" }),
      ).not.toBeInTheDocument();
    });

    it("does nothing on its own: checking settles nothing", async () => {
      await check();

      expect(applyMock).not.toHaveBeenCalled();
    });

    it("sends the very file that was checked", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
      expect(applyMock.mock.calls[0][0]).toBeInstanceOf(File);
      expect(applyMock.mock.calls[0][0].name).toBe("week 13 - 2026 GLT.xlsx");
    });

    it("saves the corrected workbook under the name the server gave it", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
      expect(downloadMock.mock.calls[0][1]).toBe(
        "week 13 - 2026 GLT - gecorrigeerd.xlsx",
      );
    });

    it("cannot be started twice while it runs", async () => {
      let finish: (value: AppliedInvoiceAudit) => void = () => {};
      applyMock.mockReturnValue(
        new Promise<AppliedInvoiceAudit>((resolve) => {
          finish = resolve;
        }),
      );

      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      const busy = await screen.findByRole("button", {
        name: "Bezig met verwerken…",
      });
      expect(busy).toBeDisabled();

      finish(applied());
      await screen.findByText("Excel verwerkt");
      expect(applyMock).toHaveBeenCalledTimes(1);
    });

    it("reports what the run did", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      const panel = (await screen.findByText("Excel verwerkt"))
        .parentElement as HTMLElement;

      expect(panel).toHaveTextContent("week 13 - 2026 GLT - gecorrigeerd.xlsx");
      expect(
        within(panel).getByText("Prijsaanpassingen").nextSibling,
      ).toHaveTextContent("2");
      expect(
        within(panel).getByText("Ritten toegevoegd").nextSibling,
      ).toHaveTextContent("1");
      expect(
        within(panel).getByText("Probleemregels").nextSibling,
      ).toHaveTextContent("3");
    });

    it("shows the backend's reason when processing fails, and saves nothing", async () => {
      applyMock.mockRejectedValue(
        new ApiError("BAD_REQUEST", "De factuur kon niet verwerkt worden.", 400),
      );

      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "De factuur kon niet verwerkt worden.",
      );
      expect(downloadMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Excel verwerkt")).not.toBeInTheDocument();
    });

    it("names the cells when the corrected file did not match its plan", async () => {
      applyMock.mockRejectedValue(
        new ApiError(
          "INTERNAL_SERVER_ERROR",
          "The corrected invoice did not match its planned changes, so no file was produced and nothing can be paid on it.",
          500,
          ["H2: value changed without a plan"],
        ),
      );

      await check();
      await userEvent.click(screen.getByRole("button", { name: "Verwerken en downloaden" }));

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("no file was produced");
      expect(alert).toHaveTextContent("H2: value changed without a plan");
      expect(downloadMock).not.toHaveBeenCalled();
      // No file, so no payment step either.
      expect(screen.queryByText("Betaling bevestigen")).not.toBeInTheDocument();
    });

    it("forgets what a previous run did when another file is checked", async () => {
      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );
      await screen.findByText("Excel verwerkt");

      await upload(workbook("week 14 - 2026 GLT.xlsx"));

      expect(screen.queryByText("Excel verwerkt")).not.toBeInTheDocument();
    });
  });

  /**
   * ── PAYING IS ITS OWN DECISION ────────────────────────────────────────────
   * Neither the check nor the corrected file pays anything. Once the file
   * exists, the operator chooses from what the BACKEND found payable and
   * confirms; the screen computes none of it.
   */
  describe("confirming the payment", () => {
    const PAYMENT_PATH = "/api/v1/invoice-audit/payment";
    const TRIP_ONE = "3f1b0d2e-0000-4000-8000-000000000001";
    const TRIP_HIGHER = "3f1b0d2e-0000-4000-8000-000000000007";

    function withPayments() {
      return result({
        payments: [
          ...result().payments,
          {
            tripId: TRIP_HIGHER,
            planningDate: "2026-03-24",
            bookingNumber: "ANRDUB2799999",
            containerNumber: "TLLU1999999",
            rowNumbers: [9],
            payable: true,
            category: "INVOICE_HIGHER",
            reasons: [],
            alreadyPaid: false,
          },
        ],
      });
    }

    /** Checks, produces the file, and answers payments with `answer`. */
    async function upToPayment(answer: () => Promise<unknown> = async () => ({
      paidTrips: 2,
      alreadyPaid: 0,
      paidTripIds: [TRIP_ONE, TRIP_HIGHER],
    })) {
      requestMock.mockImplementation((path: string) =>
        path === PAYMENT_PATH ? answer() : Promise.resolve(withPayments()),
      );

      await check();
      await userEvent.click(screen.getByRole("button", { name: "Verwerken en downloaden" }));
      await screen.findByText("Excel verwerkt");
    }

    const paymentCalls = () => requestMock.mock.calls.filter(([path]) => path === PAYMENT_PATH);

    it("is not offered before the corrected file exists", async () => {
      requestMock.mockResolvedValue(withPayments());

      await check();

      expect(screen.queryByText("Betaling bevestigen")).not.toBeInTheDocument();
    });

    it("lists what the backend found payable, a higher invoice apart, and what it did not", async () => {
      await upToPayment();

      const groupOf = (title: string) => screen.getByText(title).closest("section") as HTMLElement;

      expect(groupOf("Prijs verhoogd")).toHaveTextContent("DUBANR2718284");
      expect(groupOf("Factuur hoger dan systeem")).toHaveTextContent("ANRDUB2799999");
      expect(groupOf("Niet te betalen")).toHaveTextContent("PVDU0000001");
      expect(groupOf("Niet te betalen")).toHaveTextContent("rit niet afgesloten");
    });

    /**
     * The screen offers exactly the backend's payable transports, chooses them
     * all to begin with, counts them on the button, and says for each other
     * transport why — with the rows to fix and what to do.
     */
    it("chooses exactly the backend's payable transports and explains the rest with their rows", async () => {
      const AMBIGUOUS_TRIP = "3f1b0d2e-0000-4000-8000-000000000021";

      requestMock.mockImplementation((path: string) =>
        path === PAYMENT_PATH
          ? Promise.resolve({ paidTrips: 2, alreadyPaid: 0, paidTripIds: [] })
          : Promise.resolve(
              result({
                payments: [
                  ...withPayments().payments,
                  {
                    tripId: AMBIGUOUS_TRIP,
                    planningDate: "2026-03-24",
                    bookingNumber: "ANRDUB2810007",
                    containerNumber: "EUCU1000071",
                    rowNumbers: [],
                    payable: false,
                    category: null,
                    reasons: ["AMBIGUOUS_MATCH"],
                    blockingRowNumbers: [9],
                    alreadyPaid: false,
                  },
                ],
              }),
            ),
      );

      await check();
      await userEvent.click(screen.getByRole("button", { name: "Verwerken en downloaden" }));
      await screen.findByText("Excel verwerkt");

      const payable = withPayments().payments.filter(
        (payment: { payable: boolean; alreadyPaid: boolean }) => payment.payable && !payment.alreadyPaid,
      );
      const checked = screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);

      expect(checked).toHaveLength(payable.length);
      expect(screen.getByRole("button", { name: `Betaling bevestigen (${payable.length})` })).toBeInTheDocument();

      const notPayable = screen.getByText("Niet te betalen").closest("section") as HTMLElement;
      expect(notPayable).toHaveTextContent("ANRDUB2810007");
      expect(notPayable).toHaveTextContent("een Excel-regel kan deze rit of een andere zijn (Rij 9)");
      expect(notPayable).toHaveTextContent("corrigeer de datum, het boekingsnummer of het containernummer van die regel");

      await userEvent.click(screen.getByRole("button", { name: `Betaling bevestigen (${payable.length})` }));

      expect(paymentCalls()).toHaveLength(1);
    });

    /** In the system, not in the Excel: paid with the rest unless its price is a problem. */
    it("offers a transport the invoice did not state, chosen like the rest", async () => {
      const ADDED_TRIP = "3f1b0d2e-0000-4000-8000-000000000011";

      requestMock.mockImplementation((path: string) =>
        path === PAYMENT_PATH
          ? Promise.resolve({ paidTrips: 3, alreadyPaid: 0, paidTripIds: [] })
          : Promise.resolve(
              result({
                payments: [
                  ...withPayments().payments,
                  {
                    tripId: ADDED_TRIP,
                    planningDate: "2026-03-25",
                    bookingNumber: "BELANR2720016",
                    containerNumber: "EUCU2451828",
                    rowNumbers: [108],
                    payable: true,
                    category: "ADDED",
                    reasons: [],
                    alreadyPaid: false,
                  },
                ],
              }),
            ),
      );

      await check();
      await userEvent.click(screen.getByRole("button", { name: "Verwerken en downloaden" }));
      await screen.findByText("Excel verwerkt");

      const group = screen.getByText("Niet in Excel, toegevoegd aan factuur").closest("section") as HTMLElement;

      expect(group).toHaveTextContent("BELANR2720016");
      expect(within(group).getByRole("checkbox")).toBeChecked();

      await userEvent.click(screen.getByRole("button", { name: "Betaling bevestigen (3)" }));
      await screen.findByText(/Op betaald gezet:/);

      const [[, options]] = paymentCalls();

      expect(JSON.parse((options as { body: FormData }).body.get("tripIds") as string)).toContain(ADDED_TRIP);
    });

    it("sends the original file with the chosen transports", async () => {
      await upToPayment();

      await userEvent.click(within(screen.getByText("Factuur hoger dan systeem").closest("section") as HTMLElement).getByRole("checkbox"));
      await userEvent.click(screen.getByRole("button", { name: "Betaling bevestigen (1)" }));

      await screen.findByText(/Op betaald gezet:/);
      const [[, options]] = paymentCalls();
      const body = (options as { body: FormData }).body;

      expect((body.get("file") as File).name).toBe("week 13 - 2026 GLT.xlsx");
      expect(JSON.parse(body.get("tripIds") as string)).toEqual([TRIP_ONE]);
    });

    it("reports what the confirmation did", async () => {
      await upToPayment();

      await userEvent.click(screen.getByRole("button", { name: "Betaling bevestigen (2)" }));

      expect(await screen.findByText(/Op betaald gezet:/)).toHaveTextContent("Op betaald gezet: 2");
    });

    it("shows the refusal and the transports it names, and pays nothing", async () => {
      await upToPayment(async () => {
        throw new ApiError(
          "CONFLICT",
          "Some selected transports can no longer be settled on this invoice; nothing was paid.",
          409,
          [`${TRIP_HIGHER}: NOT_CLOSED`],
        );
      });

      await userEvent.click(screen.getByRole("button", { name: "Betaling bevestigen (2)" }));

      const alert = await screen.findByRole("alert");

      expect(alert).toHaveTextContent("nothing was paid");
      expect(alert).toHaveTextContent(`${TRIP_HIGHER}: NOT_CLOSED`);
      expect(screen.queryByText(/Op betaald gezet:/)).not.toBeInTheDocument();
    });

    it("cannot be confirmed twice while it runs", async () => {
      let finish: (value: unknown) => void = () => {};

      await upToPayment(() => new Promise((resolve) => (finish = resolve)));
      await userEvent.click(screen.getByRole("button", { name: "Betaling bevestigen (2)" }));

      expect(await screen.findByRole("button", { name: "Bezig met bevestigen…" })).toBeDisabled();

      finish({ paidTrips: 2, alreadyPaid: 0, paidTripIds: [] });
      await screen.findByText(/Op betaald gezet:/);
      expect(paymentCalls()).toHaveLength(1);
    });
  });

  describe("the totals", () => {
    it("shows the changed columns and the total, received and corrected", async () => {
      await check();

      const table = screen.getByText("Totalen").parentElement as HTMLElement;

      expect(within(table).getByText("Tarief").closest("tr")).toHaveTextContent("€364.00€370.00");
      expect(within(table).queryByText("Fuel")).not.toBeInTheDocument();
      expect(within(table).getByText("Totaal").closest("tr")).toHaveTextContent("€400.40€406.40");
    });
  });

  /**
   * ── A LINE THIS CHECK ADDED, SEEN AGAIN ───────────────────────────────────
   * On the next upload of the corrected document it is recognised, priced like
   * any other line, and never counted among the transports the run will settle.
   */
  describe("a line added by a previous run", () => {
    function withAddedLine() {
      return result({
        summary: { ...result().summary, addedMissing: 1 },
        rows: [
          {
            ...result().rows[0],
            rowNumber: 19,
            status: "ADDED_MISSING",
            bookingNumber: "BELANR2720016",
            containerNumber: "EUCU2451828",
            pricingStatus: "PRICING_CORRECTED",
            containerCorrection: null,
            differences: [
              {
                component: "Tarief",
                column: "Tarief",
                invoiceValue: "517.20",
                expectedValue: "600.00",
                difference: "82.80",
                correctedValue: "600.00",
                correctionRowNumber: 19,
                keepsFormula: false,
                problem: null,
              },
            ],
          },
        ],
      });
    }

    it("says the line came from the check itself", async () => {
      requestMock.mockResolvedValue(withAddedLine());

      await check();

      const row = rowFor("BELANR2720016");

      expect(within(row).getByText("Door controle toegevoegd")).toBeInTheDocument();
      // Not a problem line: no highlight.
      expect(row.className).not.toContain("bg-[#fdfd66]");
    });

    it("still shows what its prices did", async () => {
      requestMock.mockResolvedValue(withAddedLine());

      await check();

      expect(rowFor("BELANR2720016")).toHaveTextContent(
        "Tarief: €517.20 → €600.00",
      );
    });
  });

  /**
   * A line whose transport was found by date and booking because the invoice
   * misprinted its container. The backend decides it; the screen says it in one
   * short line beside the container and nowhere else.
   */
  describe("a line whose container was corrected", () => {
    function withCorrectedLine() {
      return result({
        summary: { ...result().summary, containerCorrected: 1 },
        rows: [
          {
            ...result().rows[0],
            rowNumber: 7,
            bookingNumber: "ANRBEL2808541",
            containerNumber: "EUCU 9999999",
            normalizedContainerNumber: "EUCU9999999",
            trip: {
              id: "3f1b0d2e-0000-4000-8000-000000000007",
              status: "CLOSED",
              planningDate: "2026-09-28",
              bookingNumber: "ANRBEL2808541",
              containerNumber: "EUCU4591789",
            },
            containerCorrection: {
              invoiceContainerNumber: "EUCU 9999999",
              tripContainerNumber: "EUCU4591789",
            },
          },
          { ...result().rows[0] },
        ],
      });
    }

    /** K — compact, visible, and inline with the line it is about. */
    it("says so in one short line beside the container", async () => {
      requestMock.mockResolvedValue(withCorrectedLine());

      await check();

      const row = rowFor("ANRBEL2808541");
      const note = within(row).getByText(/Container gecorrigeerd/);

      expect(note).toHaveTextContent("⚠Container gecorrigeerd → EUCU4591789");
      // What the invoice printed is still shown, so the change is visible.
      expect(row).toHaveTextContent("EUCU 9999999");
    });

    it("explains the correction in full on hover", async () => {
      requestMock.mockResolvedValue(withCorrectedLine());

      await check();

      const note = within(rowFor("ANRBEL2808541")).getByText(/Container gecorrigeerd/);

      expect(note.closest("[title]")).toHaveAttribute(
        "title",
        expect.stringContaining("EUCU 9999999 → EUCU4591789"),
      );
    });

    /** Found and settled like any matched line: not a problem row. */
    it("is a matched line, not a problem line", async () => {
      requestMock.mockResolvedValue(withCorrectedLine());

      await check();

      const row = rowFor("ANRBEL2808541");

      expect(within(row).getByText("Gematcht")).toBeInTheDocument();
      expect(row.className).not.toContain("bg-[#fdfd66]");
    });

    /** L — an ordinary matched line carries no such note. */
    it("shows nothing on a line whose container was right", async () => {
      requestMock.mockResolvedValue(withCorrectedLine());

      await check();

      expect(
        within(rowFor("DUBANR2718284")).queryByText(/Container gecorrigeerd/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the workbook is refused", () => {
    it("shows the backend's own reason", async () => {
      requestMock.mockRejectedValue(
        new ApiError(
          "BAD_REQUEST",
          "De factuur heeft niet de verwachte opbouw; er is niets gecontroleerd.",
          400,
          ["ontbrekende kolom: Tol B"],
        ),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/niet de verwachte opbouw/);
      // And no half-rendered result beside it.
      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
    });

    it("refuses a file that is not an .xlsx before sending it", async () => {
      renderPage();

      await upload(
        new File(["%PDF"], "order.pdf", { type: "application/pdf" }),
        {
          applyAccept: false,
        },
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Alleen .xlsx-bestanden",
      );
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe("choosing another file", () => {
    it("drops the previous answer, which is about another document", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      await upload(workbook("week 14 - 2026 GLT.xlsx"));

      expect(screen.queryByText("DUBANR2718284")).not.toBeInTheDocument();
      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
    });
  });
});
