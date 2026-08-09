import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";

import {
  SETTING_CATEGORIES,
  SETTING_KEY_PATTERN,
  SettingCategory,
} from "../settings.constants";

/**
 * Path parameters identifying a single setting.
 *
 * Both parts are required because `key` alone is not unique — the database
 * constraint is UNIQUE (category, key), so two categories may legitimately
 * define the same key.
 */
export class SettingParamsDto {
  @ApiProperty({
    description: "Category the setting belongs to.",
    enum: SETTING_CATEGORIES,
    example: "PRICING",
  })
  @IsIn(SETTING_CATEGORIES, {
    message: `category must be one of: ${SETTING_CATEGORIES.join(", ")}`,
  })
  category!: SettingCategory;

  @ApiProperty({
    description: "Key of the setting, unique within its category.",
    example: "FUEL_PERCENTAGE",
  })
  @IsString()
  @Matches(SETTING_KEY_PATTERN, {
    message: "key may only contain letters, digits, underscore, dot or dash",
  })
  key!: string;
}
