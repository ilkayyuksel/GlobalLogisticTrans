import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  ValidateNested,
} from "class-validator";

import { LEGS_PER_COMBINATION_ROUTE } from "../../route-pricing/exceptions/route-pricing.exceptions";
import {
  RouteConfigurationType,
  SaveRouteConfigurationDto,
} from "./route-configuration.dto";

/**
 * How many routes one import may carry.
 *
 * A bound rather than a preference: the whole import runs in ONE transaction, so
 * its size decides how long that transaction holds its locks. A few hundred
 * routes is far beyond any real price list this business maintains and well
 * inside what one transaction can do comfortably — it refuses the impossible,
 * not the unusual.
 */
export const MAX_IMPORT_ROUTES = 500;

/**
 * A bulk import of route prices.
 *
 * ── JSON IS THE INPUT FORMAT, AND ONLY THAT ─────────────────────────────────
 * Nothing about this document is stored. Each entry becomes exactly the same
 * relational records a route configured by hand becomes — a `route_pricing` row,
 * a `combination_route_group` with two legs, a tunnel `route_cost` — validated by
 * exactly the same rules. There is no JSON column anywhere, and no pricing logic
 * of its own: an imported route is priced by the Engine exactly as a
 * hand-configured one is.
 *
 * ── THIS CLASS DOCUMENTS THE BODY; IT DOES NOT VALIDATE IT ──────────────────
 * The endpoints accept the raw document and hand it to
 * `BulkRouteImportValidator`, which checks the envelope and every entry itself.
 * Two reasons, and the second was found by running it:
 *
 *   The REPORT. The global pipe would say `routes.3.kilometres must be a number`,
 *   and an operator who pasted eighty routes needs "route 4: kilometres must be a
 *   number" — the entry NUMBER, in a list they can work through.
 *
 *   The pipe would also EMPTY the entries. `whitelist` strips every property that
 *   carries no validation metadata, and the entries of an `unknown[]` carry none,
 *   so each one arrived as `[]`. Declaring the entries as DTOs instead would put
 *   the reporting back in the pipe's hands, which is the first problem again.
 *
 * Each entry is therefore validated programmatically against the very DTO classes
 * the manual endpoints use, with the same options the pipe applies. The rules are
 * identical by construction rather than by resemblance; only the reporting differs.
 */
export class BulkImportRouteConfigurationDto {
  @ApiProperty({
    description: `The routes to configure, at most ${MAX_IMPORT_ROUTES}. Each entry is either a NORMAL route or a COMBINATION of exactly ${LEGS_PER_COMBINATION_ROUTE} legs — see BulkNormalRouteImportDto and BulkCombinationRouteImportDto.`,
    isArray: true,
    minItems: 1,
    maxItems: MAX_IMPORT_ROUTES,
    example: [
      {
        type: "NORMAL",
        departure: "Antwerp",
        destination: "Kallo",
        tarief: 100,
        kilometres: 25,
        tunnel: 0,
      },
      {
        type: "COMBINATION",
        legs: [
          {
            departure: "Antwerp",
            destination: "Kallo",
            tarief: 100,
            kilometres: 25,
            tunnel: 0,
          },
          {
            departure: "Kallo",
            destination: "Antwerp",
            tarief: 80,
            kilometres: 30,
            tunnel: 15,
          },
        ],
      },
    ],
  })
  routes!: unknown[];
}

/**
 * One ordinary route in an import.
 *
 * Extends the DTO the manual endpoint uses, so every rule an operator meets on
 * the screen — the endpoint lengths, the money precision, the refusal of a
 * negative amount — applies here unchanged and in one definition. The only
 * addition is the discriminator.
 *
 * There is no `toll` and no `active`: a route carries its DISTANCE, and the Toll
 * a Trip pays is that distance times the configured rate per kilometre. An entry
 * naming a toll amount is refused rather than ignored, because ignoring it would
 * let an operator believe a toll had been stored.
 */
export class BulkNormalRouteImportDto extends SaveRouteConfigurationDto {
  @ApiProperty({ enum: [RouteConfigurationType.NORMAL] })
  @Equals(RouteConfigurationType.NORMAL)
  type!: typeof RouteConfigurationType.NORMAL;
}

