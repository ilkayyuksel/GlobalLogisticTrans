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
  /**
   * Whether a phone number is recorded, NOT the number itself.
   *
   * It exists so the Ritten list can explain a disabled WhatsApp button —
   * "geen telefoonnummer voor deze chauffeur" reads very differently from
   * "geen chauffeur gekoppeld". The number stays on the Driver screen, where
   * somebody asked to see it.
   */
  hasPhoneNumber: boolean;
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

/**
 * What the most recent applied UPDATE document did to a Trip.
 *
 * Derived by the backend from the audit trail, never stored as a status: the
 * lifecycle is OPEN, CLOSED and CANCELLED, and "was updated" is a fact about
 * documents rather than a state a Trip can transition to.
 *
 * `changedFields` is EMPTY when an update arrived and moved nothing — a
 * different thing from no update at all, which is `latestUpdate: null`.
 */
export interface LatestTripUpdate {
  occurredAt: string;
  changedFields: string[];
  /** The UPDATE document itself, for viewing or downloading. */
  pdfDocumentId: string | null;
}

/**
 * The cost Eucon has confirmed for a Trip. At most one per Trip.
 *
 * READ-ONLY, everywhere and always. It is a statement by somebody else: there
 * is no endpoint to create, edit or delete one, and the interface must offer no
 * control that suggests otherwise.
 *
 * It is NOT the waiting time. `waitingTimeMinutes` is what an operator entered
 * and what the Pricing Engine prices; this is the money Eucon will pay for it.
 * Both belong to the same Trip and neither replaces the other.
 */
export interface CostConfirmation {
  id: string;
  /** Digits only. Shown as CC4139505 — the prefix is presentation. */
  ccNumber: string;
  /** `WAIT` for waiting time. */
  costCode: string;
  /** Two decimals, as a string. Never a number: money is never a float. */
  amount: string;
  currency: string;
  receivedAt: string;
  /** The confirmation document, for viewing or download. */
  pdfDocumentId: string;
}

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
  latestUpdate: LatestTripUpdate | null;
  /**
   * The cost Eucon confirmed, or null.
   *
   * A Trip has at most ONE: Eucon confirms its waiting time once, and the
   * database enforces it. Null means nothing has been confirmed — which is not
   * the same as an amount of zero.
   */
  costConfirmation: CostConfirmation | null;
  /**
   * What this Trip is worth, or null when it has never been priced.
   *
   * It TRAVELS ON THE TRIP. The list endpoint resolves it for the whole page in
   * one batched read, so showing prices costs no request of its own and a page
   * of 200 costs what a page of 1 costs. Nothing on this side may recompute any
   * of these amounts — the backend is the only place a price is decided.
   *
   * Null means "never priced", never "priced at zero" and never "nobody
   * looked": every Trip response resolves it.
   */
  pricing: EffectivePricing | null;
  /**
   * Why `pricing` is null after a write that RECALCULATED this Trip.
   *
   * A stable backend code — PRICING_MISSING_ROUTE_PRICING and the like. Always
   * null on a read: a Trip that has simply never been priced is not a failure,
   * and nothing was attempted to report on.
   *
   * It is what separates the two nulls. "Never priced" leaves a row as it is;
   * "recalculated and it could not be priced" BLANKS it, because the amounts on
   * screen describe the Trip before the change, and showing them as current
   * would be a stale figure nothing on the page reveals.
   */
  reasonCode: string | null;
  /**
   * Where this Trip starts and where it ends, as the backend derives it.
   *
   * AUTHORITATIVE. Nothing on this side builds a route: the order of the two
   * ends follows the Trip's direction — TERMINAL to CITY on a delivery, CITY to
   * TERMINAL on a collection — and the terminal is already canonical, with the
   * PSA prefix removed. A route assembled in a component would eventually
   * disagree with the export and with pricing about which end is which.
   *
   * Structured rather than a formatted string so a reader can ask for the
   * origin or the destination without parsing an arrow. Null when the Trip has
   * neither a terminal nor a destination city.
   */
  route: TripRoute | null;
  /**
   * The Custom Properties assigned to this Trip, in the operator's own display
   * order. Empty means none are assigned.
   */
  customProperties: TripCustomPropertySummary[];
  status: TripStatus;
  /**
   * LOSRIT: a loose trip, as the operator classified it.
   *
   * INDEPENDENT of `status` — a LOSRIT is OPEN, CLOSED or CANCELLED like any
   * other Trip — and informational only. It changes no action, no pricing and
   * no document handling; it is shown, and that is all.
   */
  isLooseTrip: boolean;
  /**
   * BETAALD when true, NIET BETAALD when false.
   *
   * INDEPENDENT of `status`: a Trip is paid or unpaid whether it is OPEN,
   * CLOSED or CANCELLED. It travels on the Trip like every other field, so
   * showing it costs no request of its own.
   */
  isPaid: boolean;
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
  /**
   * The two clock times the waiting was read off, and the duration between
   * them.
   *
   * The DURATION is what pricing bills from. The two times say where it came
   * from, and are NULL on every Trip whose waiting time was entered before they
   * were recorded — such a Trip shows its duration alone, because 135 minutes
   * has unlimited begin/end pairs and inventing one would put hours on screen
   * that nobody ever read off a clock.
   *
   * NOT startTime/endTime, which are the transport's own planned window.
   */
  waitingTimeStart: string | null;
  waitingTimeEnd: string | null;
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

/**
 * The canonical route of a Trip, derived by the backend from its direction,
 * terminal and destination city.
 */
export interface TripRoute {
  from: string;
  to: string;
}

