import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";

import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export class EndVehicleAssignmentDto {
  @ApiPropertyOptional({
    description:
      "Last day the assignment applies, inclusive. Defaults to today when omitted.",
    example: "2026-06-30",
  })
  @IsOptional()
  @IsCalendarDateString()
  validTo?: string;
}
