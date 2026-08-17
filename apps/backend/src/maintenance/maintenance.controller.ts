import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { VehicleIdParamDto } from "../vehicles/dto/vehicle-id-param.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { ListMaintenanceQueryDto } from "./dto/list-maintenance-query.dto";
import { MaintenanceIdParamDto } from "./dto/maintenance-id-param.dto";
import {
  MaintenanceResponseDto,
  PaginatedMaintenanceDto,
} from "./dto/maintenance-response.dto";
import { MaintenanceSummaryDto } from "./dto/maintenance-summary.dto";
import { UpdateMaintenanceDto } from "./dto/update-maintenance.dto";
import { MaintenanceService } from "./maintenance.service";

/**
 * Maintenance administration.
 *
 * There is NO DELETE, by design: maintenance is history, and the documented
 * rule is that it is never removed. Work that should not happen becomes
 * CANCELLED through the ordinary update.
 *
 * Costs are returned as fixed-2 strings and are never summed by a client. The
 * one aggregate a screen needs — a Vehicle's totals — is computed by the
 * database and served by the summary route.
 */
@ApiTags("Maintenance")
@Controller("maintenance")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /**
   * Declared before ":id" so the literal path cannot be read as an identifier.
   */
  @Get("summary/vehicle/:id")
  @ApiOperation({
    summary: "Maintenance summary of one Vehicle",
    description:
      "Count, total cost, the latest maintenance, the latest RECORDED mileage and the next planned maintenance. The total is summed by the database — a client must never add these amounts. CANCELLED records are excluded from the count and the total but remain readable in the list. `isDueByDate` is exactly what it says: a planned next date has arrived. Whether a planned MILEAGE has been reached cannot be answered, because this system holds no current odometer reading for a vehicle.",
  })
  @ApiOkResponse({ type: MaintenanceSummaryDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Vehicle with that id." })
  summaryForVehicle(
    @Param() params: VehicleIdParamDto,
  ): Promise<MaintenanceSummaryDto> {
    return this.maintenanceService.summaryForVehicle(params.id);
  }

  @Get()
  @ApiOperation({
    summary: "List maintenance",
    description:
      "Paginated, newest maintenance date first. Filterable by Vehicle, status and date range, with a partial-text search across description, workshop, type and notes. dueOnly=true narrows to records whose planned next date has arrived and that are not CANCELLED — the whole of the due rule, because a mileage-based due date is not evaluable without a current odometer reading.",
  })
  @ApiOkResponse({ type: PaginatedMaintenanceDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(
    @Query() query: ListMaintenanceQueryDto,
  ): Promise<PaginatedMaintenanceDto> {
    return this.maintenanceService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one maintenance record" })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No maintenance record with that id." })
  findById(
    @Param() params: MaintenanceIdParamDto,
  ): Promise<MaintenanceResponseDto> {
    return this.maintenanceService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Record maintenance",
    description:
      "Creates a maintenance record for an existing Vehicle. Mileage and next-maintenance mileage are entered by the Administrator; nothing derives them, and neither is the vehicle's current odometer reading.",
  })
  @ApiCreatedResponse({ type: MaintenanceResponseDto })
  @ApiBadRequestResponse({
    description:
      "Missing or invalid field, a fractional or negative mileage, a negative cost, or an unknown field.",
  })
  @ApiNotFoundResponse({ description: "The referenced Vehicle does not exist." })
  create(@Body() dto: CreateMaintenanceDto): Promise<MaintenanceResponseDto> {
    return this.maintenanceService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a maintenance record",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear a nullable one. The Vehicle cannot be changed — a maintenance record is never reassigned to another asset. Set status to CANCELLED for work that will not happen; records are never deleted.",
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid field value, or an unknown field was sent.",
  })
  @ApiNotFoundResponse({ description: "No maintenance record with that id." })
  update(
    @Param() params: MaintenanceIdParamDto,
    @Body() dto: UpdateMaintenanceDto,
  ): Promise<MaintenanceResponseDto> {
    return this.maintenanceService.update(params.id, dto);
  }
}