/** Said once, for both bounds on the legs array. */
const EXACTLY_TWO_LEGS = `a Combination must have exactly ${LEGS_PER_COMBINATION_ROUTE} legs`;

/**
 * One Combination route in an import: exactly two legs.
 *
 * Each leg is a full route price with its own Van, Naar, Tarief, KM and Tunnel,
 * validated by the same DTO as any other route — the two legs of a real
 * Combination cost different amounts, and nothing here copies one onto the other
 * or fills a missing one in.
 *
 * Exactly two is refused in three places, each for its own reason: here, so a
 * caller learns immediately; in the service, because it is also called from
 * inside the application; and by the database, which has only two leg positions.
 */
export class BulkCombinationRouteImportDto {
  @ApiProperty({ enum: [RouteConfigurationType.COMBINATION] })
  @Equals(RouteConfigurationType.COMBINATION)
  type!: typeof RouteConfigurationType.COMBINATION;

  @ApiProperty({
    type: [SaveRouteConfigurationDto],
    minItems: LEGS_PER_COMBINATION_ROUTE,
    maxItems: LEGS_PER_COMBINATION_ROUTE,
    description: `Exactly ${LEGS_PER_COMBINATION_ROUTE} legs — the outbound first, then the return.`,
  })
  @IsArray()
  /*
   * One message for both bounds, because an operator does not care which bound
   * they crossed: "at least 2 elements" and "at most 2 elements" are the same
   * instruction said twice. Only one of the two can fire at a time.
   */
  @ArrayMinSize(LEGS_PER_COMBINATION_ROUTE, { message: EXACTLY_TWO_LEGS })
  @ArrayMaxSize(LEGS_PER_COMBINATION_ROUTE, { message: EXACTLY_TWO_LEGS })
  @ValidateNested({ each: true })
  @Type(() => SaveRouteConfigurationDto)
  legs!: SaveRouteConfigurationDto[];
}

/**
 * What is wrong with one entry of an import.
 *
 * The route NUMBER is a field rather than part of the sentence, so the screen can
 * say "Route 4" in the operator's own language and a report can be sorted or
 * grouped by entry.
 */
export class BulkRouteImportErrorDto {
  @ApiPropertyOptional({
    description:
      "Which entry of `routes` this is about, counting from 1 — or null when the problem is the document itself, such as a missing `routes` array.",
    type: Number,
    nullable: true,
    example: 4,
  })
  routeNumber!: number | null;

  @ApiPropertyOptional({
    description:
      "Which leg of a Combination, counting from 1, or null when the problem is the entry itself.",
    type: Number,
    nullable: true,
    example: 2,
  })
  legNumber!: number | null;

  @ApiPropertyOptional({
    description:
      "The field at fault, or null when the problem is the shape of the entry.",
    type: String,
    nullable: true,
    example: "kilometres",
  })
  field!: string | null;

  @ApiProperty({ example: "kilometres must be a number" })
  message!: string;
}

/** What an import would create, or did. */
export class BulkRouteImportSummaryDto {
  @ApiProperty({ description: "Ordinary routes.", example: 12 })
  normalRoutes!: number;

  @ApiProperty({ description: "Combination configurations.", example: 4 })
  combinationGroups!: number;

  @ApiProperty({
    description: `Legs belonging to those Combinations — always ${LEGS_PER_COMBINATION_ROUTE} per group.`,
    example: 8,
  })
  combinationLegs!: number;

  @ApiProperty({
    description:
      "Route price records in total: the ordinary routes plus every Combination leg.",
    example: 20,
  })
  totalRoutes!: number;
}

/**
 * The result of checking an import without performing it.
 *
 * A refused document is an ordinary answer here rather than an HTTP failure: the
 * caller asked what WOULD happen, and "nothing, for these nineteen reasons" is
 * the answer to that question. The import endpoint itself refuses with a 400.
 */
export class BulkRouteImportCheckDto {
  @ApiProperty({
    description: "True when every entry is valid and nothing already exists.",
  })
  isValid!: boolean;

  @ApiProperty({
    type: BulkRouteImportSummaryDto,
    description:
      "What the import would create. Counted from the entries that could be read, so it is still useful beside a list of errors.",
  })
  summary!: BulkRouteImportSummaryDto;

  @ApiProperty({ type: [BulkRouteImportErrorDto] })
  errors!: BulkRouteImportErrorDto[];
}