/** Where an effective amount came from. */
export type PricingAmountSource = "ENGINE" | "OVERRIDE";

/**
 * One component of a price, with the correction that may sit on top of it.
 *
 * `engineAmount` is what the Pricing Engine calculated, or null when it
 * produced no line for this component. `effectiveAmount` is the one that
 * counts. Keeping both is what lets a screen mark an amount as manually
 * corrected and offer to withdraw the correction.
 */
export interface EffectivePricingComponent {
  componentCode: string;
  engineAmount: string | null;
  effectiveAmount: string;
  source: PricingAmountSource;
}

/**
 * What a Trip is worth, as the Ritten columns read it.
 *
 * Every amount is a preformatted two-decimal string and is displayed exactly as
 * received. `totaal` is the backend's own sum, never one added up here: a total
 * computed in the browser would be a second opinion about money, and the two
 * would eventually disagree.
 *
 * The three overridable components — BASE_PRICE, TOLL, TUNNEL — are found in
 * `components`, which is where a cell learns whether the figure it is showing
 * was typed by an operator.
 */
export interface EffectivePricing {
  tarief: string;
  brandstof: string;
  backload: string;
  tol: string;
  tunnel: string;
  others: string;
  ek: string;
  totaal: string;
  components: EffectivePricingComponent[];
}

/** What the reprocess endpoint returns, and what the detail page displays. */
export interface PricingSnapshot {
  pricing: TripPricing;
  items: TripPricingItem[];
}

/** What a document did to a Trip, as its history lists it. */
export type TripDocumentAction =
  | "NEW"
  | "UPDATE"
  | "CANCEL"
  | "COST_CONFIRMATION";

export interface TripDocument {
  pdfDocumentId: string;
  action: TripDocumentAction;
  originalFilename: string;
  occurredAt: string;
  /** The fields this document moved. Empty for NEW and CANCEL. */
  changedFields: string[];
  /** Why it did what it did, in one sentence. Null for the original order. */
  outcome: string | null;
  /** False when the document arrived but changed nothing on this Trip. */
  applied: boolean;
  /**
   * True when this document CREATED the Trip.
   *
   * An UPDATE for a booking nobody held creates one, and that is a different
   * fact from an update applied to a Trip that already existed — which is why
   * such a Trip is never marked "Bijgewerkt".
   */
  createdTrip: boolean;
  /**
   * When the email carrying this document was received. Null for one uploaded
   * by hand, which has no email — `occurredAt` is then the upload time.
   */
  receivedAt: string | null;
  /**
   * True for the one document that currently governs the Trip.
   *
   * The backend decides it, from the order the documents ARRIVED rather than
   * the order they were processed in. Nothing here compares timestamps.
   */
  isEffective: boolean;
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
  /**
   * True when the SYSTEM decides this property rather than an operator — Toll
   * and Tunnel from the route, TAR from the Pricing Engine, Flat from the
   * container type.
   *
   * The backend classifies it and also refuses such an assignment, so this is
   * only what the picker reads to avoid offering a choice that does not exist.
   * No rule is duplicated here.
   */
  isSystemManaged: boolean;
}

export interface TripCustomProperty {
  id: string;
  tripId: string;
  customPropertyId: string;
  customProperty: CustomProperty;
  assignedAt: string;
  /**
   * True when a backend rule assigned this property rather than a person.
   *
   * Read-only. An assignment made from the application is always manual.
   */
  isAutomatic: boolean;
  /**
   * True when the Trip's container type requires this property, in which case
   * the backend refuses to unassign it.
   *
   * The backend decides this — it depends on the container type, and working it
   * out here would put the same business rule in two places. The UI only
   * renders the answer.
   */
  isRequired: boolean;
}

/**
 * What assigning or removing a Custom Property answers with.
 *
 * The assignment, PLUS what the Trip is now worth. A priced property moves
 * Others and Others moves Totaal, so the backend recalculates before it
 * answers and the row updates from this response — no second request for the
 * prices of a row already in hand, and no list refetch that would move every
 * other row while an operator works through them.
 *
 * `pricing` is null when the Trip could not be priced, and `reasonCode` says
 * why. The assignment itself still happened: a Trip whose route is not
 * configured is an ordinary state, not a reason to refuse an operator's edit.
 * The previous figures are never returned.
 */
export interface TripCustomPropertyMutation extends TripCustomProperty {
  pricing: EffectivePricing | null;
  reasonCode: string | null;
}

/**
 * The Driver a Vehicle is assigned to TODAY, or the Vehicle a Driver is on.
 *
 * Resolved by the backend from VehicleAssignment — the single source of truth
 * for this relationship. There is no `driverId` on a Vehicle and no
 * `vehicleId` on a Driver, and this is not derived from any Trip: a Trip says
 * who drove on a DAY, which is a different question from who is assigned now.
 *
 * Two or three fields, deliberately. A fleet list needs a name and a way to
 * link; it has no use for a phone number, and putting one in every row would
 * spread contact details far beyond the screen that asks for them.
 */
export interface CurrentDriver {
  id: string;
  name: string;
  /** False when the Driver was deactivated while still assigned. */
  isActive: boolean;
}

export interface CurrentVehicle {
  id: string;
  licensePlate: string;
  displayColor: string;
  isActive: boolean;
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
  /** Today's driver, from VehicleAssignment. Null when nobody is assigned. */
  currentDriver: CurrentDriver | null;
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
  /** Today's vehicle, from VehicleAssignment. Null when they have none. */
  currentVehicle: CurrentVehicle | null;
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
