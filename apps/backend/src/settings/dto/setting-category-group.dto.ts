import { ApiProperty } from "@nestjs/swagger";

import { SETTING_CATEGORIES } from "../settings.constants";
import { SettingResponseDto } from "./setting-response.dto";

/**
 * An array of groups rather than a keyed object.
 *
 * A dynamic map cannot be described in OpenAPI without losing the item schema,
 * and an array preserves a deterministic order for the Settings UI.
 */
export class SettingCategoryGroupDto {
  @ApiProperty({ enum: SETTING_CATEGORIES, example: "PRICING" })
  category!: string;

  @ApiProperty({ type: [SettingResponseDto] })
  settings!: SettingResponseDto[];
}
