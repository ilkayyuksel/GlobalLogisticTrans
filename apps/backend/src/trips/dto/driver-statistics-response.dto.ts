import { ApiProperty } from "@nestjs/swagger";

/**
 * How much work one Driver has, over the three windows an operator asks about.
 *
 * The counts are of TRIPS, resolved through the effective driver — a Trip's own
 * driver column is only an override, and a Trip planned onto a truck belongs to
 * whoever that truck was assigned to on that day. A Trip with no effective
 * driver is counted under nobody; it is not gathered into an invented
 * "unassigned" row, which would read as a person.
 */
export class DriverTripCountsDto {
  @ApiProperty({ format: "uuid" })
  driverId!: string;

  @ApiProperty({ example: "Piet Janssens" })
  driverName!: string;

  @ApiProperty({
    description: "Whether the Driver is still selectable for new planning.",
  })
  isActive!: boolean;

  @ApiProperty({ description: "Trips whose planning date is today." })
  today!: number;

  @ApiProperty({ description: "Trips planned in the current Monday–Sunday week." })
  week!: number;

  @ApiProperty({ description: "Trips planned in the current calendar month." })
  month!: number;
}

/**
 * The windows the counts were taken over, as the backend decided them.
 *
 * Sent so the Frontend can label the columns without working out where the week
 * or the month begins — a second opinion about the calendar is exactly how a
 * dashboard starts disagreeing with the list it summarises.
 */
export class DriverStatisticsPeriodDto {
  @ApiProperty({ format: "date", example: "2026-08-20" })
  today!: string;

  @ApiProperty({ format: "date", example: "2026-08-17" })
  weekStart!: string;

  @ApiProperty({ format: "date", example: "2026-08-23" })
  weekEnd!: string;

  @ApiProperty({ format: "date", example: "2026-08-01" })
  monthStart!: string;

  @ApiProperty({ format: "date", example: "2026-08-31" })
  monthEnd!: string;
}

export class DriverStatisticsDto {
  @ApiProperty({ type: DriverStatisticsPeriodDto })
  period!: DriverStatisticsPeriodDto;

  @ApiProperty({
    type: [DriverTripCountsDto],
    description:
      "Every active Driver, plus any inactive Driver who still has Trips in these windows. Busiest month first, then by name.",
  })
  drivers!: DriverTripCountsDto[];
}
