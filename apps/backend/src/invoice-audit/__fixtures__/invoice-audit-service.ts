import type { AppLoggerService } from "../../logger/app-logger.service";
import type { EffectivePricingService } from "../../trip-pricing/effective-pricing.service";
import type { TripRepository } from "../../trips/trip.repository";
import { InvoiceAuditService } from "../invoice-audit.service";
import { InvoiceExaminationService } from "../invoice-examination.service";
import { InvoiceRowMatchingService } from "../matching/invoice-row-matching.service";
import { AddedRowsService } from "../missing/added-rows.service";
import { MissingTripsService } from "../missing/missing-trips.service";
import type { InvoicePaymentRepository } from "../payment/invoice-payment.repository";
import { InvoicePaymentService } from "../payment/invoice-payment.service";
import type { InvoiceFuelRateReader } from "../pricing/invoice-fuel-rate.reader";
import { InvoicePricingService } from "../pricing/invoice-pricing.service";
import { ManualRouteFactsReader } from "../pricing/manual-route-facts.reader";
import type { InvoiceRemarksService } from "../remarks/invoice-remarks.service";
import { InvoiceSheetReader } from "../workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "../workbook/invoice-sheet.writer";
import { InvoiceWorkbookVerifier } from "../workbook/invoice-workbook-verifier";
import { NO_FUEL_RATES } from "./invoice-pricing";
import { asReads, invoiceReads, type InvoiceReadsDouble } from "./invoice-reads";
import { noRemarks } from "./invoice-remarks";

/** The doubles a suite controls; everything else is the real collaborator. */
export interface InvoiceAuditServiceDoubles {
  readonly trips: unknown;
  readonly effectivePricing: unknown;
  readonly logger: AppLoggerService;
  /** The invoice check's own reads; none known unless a suite says so. */
  readonly reads?: InvoiceReadsDouble;
  /** Remarks facts; by default the ones `reads` holds, and no TAR charge. */
  readonly remarks?: InvoiceRemarksService;
  readonly fuelRates?: InvoiceFuelRateReader;
  readonly writer?: InvoiceSheetWriter;
}

/** The whole examination over the given doubles, wired as the module wires it. */
export function buildInvoiceExamination(
  doubles: InvoiceAuditServiceDoubles,
): InvoiceExaminationService {
  const { logger } = doubles;
  const trips = doubles.trips as TripRepository;
  const effectivePricing = doubles.effectivePricing as EffectivePricingService;
  const reads = doubles.reads ?? invoiceReads();
  const remarks = doubles.remarks ?? noRemarks(reads);
  const manualRoutes = new ManualRouteFactsReader(asReads(reads), effectivePricing);

  return new InvoiceExaminationService(
    new InvoiceSheetReader(logger),
    new InvoiceRowMatchingService(trips, asReads(reads), logger),
    new InvoicePricingService(effectivePricing, doubles.fuelRates ?? NO_FUEL_RATES, manualRoutes, logger),
    remarks,
    new MissingTripsService(trips, effectivePricing, logger),
    new AddedRowsService(asReads(reads), remarks, manualRoutes, doubles.fuelRates ?? NO_FUEL_RATES, logger),
    logger,
  );
}

/** The check and the corrected file over the given doubles. */
export function buildInvoiceAuditService(doubles: InvoiceAuditServiceDoubles): InvoiceAuditService {
  return new InvoiceAuditService(
    buildInvoiceExamination(doubles),
    doubles.writer ?? new InvoiceSheetWriter(doubles.logger),
    new InvoiceWorkbookVerifier(new InvoiceSheetReader(doubles.logger), doubles.logger),
    doubles.logger,
  );
}

/** A payment repository that settles every id it is given, unless told otherwise. */
export function paymentRepository(): { settle: jest.Mock<Promise<number>, [readonly string[]]> } {
  return { settle: jest.fn(async (tripIds: readonly string[]) => tripIds.length) };
}

/** The payment confirmation over the given doubles. */
export function buildInvoicePaymentService(
  doubles: InvoiceAuditServiceDoubles,
  payments: ReturnType<typeof paymentRepository>,
): InvoicePaymentService {
  return new InvoicePaymentService(
    buildInvoiceAuditService(doubles),
    payments as unknown as InvoicePaymentRepository,
    doubles.logger,
  );
}
