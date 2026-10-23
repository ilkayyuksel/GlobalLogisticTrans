import ExcelJS from "exceljs";
import { Prisma, RouteMatchMethod, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { EXACT_ROUTE_MATCH } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import type { InvoiceAuditResultDto } from "./dto/invoice-audit.dto";

/**
 * Every message the check shows an operator is Dutch.
 *
 * One week that provokes as many kinds of message as one document can — an
 * unknown EC, an amount that is not an amount, a Combination the system cannot
 * confirm, a route the system did not find, a waiting time nobody can write,
 * totals that would leave a line out — and then every text the result carries
 * is held against the English the check used to speak.
 */

const MONDAY = new Date(Date.UTC(2026, 9, 5));
/** Words the English messages used and Dutch ones never do ("is" and "was" are both). */
const ENGLISH =
  /\b(the|not|row|rows|Trip|Trips|Combination|Cost Confirmation|known|found|stated|cannot|uses|yet|which|does|would|could|has|line)\b/;

function priced(tarief: string, method: RouteMatchMethod = RouteMatchMethod.EXACT): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  return {
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: zero,
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(tarief),
    routeMatch: { ...EXACT_ROUTE_MATCH, method },
  };
}

function trip(id: string, bookingNumber: string, containerNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
    bookingNumber,
    containerNumber,
    terminal: "Quay 869",
    destinationCity: "Zemst",
    direction: "DELIVERY",
    tripGroupId: null,
    ...overrides,
  };
}

/** Every text in the result an operator can read. */
function visibleTexts(result: InvoiceAuditResultDto): string[] {
  return [
    ...result.rows.flatMap((row) => [
      row.matchProblem,
      row.priceReliability?.explanation ?? null,
      row.combination?.reason ?? null,
      ...row.differences.map((difference) => difference.problem),
      ...(row.remarks?.notes ?? []),
    ]),
    ...result.missingTrips.flatMap((missing) => [missing.priceReliability.explanation, ...missing.remarkNotes]),
    ...result.totalsStructure.problems,
  ].filter((text): text is string => text !== null);
}

describe("the messages of the invoice check", () => {
  it("are all Dutch", async () => {
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
    const reads = invoiceReads();
    // A waiting time with no window at all: only a duration, which no Remarks part can state.
    const durationOnly = { waitingTimeStart: null, waitingTimeEnd: null, waitingTimeEndsNextDay: false, waitingTimeMinutes: 90 };

    reads.countGroupMembers.mockResolvedValue(new Map([["g", 2]]));

    const service = buildInvoiceAuditService({
      logger,
      reads,
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue([
          trip("unreadable", "ANRDUB2810001", "EUCU4540001"),
          trip("not-found", "ANRDUB2810002", "EUCU4540002"),
          trip("leg-a", "ANRDUB2810003", "EUCU4540003", { tripGroupId: "g" }),
          trip("leg-b", "ANRDUB2810004", "EUCU4540004"),
        ]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([trip("missing", "ANRDUB2810009", "EUCU4540009", durationOnly)]),
      },
      effectivePricing: {
        findForTrips: jest.fn(async (ids: readonly string[]) =>
          new Map(
            ids.map((id) => [id, id === "not-found" ? priced("0", RouteMatchMethod.NOT_FOUND) : priced("150")]),
          ),
        ),
      },
    });
    const line = (bookingNumber: string, containerNumber: string, extra = {}) => ({
      planningDate: MONDAY,
      bookingNumber,
      containerNumber,
      tarief: 135,
      ...extra,
    });
    const received = await withEdit(
      await buildInvoiceWorkbook({
        lines: [
          line("ANRDUB2810001", "EUCU 4540001"),
          line("ANRDUB2810002", "EUCU 4540002"),
          line("ANRDUB2810003", "EUCU 4540003", { endPoint: "COMBINATION " }),
          line("ANRDUB2810004", "EUCU 4540004", { startPoint: "COMBINATION " }),
          line("ANRDUB2810003", "", {
            tarief: null,
            ek: 110,
            remarks: "EC 4224479",
            containerType: null,
            startPoint: null,
            endPoint: null,
          }),
        ],
      }),
      (sheet) => {
        sheet.getCell("L2").value = "n.v.t.";
        // A total that stops short: the structure check speaks too.
        sheet.getCell("N7").value = { formula: "SUM(N2:N3)", result: 0 };
      },
    );

    const result = await service.check({ buffer: received, originalname: "week 41 - 2026 GLT.xlsx", size: received.length });
    const texts = visibleTexts(result);

    // The week provoked every kind it was built for.
    expect(texts).toEqual(
      expect.arrayContaining([
        "Geen kostenbevestiging gevonden voor EC 4224479. Ook de rit zelf is niet gevonden.",
        "Tarief op rij 2 is geen leesbaar bedrag.",
        "Voor de rit is geen route gevonden.",
        "Het eerste deel van deze combinatie is niet gevonden.",
        "De rit hoort bij een groep, maar de opgeslagen prijs vermeldt geen combinatie.",
        "De wachttijd heeft geen venster binnen één dag en wordt daarom niet geschreven.",
        expect.stringContaining("Backload: het totaal telt de rijen 2–3 op"),
      ]),
    );
    expect(texts.filter((text) => ENGLISH.test(text))).toEqual([]);
  });
});

/** The received document, as the customer might have changed it by hand. */
async function withEdit(file: Buffer, edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();

  await book.xlsx.load(file as unknown as ArrayBuffer);
  edit(book.worksheets[0]);

  return Buffer.from(await book.xlsx.writeBuffer());
}
