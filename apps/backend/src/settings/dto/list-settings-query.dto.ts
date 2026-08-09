import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, TransformFnParams } from "class-transformer";
import { IsBoolean, IsIn, IsOptional } from "class-validator";

import { SETTING_CATEGORIES, SettingCategory } from "../settings.constants";

/**
 * Reads the ORIGINAL query string rather than the incoming `value`.
 *
 * The global ValidationPipe runs with enableImplicitConversion, which coerces
 * "false" to boolean true (Boolean("false") is truthy) before this transform is
 * reached. Taking the raw value off the source object sidesteps that entirely,
 * so "false" cannot silently invert into true.
 */
function toBooleanFlag({ obj, key }: TransformFnParams): boolean {
  const rawValue = (obj as Record<string, unknown>)[key];

  return rawValue === true || rawValue === "true";
}

export class ListSettingsQueryDto {
  @ApiPropertyOptional({
    description: "Restrict the result to a single category.",
    enum: SETTING_CATEGORIES,
  })
  @IsOptional()
  @IsIn(SETTING_CATEGORIES, {
    message: `category must be one of: ${SETTING_CATEGORIES.join(", ")}`,
  })
  category?: SettingCategory;

  @ApiPropertyOptional({
    description:
      "Include deactivated settings. They are excluded by default because the application ignores them.",
    default: false,
  })
  @Transform(toBooleanFlag)
  @IsBoolean()
  includeInactive: boolean = false;
}
