import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Prisma, TripPricingItem } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";


/**
 * Public shape of one line of a pricing breakdown.
 *
 * `amount`, `quantity` and `unitPrice` are serialised as fixed-precision
 * strings, not JSON numbers. The columns are NUMERIC(12,2); rendering them as
 * floats would reintroduce the binary rounding the decimal type exists to
 * avoid. That matters especially here: these lines must add up to the parent's
 * `total_price` exactly, and they are exported to Excel and invoiced.
 */
export class TripPricingItemResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid", description: "The snapshot this line belongs to." })
  tripPricingId!: string;

  @ApiProperty({
    format: "uuid",
    description: "The component that classifies this line.",
  })
  pricingComponentId!: string;

  @ApiProperty({
    example: "FUEL_SURCHARGE",
    description:
      "The component's stable code — what this line MEANS. Present so a client can tell a base price from a toll without resolving the component id against a catalog it has no endpoint for.",
  })
  pricingComponentCode!: string;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Reference Entity: the Custom Property that produced this line, when one did.",
  })
  customPropertyId!: string | null;

  @ApiProperty({ example: "Fuel surcharge" })
  description!: string;

  @ApiProperty({
    description: "Calculated amount, always with two decimals. May be negative.",
    type: String,
    example: "57.25",
  })
  amount!: string;

  @ApiProperty({ example: "EUR" })
  currency!: string;

  @ApiProperty({
    description: "Position in the calculation sequence.",
    example: 3,
  })
  calculationOrder!: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: "3.00" })
  quantity!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "19.50" })
  unitPrice!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/**
 * The complete breakdown of one snapshot.
 *
 * Deliberately not paginated: a breakdown is only correct when it is whole. A
 * partial page would let a caller render a total that does not match its lines,
 * and pricing_rules.md requires the exported breakdown to match the stored
 * pricing exactly. The set is bounded by the seeded component catalog plus the
 * Trip's own custom properties and manual adjustments.
 */
export class TripPricingBreakdownDto {
  @ApiProperty({
    type: [TripPricingItemResponseDto],
    description: "Every line of the snapshot, in calculation order.",
  })
  items!: TripPricingItemResponseDto[];
}

/**
 * A line together with the component that classifies it.
 *
 * The relation is loaded by the repository rather than looked up per line: a
 * breakdown has a handful of lines, and one join costs less than one query
 * each.
 */
export type TripPricingItemWithComponent = TripPricingItem & {
  pricingComponent: { code: string };
};

/** Explicit null check, not truthiness: an amount of exactly 0 is a value. */
function toFixedOrNull(
  value: Prisma.Decimal | null,
  decimalPlaces: number,
): string | null {
  return value === null ? null : value.toFixed(decimalPlaces);
}

export function toTripPricingItemResponse(
  item: TripPricingItemWithComponent,
): TripPricingItemResponseDto {
  return {
    id: item.id,
    tripPricingId: item.tripPricingId,
    pricingComponentId: item.pricingComponentId,
    pricingComponentCode: item.pricingComponent.code,
    customPropertyId: item.customPropertyId,
    description: item.description,
    amount: item.amount.toFixed(MONEY_DECIMAL_PLACES),
    currency: item.currency,
    calculationOrder: item.calculationOrder,
    quantity: toFixedOrNull(item.quantity, MONEY_DECIMAL_PLACES),
    unitPrice: toFixedOrNull(item.unitPrice, MONEY_DECIMAL_PLACES),
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
