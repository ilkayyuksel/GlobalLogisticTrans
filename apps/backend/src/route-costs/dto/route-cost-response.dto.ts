import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import { RouteCostWithComponent } from "../route-cost.repository";

/**
 * The component a route cost prices, nested so the response is readable on its
 * own. Only identity is exposed — the component's own lifecycle and ordering
 * belong to the pricing-configuration domain, not to this record.
 */
export class RouteCostComponentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "TOLL" })
  code!: string;

  @ApiProperty({ example: "Toll" })
  name!: string;
}

/**
 * Public shape of a RouteCost.
 *
 * `amount` is serialised as a fixed-precision string, not a JSON number. The
 * column is NUMERIC(12,2); rendering it as a float would reintroduce the binary
 * rounding that the decimal type exists to avoid, which matters because the
 * Pricing Engine reads these values.
 */
export class RouteCostResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Antwerp Terminal" })
  departure!: string;

  @ApiProperty({ example: "Rotterdam" })
  destination!: string;

  @ApiProperty({ format: "uuid" })
  pricingComponentId!: string;

  @ApiProperty({ type: RouteCostComponentDto })
  pricingComponent!: RouteCostComponentDto;

  @ApiProperty({
    description: "Cost in EUR, always with two decimals.",
    type: String,
    example: "24.50",
  })
  amount!: string;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({
    description:
      "Only active records participate in pricing. Deactivated records are retained so historical Trip pricing stays explainable.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedRouteCostsDto {
  @ApiProperty({ type: [RouteCostResponseDto] })
  items!: RouteCostResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export function toRouteCostResponse(
  routeCost: RouteCostWithComponent,
): RouteCostResponseDto {
  return {
    id: routeCost.id,
    departure: routeCost.departure,
    destination: routeCost.destination,
    pricingComponentId: routeCost.pricingComponentId,
    pricingComponent: {
      id: routeCost.pricingComponent.id,
      code: routeCost.pricingComponent.code,
      name: routeCost.pricingComponent.name,
    },
    amount: routeCost.amount.toFixed(MONEY_DECIMAL_PLACES),
    notes: routeCost.notes,
    isActive: routeCost.isActive,
    createdAt: routeCost.createdAt,
    updatedAt: routeCost.updatedAt,
  };
}
