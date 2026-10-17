import { ApiProperty } from "@nestjs/swagger";
import { Transform, type TransformFnParams } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from "class-validator";

import { toIsoDate } from "../../common/dates";
import { rawValueOf } from "../../common/dto/transforms";
import {
  NotPayableReason,
  PaymentCategory,
  type TripPayment,
} from "../payment/payment-eligibility";

/** More than any week has lines; a selection beyond it is not a selection. */
const MAX_SELECTED_TRIPS = 500;

/** One transport the invoice charges, and whether the confirmation may settle it. */
export class InvoiceTripPaymentDto {
  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({ type: String, nullable: true, format: "date" })
  planningDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bookingNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  containerNumber!: string | null;

  @ApiProperty({ type: [Number], description: "Every line of the document charging it." })
  rowNumbers!: number[];

  @ApiProperty()
  payable!: boolean;

  @ApiProperty({
    enum: PaymentCategory,
    nullable: true,
    description:
      "UNCHANGED, RAISED, or INVOICE_HIGHER — payable, but shown apart. Null when not payable.",
  })
  category!: PaymentCategory | null;

  @ApiProperty({ enum: NotPayableReason, isArray: true })
  reasons!: NotPayableReason[];

  @ApiProperty({ description: "Already paid: re-invoiced, and never paid a second time." })
  alreadyPaid!: boolean;
}

/** The transports an operator confirms, chosen from the payable ones of a check. */
export class ConfirmInvoicePaymentDto {
  @ApiProperty({
    type: String,
    description:
      'A JSON array of Trip ids, sent as a form field beside the file: `["9c0f…", "…"]`.',
  })
  // A multipart form carries text; the array travels as JSON and is parsed here.
  @Transform(parseJsonArray)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SELECTED_TRIPS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  tripIds!: string[];
}

/** What the confirmation did. */
export class InvoicePaymentResultDto {
  @ApiProperty({ example: 94, description: "Trips marked paid by this confirmation." })
  paidTrips!: number;

  @ApiProperty({ example: 2, description: "Selected Trips that were already paid; left as they were." })
  alreadyPaid!: number;

  @ApiProperty({ type: [String], format: "uuid" })
  paidTripIds!: string[];
}

export function toTripPaymentDto(payment: TripPayment): InvoiceTripPaymentDto {
  return {
    tripId: payment.trip.id,
    planningDate: payment.trip.planningDate ? toIsoDate(payment.trip.planningDate) : null,
    bookingNumber: payment.trip.bookingNumber,
    containerNumber: payment.trip.containerNumber,
    rowNumbers: [...payment.rowNumbers],
    payable: payment.payable,
    category: payment.category,
    reasons: [...payment.reasons],
    alreadyPaid: payment.alreadyPaid,
  };
}

/** The form field as an array; anything unparseable passes on to be refused. */
function parseJsonArray(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Not JSON: left as the string it is, which `@IsArray` refuses by name.
    return value;
  }
}
