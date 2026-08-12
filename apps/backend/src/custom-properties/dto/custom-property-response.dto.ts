import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CustomProperty } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

/**
 * Public shape of a CustomProperty.
 *
 * `defaultPrice` is serialised as a fixed-precision string rather than a JSON
 * number, for the same reason as RoutePricing: the column is NUMERIC(12,2) and
 * rendering it as a float would reintroduce the binary rounding the decimal
 * type exists to avoid. The Pricing Engine will read this value.
 */
export class CustomPropertyResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "TAR" })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Null for a fixed-price property. Set for a route-priced one, which decides only whether that component applies to a Trip; its amount comes from the route cost configuration.",
  })
  pricingComponentId!: string | null;

  @ApiPropertyOptional({
    description: "Configured amount in EUR, with two decimals. Null when unset.",
    type: String,
    nullable: true,
    example: "35.00",
  })
  defaultPrice!: string | null;

  @ApiProperty({ example: 1 })
  displayOrder!: number;

  @ApiPropertyOptional({ nullable: true, example: "#f59e0b" })
  color!: string | null;

  @ApiProperty({
    description:
      "Inactive properties cannot be assigned to new Trips but remain referenced by historical Trips.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedCustomPropertiesDto {
  @ApiProperty({ type: [CustomPropertyResponseDto] })
  items!: CustomPropertyResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export function toCustomPropertyResponse(
  property: CustomProperty,
): CustomPropertyResponseDto {
  return {
    id: property.id,
    name: property.name,
    description: property.description,
    pricingComponentId: property.pricingComponentId,
    defaultPrice:
      property.defaultPrice === null
        ? null
        : property.defaultPrice.toFixed(MONEY_DECIMAL_PLACES),
    displayOrder: property.displayOrder,
    color: property.color,
    isActive: property.isActive,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  };
}
