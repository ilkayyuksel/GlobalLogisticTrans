import type { Trip } from "@prisma/client";

import type {
  InvoiceAuditReadRepository,
  InvoiceCostConfirmation,
} from "../invoice-audit-read.repository";

/**
 * The invoice check's own reads, doubled: by default the database holds no
 * other Trip on the invoice's days, no confirmation and no group.
 */
export interface InvoiceReadsDouble {
  findTripsOnDates: jest.Mock<Promise<Trip[]>, [readonly Date[]]>;
  findTripsByIds: jest.Mock<Promise<Trip[]>, [readonly string[]]>;
  findCostConfirmationsByNumbers: jest.Mock<
    Promise<InvoiceCostConfirmation[]>,
    [readonly string[]]
  >;
  countGroupMembers: jest.Mock<Promise<Map<string, number>>, [readonly string[]]>;
  findCustomPropertyNames: jest.Mock<Promise<Map<string, string[]>>, [readonly string[]]>;
  findCostConfirmationNumbers: jest.Mock<Promise<Map<string, string[]>>, [readonly string[]]>;
}

export function invoiceReads(): InvoiceReadsDouble {
  return {
    findTripsOnDates: jest.fn(async (_days: readonly Date[]) => [] as Trip[]),
    findTripsByIds: jest.fn(async (_ids: readonly string[]) => [] as Trip[]),
    findCostConfirmationsByNumbers: jest.fn(
      async (_numbers: readonly string[]) => [] as InvoiceCostConfirmation[],
    ),
    countGroupMembers: jest.fn(
      async (_groupIds: readonly string[]) => new Map<string, number>(),
    ),
    findCustomPropertyNames: jest.fn(
      async (_tripIds: readonly string[]) => new Map<string, string[]>(),
    ),
    findCostConfirmationNumbers: jest.fn(
      async (_tripIds: readonly string[]) => new Map<string, string[]>(),
    ),
  };
}

export function asReads(double: InvoiceReadsDouble): InvoiceAuditReadRepository {
  return double as unknown as InvoiceAuditReadRepository;
}
