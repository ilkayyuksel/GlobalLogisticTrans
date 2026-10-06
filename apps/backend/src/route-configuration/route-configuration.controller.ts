import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { BulkRouteImportService } from "./bulk-route-import.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import {
  BulkImportRouteConfigurationDto,
  BulkRouteImportCheckDto,
  BulkRouteImportSummaryDto,
} from "./dto/bulk-route-import.dto";
import { CombinationRouteGroupIdParamDto } from "./dto/combination-route-group-id-param.dto";
import { ReviewRouteConfigurationDto } from "./dto/review-route-configuration.dto";
import { RouteConfigurationIdParamDto } from "./dto/route-configuration-id-param.dto";
import {
  CombinationRouteConfigurationDto,
  RouteConfigurationDto,
  SaveCombinationRouteConfigurationDto,
  SaveRouteConfigurationDto,
} from "./dto/route-configuration.dto";
import { RouteConfigurationService } from "./route-configuration.service";

/**
 * Route pricing, as one record per route.
 *
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * Every route here is protected by the application's global access-token
 * guard — none of them is marked public — so only an authenticated operator
 * can read or change pricing configuration. No actor identity is accepted from
 * the caller, because none is stored: a route configuration records what a
 * route costs, not who said so.
 */
@ApiTags("Route configuration")
@Controller("route-configuration")
export class RouteConfigurationController {
  constructor(
    private readonly service: RouteConfigurationService,
    private readonly combinations: CombinationRouteConfigurationService,
    private readonly bulkImport: BulkRouteImportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List every ordinary configured route",
    description:
      "One record per route, each carrying its Tarief, Toll and Tunnel. Combination legs are NOT listed here — a leg exists only as half of a pair and is read through the combinations endpoint — and every record still states its own type. Deliberately not paginated: this is configuration read as a whole, and the set is bounded by the routes the business runs.",
  })
  @ApiOkResponse({ type: [RouteConfigurationDto] })
  findAll(): Promise<RouteConfigurationDto[]> {
    return this.service.findAll();
  }

  /*
   * ── THE COMBINATION ROUTES ────────────────────────────────────────────────
   * Their own endpoints rather than a flag on the ones above, because the thing
   * a caller acts on is the PAIR: it is created with two legs, edited with two
   * legs and removed as a whole. Declared before the `:id` routes so a literal
   * path segment is never read as an identifier.
   *
   * These configure what a route COSTS. They have nothing to do with the Trip
   * groups in the Rittenlijst, which decide which Trips carry the Backload.
   */
  @Get("combinations")
  @ApiOperation({
    summary: "List every Combination route configuration",
    description:
      "One record per Combination, each with exactly two legs — the outbound first — and each leg carrying its own Tarief, Toll and Tunnel, and the Combination its Over ST.",
  })
  @ApiOkResponse({ type: [CombinationRouteConfigurationDto] })
  findAllCombinations(): Promise<CombinationRouteConfigurationDto[]> {
    return this.combinations.findAll();
  }

  @Post("combinations")
  @ApiOperation({
    summary: "Configure a Combination route",
    description:
      "Creates the group and BOTH legs in one transaction, so a Combination with a single leg cannot come into being. The two legs must describe different routes, and no other Combination leg may already describe either of them — an ORDINARY route on the same road is not a conflict, because the two are read in different pricing contexts.",
  })
  @ApiCreatedResponse({ type: CombinationRouteConfigurationDto })
  @ApiBadRequestResponse({
    description:
      "Anything but exactly two legs, a missing or blank endpoint, or an amount below zero.",
  })
  @ApiConflictResponse({
    description:
      "One of the legs describes a route another Combination leg already configures.",
  })
  createCombination(
    @Body() dto: SaveCombinationRouteConfigurationDto,
  ): Promise<CombinationRouteConfigurationDto> {
    return this.combinations.create(dto);
  }

  @Put("combinations/:combinationGroupId")
  @ApiOperation({
    summary: "Change a Combination route configuration",
    description:
      "Replaces both legs in one edit. A Combination is never left with one leg: the legs keep their identities and are updated together, so no intermediate state exists. Historical pricing is untouched.",
  })
  @ApiOkResponse({ type: CombinationRouteConfigurationDto })
  @ApiBadRequestResponse({
    description: "A malformed id or amount, or anything but exactly two legs.",
  })
  @ApiNotFoundResponse({ description: "No Combination with that id." })
  @ApiConflictResponse({
    description:
      "A leg would collide with a leg of another Combination configuration.",
  })
  updateCombination(
    @Param() params: CombinationRouteGroupIdParamDto,
    @Body() dto: SaveCombinationRouteConfigurationDto,
  ): Promise<CombinationRouteConfigurationDto> {
    return this.combinations.update(params.combinationGroupId, dto);
  }

  /**
   * 200 with the removed Combination rather than 204, the convention every
   * DELETE in this API follows: each response carries the standard envelope.
   *
   * It used to answer 204. An empty body is not the envelope, so the browser
   * reported a response it could not read on a deletion that had in fact
   * succeeded — the record was gone and the screen said it had failed.
   */
  /**
   * Marks a Combination as checked, or unchecks it.
   *
   * ── ADMINISTRATIVE PROGRESS, NOT STATE ────────────────────────────────────
   * It records that a person has looked at these prices. It does not decide
   * whether the Combination is used, what a Trip is charged, or anything the
   * Pricing Engine reads — an unreviewed Combination prices exactly as a
   * reviewed one does, and no Trip, snapshot or pricing line is touched.
   *
   * On the GROUP, because the group is what an operator configures, edits and
   * removes. Marking legs separately would invent a half-reviewed Combination,
   * which is a state the screen cannot show and nothing can act on.
   *
   * A sub-resource rather than a verb in the path, and separate from the ordinary
   * edit: ticking a box is not an edit, and sending the amounts back to record one
   * would rewrite prices nobody meant to touch.
   */
  @Patch("combinations/:combinationGroupId/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mark a Combination route as checked, or uncheck it",
    description:
      "Administrative progress only. Idempotent: sending the value it already has is not an error. No price, no leg and nothing the Pricing Engine reads is changed.",
  })
  @ApiOkResponse({ type: CombinationRouteConfigurationDto })
  @ApiNotFoundResponse({ description: "No Combination with that id." })
  reviewCombination(
    @Param() params: CombinationRouteGroupIdParamDto,
    @Body() dto: ReviewRouteConfigurationDto,
  ): Promise<CombinationRouteConfigurationDto> {
    return this.combinations.setReviewed(
      params.combinationGroupId,
      dto.reviewed,
    );
  }

  @Delete("combinations/:combinationGroupId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete a Combination route configuration",
    description:
      "Removes the Combination, both of its legs and each leg's own tunnel, in one statement — never one leg on its own. Answers with the Combination that was removed. Historical Trip pricing is unaffected: a snapshot keeps the amounts it was priced with.",
  })
  @ApiOkResponse({ type: CombinationRouteConfigurationDto })
  @ApiNotFoundResponse({ description: "No Combination with that id." })
  removeCombination(
    @Param() params: CombinationRouteGroupIdParamDto,
  ): Promise<CombinationRouteConfigurationDto> {
    return this.combinations.remove(params.combinationGroupId);
  }

  /*
   * ── THE BULK IMPORT ───────────────────────────────────────────────────────
   * JSON is the input format and nothing more: each entry becomes exactly the
   * same relational records a route configured by hand becomes, validated by
   * exactly the same rules. Nothing is stored as JSON and no pricing logic of its
   * own exists — the Toll and Tunnel are stored as the amounts given.
   *
   * Two endpoints because an operator pasting eighty routes needs to see what will
   * happen before it does: `bulk/check` answers that and writes nothing, `bulk`
   * performs it in one transaction. Both ask the same validator the same question,
   * so the preview cannot disagree with the import about what is valid.
   *
   * Both take the document RAW rather than through a validated DTO. The global
   * pipe strips properties that carry no validation metadata, which emptied every
   * entry of an `unknown[]` on its way in, and its field paths could not name the
   * entry at fault. The validator checks the envelope and every entry itself, with
   * the same rules and a report an operator can work through.
   */
  @Post("bulk/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Check a bulk import without performing it",
    description:
      "Validates the whole document and reports what it would create and every reason it would be refused — including routes that are already configured. Writes nothing: a refused document is an ordinary answer here, not an HTTP failure, because the caller asked what WOULD happen.",
  })
  @ApiOkResponse({ type: BulkRouteImportCheckDto })
  @ApiBadRequestResponse({
    description: "The envelope itself is wrong: no routes array, or too many.",
  })
  @ApiBody({ type: BulkImportRouteConfigurationDto })
  checkBulkImport(@Body() document: unknown): Promise<BulkRouteImportCheckDto> {
    return this.bulkImport.check(document);
  }

  @Post("bulk")
  @ApiOperation({
    summary: "Import many route configurations at once",
    description:
      "Creates every entry through the same services the single-route endpoints use, inside ONE transaction. Twenty valid routes and one invalid one change nothing: the whole document is validated first, and the refusal lists every problem with the number of the entry it belongs to. Nothing is ever overwritten — an entry whose route is already configured is a refusal, not an update.",
  })
  @ApiCreatedResponse({ type: BulkRouteImportSummaryDto })
  @ApiBadRequestResponse({
    description:
      "One or more entries were refused. No record was created; `details` lists the reasons per entry.",
  })
  @ApiBody({ type: BulkImportRouteConfigurationDto })
  runBulkImport(@Body() document: unknown): Promise<BulkRouteImportSummaryDto> {
    return this.bulkImport.import(document);
  }

  @Post()
  @ApiOperation({
    summary: "Configure a route",
    description:
      "Creates the route's price and both of its route costs together. A second ACTIVE configuration of the same canonical route is refused — PSA Quay 869 and Quay 869 are the same departure, while Quay 869 to Dourges and Dourges to Quay 869 are different routes. Zero is a valid amount for any of the three.",
  })
  @ApiCreatedResponse({ type: RouteConfigurationDto })
  @ApiBadRequestResponse({
    description: "A missing or blank endpoint, or an amount below zero.",
  })
  @ApiConflictResponse({
    description: "That route already has an active configuration.",
  })
  create(
    @Body() dto: SaveRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.create(dto);
  }

  @Put(":id")
  @ApiOperation({
    summary: "Change a route's configuration",
    description:
      "Replaces all three amounts, and moves the route when either end changes — the costs move with it. Historical pricing is untouched: a Trip already priced keeps the amounts it was priced with, and only a later calculation or an explicit reprocess reads the new configuration.",
  })
  @ApiOkResponse({ type: RouteConfigurationDto })
  @ApiBadRequestResponse({ description: "A malformed id or amount." })
  @ApiNotFoundResponse({ description: "No configuration with that id." })
  @ApiConflictResponse({
    description: "Moving it would collide with another active configuration.",
  })
  update(
    @Param() params: RouteConfigurationIdParamDto,
    @Body() dto: SaveRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.update(params.id, dto);
  }

  /**
   * Removes a route's configuration.
   *
   * ── DELETE RATHER THAN A SWITCH ───────────────────────────────────────────
   * This was an activate/deactivate endpoint. A route now exists or it does
   * not: the flag gave the screen a second state to explain and produced a
   * configuration that looked present while charging nothing.
   *
   * The price record and the route's tunnel cost go together. Trips already
   * priced are untouched — a snapshot holds its own amounts and reads no
   * configuration again — and Trips priced afterwards simply find no route.
   *
   * 200 with the removed configuration rather than 204, the convention every
   * DELETE in this API follows: each response carries the standard envelope. An
   * empty body is not the envelope, and a browser reading one reported a
   * response it could not read on a deletion that had already succeeded.
   */
  /**
   * Marks a route as checked, or unchecks it.
   *
   * Administrative progress and nothing else — see the Combination's own review
   * endpoint above for why it is separate from the ordinary edit. A Combination
   * leg is refused here: a leg is never reviewed on its own, and its group
   * carries the mark.
   */
  @Patch(":id/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mark a route as checked, or uncheck it",
    description:
      "Administrative progress only. Idempotent. No amount, no route and nothing the Pricing Engine reads is changed.",
  })
  @ApiOkResponse({ type: RouteConfigurationDto })
  @ApiNotFoundResponse({ description: "No configuration with that id." })
  @ApiConflictResponse({
    description:
      "That id is a leg of a Combination, which is reviewed as a whole.",
  })
  review(
    @Param() params: RouteConfigurationIdParamDto,
    @Body() dto: ReviewRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.setReviewed(params.id, dto.reviewed);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete a route configuration",
    description:
      "Removes the route's price and its tunnel cost, and answers with the configuration that was removed. Historical Trip pricing is unaffected: a snapshot keeps the amounts it was priced with.",
  })
  @ApiOkResponse({ type: RouteConfigurationDto })
  @ApiNotFoundResponse({ description: "No configuration with that id." })
  remove(
    @Param() params: RouteConfigurationIdParamDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.remove(params.id);
  }
}
