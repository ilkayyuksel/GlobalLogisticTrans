import { ApiProperty } from "@nestjs/swagger";

import { MaintenanceResponseDto } from "./maintenance-response.dto";

/**
 * The maintenance the Dashboard puts in front of the Administrator.
 *
 * At most five PLANNED records, most pressing first: overdue work from the
 * oldest planned date, then work planned for today, then the next upcoming
 * dates. Each carries its own `urgency`, decided by the same rule every other
 * maintenance response uses.
 */
export class MaintenanceAttentionDto {
  @ApiProperty({
    format: "date",
    description: "The day the urgencies were decided against.",
    example: "2026-09-14",
  })
  today!: string;

  @ApiProperty({ type: [MaintenanceResponseDto] })
  items!: MaintenanceResponseDto[];
}
