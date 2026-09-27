import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/**
 * Whether an administrator has been through a route's prices.
 *
 * ── ONE FIELD, AND A BOOLEAN ────────────────────────────────────────────────
 * Sent rather than toggled server-side, so two administrators working the same
 * list cannot flip each other's mark by pressing the same button: each request
 * says what the value should BE, not that it should change. Which also makes the
 * endpoint idempotent — pressing twice leaves it where it was put.
 */
export class ReviewRouteConfigurationDto {
  @ApiProperty({
    description:
      "True once somebody has checked these prices. Administrative progress only: no amount, no route and nothing the Pricing Engine reads is affected.",
    example: true,
  })
  @IsBoolean()
  reviewed!: boolean;
}
