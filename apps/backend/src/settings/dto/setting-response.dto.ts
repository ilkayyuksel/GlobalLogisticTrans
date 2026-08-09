import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Setting, SettingValueType } from "@prisma/client";

import { SETTING_CATEGORIES } from "../settings.constants";

/**
 * The public shape of a setting.
 *
 * Prisma models are never returned directly: doing so would leak every future
 * column into the API contract the moment it is added to the schema.
 */
export class SettingResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: SETTING_CATEGORIES, example: "PRICING" })
  category!: string;

  @ApiProperty({ example: "FUEL_PERCENTAGE" })
  key!: string;

  @ApiProperty({
    description: "Raw value, to be interpreted according to valueType.",
    example: "15",
  })
  value!: string;

  @ApiProperty({ enum: SettingValueType, example: SettingValueType.DECIMAL })
  valueType!: SettingValueType;

  @ApiProperty({ example: "Fuel surcharge percentage." })
  description!: string;

  @ApiPropertyOptional({
    description: "Value to fall back to, when one was configured.",
    nullable: true,
  })
  defaultValue!: string | null;

  @ApiProperty({
    description: "Deactivated settings are ignored by the application.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

export function toSettingResponse(setting: Setting): SettingResponseDto {
  return {
    id: setting.id,
    category: setting.category,
    key: setting.key,
    value: setting.value,
    valueType: setting.valueType,
    description: setting.description,
    defaultValue: setting.defaultValue,
    isActive: setting.isActive,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
  };
}
