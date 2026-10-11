import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";

import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export class EndVehicleAssignmentDto {
  @ApiPropertyOptional({
    description:
      "Last day the assignment applies, inclusive. Omit it to end the assignment as of today: it is no longer in effect today.",
    example: "2026-06-30",
  })
  @IsOptional()
  @IsCalendarDateString()
  validTo?: string;
}
