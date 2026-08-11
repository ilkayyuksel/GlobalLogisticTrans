import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CreateVehicleAssignmentDto } from "./dto/create-vehicle-assignment.dto";
import { EndVehicleAssignmentDto } from "./dto/end-vehicle-assignment.dto";
import { ListVehicleAssignmentsQueryDto } from "./dto/list-vehicle-assignments-query.dto";
import { UpdateVehicleAssignmentDto } from "./dto/update-vehicle-assignment.dto";
import {
  DriverIdParamDto,
  VehicleAssignmentIdParamDto,
  VehicleIdParamDto,
} from "./dto/vehicle-assignment-params.dto";
import {
  PaginatedVehicleAssignmentsDto,
  VehicleAssignmentResponseDto,
} from "./dto/vehicle-assignment-response.dto";
import { VehicleAssignmentService } from "./vehicle-assignment.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * There is no DELETE endpoint by design — assignments are never physically
 * removed, so a historical Trip can always resolve the driver who was
 * responsible on its planning date. Ending an assignment closes its period.
 *
 * This module defines the default Driver ↔ Vehicle relationship only. It never
 * assigns Trips.
 */
@ApiTags("Vehicle assignments")
@Controller("vehicle-assignments")
export class VehicleAssignmentController {
  constructor(private readonly assignmentService: VehicleAssignmentService) {}

  @Get()
  @ApiOperation({
    summary: "List vehicle assignments",
    description:
      "Paginated, newest period first. Filter by vehicle, driver, active-today, or an overlapping date range.",
  })
  @ApiOkResponse({ type: PaginatedVehicleAssignmentsDto })
  @ApiBadRequestResponse({ description: "Invalid pagination, UUID or date." })
  findAll(
    @Query() query: ListVehicleAssignmentsQueryDto,
  ): Promise<PaginatedVehicleAssignmentsDto> {
    return this.assignmentService.findAll(query);
  }

  /**
   * Declared before the ":id" route for readability; the three-segment path
   * could not collide with it in any case.
   */
  @Get("current/vehicle/:vehicleId")
  @ApiOperation({
    summary: "Current assignment of a vehicle",
    description:
      "The assignment in effect today. Returns null when the vehicle has none.",
  })
  @ApiOkResponse({ type: VehicleAssignmentResponseDto })
  @ApiNotFoundResponse({ description: "No vehicle with that id." })
  findCurrentForVehicle(
    @Param() params: VehicleIdParamDto,
  ): Promise<VehicleAssignmentResponseDto | null> {
    return this.assignmentService.findCurrentForVehicle(params.vehicleId);
  }

  @Get("current/driver/:driverId")
  @ApiOperation({
    summary: "Current assignment of a driver",
    description:
      "The assignment in effect today. Returns null when the driver has none.",
  })
  @ApiOkResponse({ type: VehicleAssignmentResponseDto })
  @ApiNotFoundResponse({ description: "No driver with that id." })
  findCurrentForDriver(
    @Param() params: DriverIdParamDto,
  ): Promise<VehicleAssignmentResponseDto | null> {
    return this.assignmentService.findCurrentForDriver(params.driverId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one vehicle assignment" })
  @ApiOkResponse({ type: VehicleAssignmentResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No assignment with that id." })
  findById(
    @Param() params: VehicleAssignmentIdParamDto,
  ): Promise<VehicleAssignmentResponseDto> {
    return this.assignmentService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a vehicle assignment",
    description:
      "An open-ended assignment automatically closes the previous open-ended assignment of the same vehicle and of the same driver, ending it the day before this one starts. Runs in a single transaction.",
  })
  @ApiCreatedResponse({ type: VehicleAssignmentResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid field, UUID, date, or validTo earlier than validFrom.",
  })
  @ApiNotFoundResponse({ description: "No such vehicle or driver." })
  @ApiConflictResponse({
    description: "The period overlaps an existing assignment.",
  })
  create(
    @Body() dto: CreateVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    return this.assignmentService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a vehicle assignment",
    description:
      "Only the end date and the notes may change. Vehicle, driver and start date define the period and are fixed; a mistake is corrected by ending this assignment and creating a new one.",
  })
  @ApiOkResponse({ type: VehicleAssignmentResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field, UUID or date." })
  @ApiNotFoundResponse({ description: "No assignment with that id." })
  @ApiConflictResponse({
    description:
      "The new period overlaps another assignment, or the assignment has already ended.",
  })
  update(
    @Param() params: VehicleAssignmentIdParamDto,
    @Body() dto: UpdateVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    return this.assignmentService.update(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path, matching the /activation and
   * /deactivation pattern used by Driver and Vehicle.
   */
  @Patch(":id/closure")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "End a vehicle assignment",
    description:
      "Closes the period, defaulting to today. The record is retained so historical Trips keep resolving their driver. Runs in a single transaction.",
  })
  @ApiOkResponse({ type: VehicleAssignmentResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid date, or an end date before the start date.",
  })
  @ApiNotFoundResponse({ description: "No assignment with that id." })
  @ApiConflictResponse({
    description: "The assignment has already ended.",
  })
  end(
    @Param() params: VehicleAssignmentIdParamDto,
    @Body() dto: EndVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    return this.assignmentService.end(params.id, dto);
  }
}
