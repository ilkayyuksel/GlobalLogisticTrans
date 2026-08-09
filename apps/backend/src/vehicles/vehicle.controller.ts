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

import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { ListVehiclesQueryDto } from "./dto/list-vehicles-query.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { VehicleIdParamDto } from "./dto/vehicle-id-param.dto";
import {
  PaginatedVehiclesDto,
  VehicleResponseDto,
} from "./dto/vehicle-response.dto";
import { VehicleService } from "./vehicle.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * There is no DELETE endpoint by design — vehicles are never physically
 * removed, so historical Trips can always resolve their vehicle. Removal from
 * planning is expressed as deactivation.
 */
@ApiTags("Vehicles")
@Controller("vehicles")
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get()
  @ApiOperation({
    summary: "List vehicles",
    description:
      "Paginated. Returns both active and inactive vehicles unless isActive is supplied. Search matches licence plate, brand and model.",
  })
  @ApiOkResponse({ type: PaginatedVehiclesDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(@Query() query: ListVehiclesQueryDto): Promise<PaginatedVehiclesDto> {
    return this.vehicleService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one vehicle",
    description: "Returns the vehicle regardless of its active state.",
  })
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No vehicle with that id." })
  findById(@Param() params: VehicleIdParamDto): Promise<VehicleResponseDto> {
    return this.vehicleService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a vehicle",
    description:
      "Vehicles are created active. Both the licence plate and the planning colour must be free among active vehicles.",
  })
  @ApiCreatedResponse({ type: VehicleResponseDto })
  @ApiBadRequestResponse({ description: "Missing or invalid field." })
  @ApiConflictResponse({
    description:
      "Licence plate or planning colour already used by an active vehicle.",
  })
  create(@Body() dto: CreateVehicleDto): Promise<VehicleResponseDto> {
    return this.vehicleService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a vehicle",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear an optional field. Licence plate and planning colour cannot be cleared. Active state is changed through the activate and deactivate endpoints.",
  })
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field or UUID." })
  @ApiNotFoundResponse({ description: "No vehicle with that id." })
  @ApiConflictResponse({
    description:
      "Licence plate or planning colour already used by another active vehicle.",
  })
  update(
    @Param() params: VehicleIdParamDto,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleResponseDto> {
    return this.vehicleService.update(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path: /vehicles/{id}/activation
   * expresses the state being changed, which keeps the URL a noun.
   */
  @Patch(":id/activation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a vehicle",
    description:
      "Makes the vehicle selectable for new Trips. Idempotent. Fails if its licence plate or planning colour now belongs to another active vehicle.",
  })
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiNotFoundResponse({ description: "No vehicle with that id." })
  @ApiConflictResponse({
    description:
      "Licence plate or planning colour already used by another active vehicle.",
  })
  activate(@Param() params: VehicleIdParamDto): Promise<VehicleResponseDto> {
    return this.vehicleService.activate(params.id);
  }

  @Patch(":id/deactivation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a vehicle",
    description:
      "Soft delete. The record is retained so historical Trips keep resolving their vehicle; only new assignments are prevented. Idempotent.",
  })
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiNotFoundResponse({ description: "No vehicle with that id." })
  deactivate(@Param() params: VehicleIdParamDto): Promise<VehicleResponseDto> {
    return this.vehicleService.deactivate(params.id);
  }
}
