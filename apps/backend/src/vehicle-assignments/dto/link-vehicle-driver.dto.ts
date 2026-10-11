import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/** No dates: a link applies from today and has no end. */
export class LinkVehicleDriverDto {
  @ApiProperty({ format: "uuid", description: "The vehicle." })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: "uuid", description: "Its new driver." })
  @IsUUID()
  driverId!: string;
}
