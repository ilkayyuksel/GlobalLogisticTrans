import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

import { trim, trimToNull } from "../../common/dto/transforms";
import {
  DRIVER_EMAIL_MAX_LENGTH,
  DRIVER_EMERGENCY_CONTACT_MAX_LENGTH,
  DRIVER_LICENCE_NUMBER_MAX_LENGTH,
  DRIVER_NAME_MAX_LENGTH,
  DRIVER_NOTES_MAX_LENGTH,
  DRIVER_PHONE_MAX_LENGTH,
} from "./create-driver.dto";

/**
 * Partial update. Omitted fields are left untouched; an explicit null clears an
 * optional field. Prisma already distinguishes the two — `undefined` means "no
 * change", `null` means "set to null" — so the DTO is passed through unchanged.
 *
 * Deliberately not built with PartialType(CreateDriverDto): `name` is NOT NULL
 * in the database and needs stricter handling than a blanket @IsOptional.
 */
export class UpdateDriverDto {
  @ApiPropertyOptional({
    description: "Full name. Cannot be cleared — the column is NOT NULL.",
    maxLength: DRIVER_NAME_MAX_LENGTH,
    example: "Jan Peeters",
  })
  // ValidateIf rather than @IsOptional: @IsOptional also skips validation for
  // null, which would let `{"name": null}` through to a NOT NULL column and
  // surface as a database error instead of a validation message.
  @ValidateIf((dto: UpdateDriverDto) => dto.name !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(DRIVER_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      "Send null to clear. Must be unique among active drivers when present.",
    maxLength: DRIVER_LICENCE_NUMBER_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_LICENCE_NUMBER_MAX_LENGTH)
  licenceNumber?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_PHONE_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_PHONE_MAX_LENGTH)
  phoneNumber?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_EMAIL_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(DRIVER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_EMERGENCY_CONTACT_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_EMERGENCY_CONTACT_MAX_LENGTH)
  emergencyContact?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_NOTES_MAX_LENGTH)
  notes?: string | null;
}
