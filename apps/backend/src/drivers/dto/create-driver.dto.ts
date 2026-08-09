import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import { trim, trimToNull } from "../../common/dto/transforms";

export const DRIVER_NAME_MAX_LENGTH = 200;
export const DRIVER_LICENCE_NUMBER_MAX_LENGTH = 50;
export const DRIVER_PHONE_MAX_LENGTH = 50;
export const DRIVER_EMAIL_MAX_LENGTH = 255;
export const DRIVER_EMERGENCY_CONTACT_MAX_LENGTH = 200;
export const DRIVER_NOTES_MAX_LENGTH = 2000;

export class CreateDriverDto {
  @ApiProperty({
    description: "Full name. Not unique — two drivers may share a name.",
    maxLength: DRIVER_NAME_MAX_LENGTH,
    example: "Jan Peeters",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(DRIVER_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    description:
      "Driving licence number. Must be unique among active drivers when present.",
    maxLength: DRIVER_LICENCE_NUMBER_MAX_LENGTH,
    nullable: true,
    example: "B-1234567",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_LICENCE_NUMBER_MAX_LENGTH)
  licenceNumber?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_PHONE_MAX_LENGTH,
    nullable: true,
    example: "+32 470 11 22 33",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_PHONE_MAX_LENGTH)
  phoneNumber?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_EMAIL_MAX_LENGTH,
    nullable: true,
    example: "jan.peeters@example.com",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(DRIVER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({
    maxLength: DRIVER_EMERGENCY_CONTACT_MAX_LENGTH,
    nullable: true,
    example: "+32 470 99 88 77",
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
