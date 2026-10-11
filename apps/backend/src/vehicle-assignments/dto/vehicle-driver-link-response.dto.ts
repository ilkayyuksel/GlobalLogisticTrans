import { ApiProperty } from "@nestjs/swagger";
import { VehicleAssignment } from "@prisma/client";

import {
  VehicleAssignmentResponseDto,
  toVehicleAssignmentResponse,
} from "./vehicle-assignment-response.dto";

export const VEHICLE_DRIVER_LINK_OUTCOMES = ["LINKED", "ALREADY_LINKED"] as const;
export type VehicleDriverLinkOutcome = (typeof VEHICLE_DRIVER_LINK_OUTCOMES)[number];

export class VehicleDriverLinkResponseDto {
  @ApiProperty({
    enum: VEHICLE_DRIVER_LINK_OUTCOMES,
    description:
      "ALREADY_LINKED: this driver already drives this vehicle; nothing was changed.",
  })
  outcome!: VehicleDriverLinkOutcome;

  @ApiProperty({
    type: VehicleAssignmentResponseDto,
    description: "The link now in effect.",
  })
  assignment!: VehicleAssignmentResponseDto;

  @ApiProperty({
    type: [VehicleAssignmentResponseDto],
    description:
      "Assignments of the vehicle or the driver ended to make room, kept as history.",
  })
  endedAssignments!: VehicleAssignmentResponseDto[];
}

export function toVehicleDriverLinkResponse(
  outcome: VehicleDriverLinkOutcome,
  assignment: VehicleAssignment,
  endedAssignments: readonly VehicleAssignment[],
): VehicleDriverLinkResponseDto {
  return {
    outcome,
    assignment: toVehicleAssignmentResponse(assignment),
    endedAssignments: endedAssignments.map(toVehicleAssignmentResponse),
  };
}
