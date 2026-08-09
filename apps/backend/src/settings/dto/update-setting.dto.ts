import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

/**
 * Only `value` is updatable.
 *
 * `category` and `key` form the identity every consumer looks the setting up by,
 * and `valueType` defines how the value is interpreted — changing either through
 * the API would silently break callers, so both stay fixed after seeding.
 */
export class UpdateSettingDto {
  @ApiProperty({
    description:
      "New value, always transported as a string and interpreted according to the setting's valueType. " +
      'For example "15" for an INTEGER, "true" for a BOOLEAN, "2026-01-31" for a DATE.',
    example: "18",
  })
  // Deliberately not @IsNotEmpty: an empty string is a legitimate value for a
  // STRING setting. Type-specific rules are applied by SettingValueValidator.
  @IsString()
  value!: string;
}
