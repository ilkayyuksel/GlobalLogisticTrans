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

import { CreateDriverDto } from "./dto/create-driver.dto";
import { DriverIdParamDto } from "./dto/driver-id-param.dto";
import {
  DriverResponseDto,
  PaginatedDriversDto,
} from "./dto/driver-response.dto";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto";
import { UpdateDriverDto } from "./dto/update-driver.dto";
import { DriverService } from "./driver.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * There is no DELETE endpoint by design — drivers are never physically removed,
 * so historical Trips can always resolve their driver. Removal from planning is
 * expressed as deactivation.
 */
@ApiTags("Drivers")
@Controller("drivers")
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Get()
  @ApiOperation({
    summary: "List drivers",
    description:
      "Paginated. Returns both active and inactive drivers unless isActive is supplied.",
  })
  @ApiOkResponse({ type: PaginatedDriversDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(@Query() query: ListDriversQueryDto): Promise<PaginatedDriversDto> {
    return this.driverService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one driver",
    description: "Returns the driver regardless of its active state.",
  })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No driver with that id." })
  findById(@Param() params: DriverIdParamDto): Promise<DriverResponseDto> {
    return this.driverService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a driver",
    description:
      "Drivers are created active. A licence number, when supplied, must not already belong to an active driver.",
  })
  @ApiCreatedResponse({ type: DriverResponseDto })
  @ApiBadRequestResponse({ description: "Missing or invalid field." })
  @ApiConflictResponse({
    description: "Licence number already used by an active driver.",
  })
  create(@Body() dto: CreateDriverDto): Promise<DriverResponseDto> {
    return this.driverService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a driver",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear an optional field. Active state is changed through the activate and deactivate endpoints.",
  })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field or UUID." })
  @ApiNotFoundResponse({ description: "No driver with that id." })
  @ApiConflictResponse({
    description: "Licence number already used by another active driver.",
  })
  update(
    @Param() params: DriverIdParamDto,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverResponseDto> {
    return this.driverService.update(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path: /drivers/{id}/activation
   * expresses the state being changed, which keeps the URL a noun.
   */
  @Patch(":id/activation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a driver",
    description:
      "Makes the driver selectable for new work. Idempotent. Fails if the driver's licence number now belongs to another active driver.",
  })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiNotFoundResponse({ description: "No driver with that id." })
  @ApiConflictResponse({
    description: "Licence number already used by another active driver.",
  })
  activate(@Param() params: DriverIdParamDto): Promise<DriverResponseDto> {
    return this.driverService.activate(params.id);
  }

  @Patch(":id/deactivation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a driver",
    description:
      "Soft delete. The record is retained so historical Trips keep resolving their driver; only new assignments are prevented. Idempotent.",
  })
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiNotFoundResponse({ description: "No driver with that id." })
  deactivate(@Param() params: DriverIdParamDto): Promise<DriverResponseDto> {
    return this.driverService.deactivate(params.id);
  }
}
