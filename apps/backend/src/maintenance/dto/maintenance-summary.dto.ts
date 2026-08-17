import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { MaintenanceResponseDto } from "./maintenance-response.dto";

/**
 * What one Vehicle's maintenance adds up to.
 *
 * This endpoint exists for one reason: the total cost must be summed BY THE
 * DATABASE. The column is NUMERIC(12,2), and adding those amounts in JavaScript
 * would introduce binary rounding into a figure an operator reads as money —
 * and would only ever cover the page the browser happened to load.
 *
 * CANCELLED maintenance is excluded from the count and the total: work that was
 * called off cost nothing and happened never. It stays readable in the list,
 * where its status is visible.
 */
export class MaintenanceSummaryDto {
  @ApiProperty({ format: "uuid" })
  vehicleId!: string;

  @ApiProperty({
    description: "How many maintenance records the Vehicle has, CANCELLED aside.",
    example: 4,
  })
  maintenanceCount!: number;

  @ApiProperty({
    description:
      'Sum of every recorded cost, as a fixed-2 string. "0.00" when nothing has been costed.',
    example: "3250.75",
  })
  totalCost!: string;

  @ApiPropertyOptional({
    type: MaintenanceResponseDto,
    nullable: true,
    description: "The most recent maintenance by date. Null when there is none.",
  })
  latestMaintenance!: MaintenanceResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The odometer reading on the most recent record that carries one. This is the LATEST RECORDED mileage, not the vehicle's current mileage — the system has no odometer.",
    example: 245000,
  })
  latestMileage!: number | null;

  @ApiPropertyOptional({
    format: "date",
    nullable: true,
    description:
      "The earliest planned next-maintenance date still outstanding, CANCELLED records aside.",
  })
  nextMaintenanceDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The planned next-maintenance mileage that goes with it, when one was entered.",
    example: 275000,
  })
  nextMaintenanceMileage!: number | null;

  @ApiProperty({
    description:
      "True when nextMaintenanceDate is set and has arrived. Mileage plays no part: whether a mileage has been reached cannot be answered without a current odometer reading, which this system does not have.",
  })
  isDueByDate!: boolean;
}
