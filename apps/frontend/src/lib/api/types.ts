/**
 * The backend's response contract, mirrored.
 *
 * Every money value is a STRING here, exactly as the backend sends it. That is
 * deliberate and must stay that way: the backend formats each amount to two
 * decimals from a database NUMERIC, and parsing those into JavaScript numbers
 * would introduce binary floating-point error into figures a customer is
 * invoiced for. The frontend displays these strings; it never adds them.
 *
 * Dates arrive as ISO strings over JSON even where the backend types them as
 * Date, so they are typed as strings here — which is what they actually are by
 * the time this code sees them.
 */

export interface ApiResponseBase {
  statusCode: number;
  timestamp: string;
  path: string;
}

export interface ApiSuccessResponse<TData> extends ApiResponseBase {
  success: true;
  data: TData;
}

export interface ApiErrorDetail {
  /** Stable, machine-readable identifier, e.g. "NOT_FOUND". */
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse extends ApiResponseBase {
  success: false;
  error: ApiErrorDetail;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Paginated<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

/** Exactly the values in the database enum — no more. */
export type TripStatus = "OPEN" | "CLOSED" | "CANCELLED" | "DELETED";

/**
 * The statuses the status endpoint accepts.
 *
 * DELETED is absent deliberately: soft delete and restore are separate
 * operations with their own preconditions, and the model insists a business
 * cancellation and an administrative deletion never be confused.
 */
export type ChangeableTripStatus = "OPEN" | "CLOSED" | "CANCELLED";

/**
 * The Vehicle of a Trip, as the Trip response carries it.
 *
 * Embedded by the backend so a planning view can render a whole day from one
 * request. `displayColor` is the Vehicle's own colour, which is what lets one
 * truck stay visually identifiable across a board.
 */
export interface TripVehicleSummary {
  id: string;
  licensePlate: string;
  displayColor: string;
  /** False when the Vehicle was deactivated after this Trip was planned. */
  isActive: boolean;
}

/** How the backend arrived at a Trip's driver. */
export type EffectiveDriverSource = "OVERRIDE" | "VEHICLE_ASSIGNMENT";

/**
 * The driver actually responsible for a Trip.
 *
 * RESOLVED BY THE BACKEND, using the Trip's own planning date. The frontend
 * must never recompute this: `driverId` is only an override, and working out
 * the rest would mean running vehicle-assignment validity rules in the browser.
 */
export interface EffectiveDriver {
  id: string;
  name: string;
  /** False when the Driver was deactivated after this Trip was planned. */
  isActive: boolean;
  source: EffectiveDriverSource;
}

/**
 * A group and the Trips in it.
 *
 * The same shape whether the group came from a Combination PDF or was made by
 * hand — the backend keeps one kind of group, and the difference is in how it
 * came to be rather than in what it is.
 */
export interface TripGroup {
  id: string;
  tripCount: number;
  trips: Trip[];
}

/** A Custom Property as it appears on a Trip that carries it. */
export interface TripCustomPropertySummary {
  /** The CustomProperty's own id, not the assignment's. */
  id: string;
  name: string;
  /** False when the property was deactivated after it was assigned. */
  isActive: boolean;
}

/**
 * Which half of a transport a Trip is, as the transport order stated it.
 *
 * COLLECTION fetches a container, DELIVERY brings one. Null on a Trip created
 * by hand — no document said which — and on Trips imported before this was
 * recorded. It is never inferred from a date, a row order or a terminal name.
 */
export type TripDirection = "COLLECTION" | "DELIVERY";

export interface Trip {
  id: string;
  /** Null on a Trip created by hand: there is no source document. */
  pdfDocumentId: string | null;
  /** Non-null means this Trip is one leg of a Combination. */
  tripGroupId: string | null;
  vehicleId: string | null;
  /** Driver OVERRIDE only. Null does not mean "no driver" — see effectiveDriver. */
  driverId: string | null;
  /** The assigned Vehicle, or null when none is assigned. */
  vehicle: TripVehicleSummary | null;
  /** Who is driving. Null means nobody is — not "unknown". */
  effectiveDriver: EffectiveDriver | null;
  /**
   * The Custom Properties assigned to this Trip, in the operator's own display
   * order. Empty means none are assigned.
   */
  customProperties: TripCustomPropertySummary[];
  status: TripStatus;
  /** What the document said this Trip is. Null when nothing said. */
  direction: TripDirection | null;
  /** Null on a manual Trip whose booking number is not known yet. */
  bookingNumber: string | null;
  containerNumber: string | null;
  containerType: string | null;
  terminal: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  /** `YYYY-MM-DD`. Null on a Trip that was never imported. */
  originalPlanningDate: string | null;
  /** `YYYY-MM-DD`. Null when the Trip has not been scheduled yet. */
  planningDate: string | null;
  /** `HH:MM:SS`, or null when the document stated no time. */
  startTime: string | null;
  endTime: string | null;
  executionDatetime: string | null;
  waitingTimeMinutes: number | null;
  /** Kilometres, two decimals, as a string. */
  distanceKm: string | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PricingCalculationStatus =
  | "CALCULATED"
  | "MANUAL_OVERRIDE"
  | "FAILED";

export interface TripPricing {
  id: string;
  tripId: string;
  /** Two decimals, as a string. Never re-derived on this side. */
  totalPrice: string;
  currency: string;
  calculatedAt: string;
  pricingEngineVersion: string;
  pricingRuleVersion: string;
  calculationStatus: PricingCalculationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripPricingItem {
  id: string;
  tripPricingId: string;
  pricingComponentId: string;
  /**
   * What this line MEANS — BASE_PRICE, TOLL, WAITING_TIME. The component id is
   * a UUID and says nothing on its own, and there is no catalog endpoint to
   * resolve it against, so the backend puts the code on the line.
   */
  pricingComponentCode: string;
  customPropertyId: string | null;
  description: string;
  /** Two decimals, as a string. May be negative. */
  amount: string;
  currency: string;
  /** Position in the calculation sequence; the order lines must be shown in. */
  calculationOrder: number;
  quantity: string | null;
  unitPrice: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the reprocess endpoint returns, and what the detail page displays. */
export interface PricingSnapshot {
  pricing: TripPricing;
  items: TripPricingItem[];
}

export interface CustomProperty {
  id: string;
  name: string;
  description: string | null;
  /** The pricing component this property is priced through, when linked. */
  pricingComponentId: string | null;
  /** Two decimals, as a string. Null when no price is configured. */
  defaultPrice: string | null;
  isActive: boolean;
}

export interface TripCustomProperty {
  id: string;
  tripId: string;
  customPropertyId: string;
  customProperty: CustomProperty;
  assignedAt: string;
}

export interface Vehicle {
  id: string;
  licensePlate: string;
  displayColor: string;
  description: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  notes: string | null;
  isActive: boolean;
}

/**
 * A standing arrangement: this Driver drives this Vehicle from a date, possibly
 * until another one.
 *
 * The backend decides which assignment is in effect on a given day — the same
 * rule that produces a Trip's effective driver — so nothing on this side
 * compares dates to work out who is driving.
 */
export interface VehicleAssignment {
  id: string;
  vehicleId: string;
  driverId: string;
  validFrom: string;
  validTo: string | null;
  isOpenEnded: boolean;
  notes: string | null;
}

export interface Driver {
  id: string;
  name: string;
  licenceNumber: string | null;
  phoneNumber: string | null;
  email: string | null;
  /** Who to call about this driver. Free text; never parsed. */
  emergencyContact: string | null;
  notes: string | null;
  isActive: boolean;
}

/**
 * Where an imported email got to.
 *
 * RECEIVED / PROCESSING mean work is outstanding. PROCESSED means Trips exist.
 * FAILED means the next scan will try again. IGNORED means it was set aside on
 * purpose — an untrusted sender, an UPDATE or CANCEL this version does not
 * carry out, or an order whose Trips already exist.
 */
export type ImportedEmailStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "IGNORED";

/** What the subject asked for. Only NEW is carried out by this version. */
export type ImportType = "NEW" | "UPDATE" | "CANCEL";

/**
 * One email the mailbox scan has seen.
 *
 * The message body is deliberately absent from this contract: the backend never
 * sends it, because it may carry customer correspondence.
 */
export interface ImportedEmail {
  id: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  /** Null while pending, and null for a failure — nothing was processed. */
  processedAt: string | null;
  processingStatus: ImportedEmailStatus;
  importType: ImportType;
  /** The stored PDF this email produced, when it produced one. */
  pdfDocumentId: string | null;
}
