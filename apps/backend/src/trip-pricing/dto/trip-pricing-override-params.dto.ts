import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, IsUUID, MinLength } from "class-validator";

import { trim } from "../../common/dto/transforms";

/**
 * The Trip and component a correction belongs to — the override's own key.
 *
 * The component travels in the path rather than the body because withdrawing a
 * correction is a DELETE, and a DELETE identifies its target by URL.
 */
export class TripPricingOverrideParamsDto {
  @ApiProperty({
    format: "uuid",
    example: "9c858901-8a57-4791-81fe-4c455b099bc9",
  })
  @IsUUID()
  tripId!: string;

  @ApiProperty({ example: "BASE_PRICE" })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  componentCode!: string;
}
