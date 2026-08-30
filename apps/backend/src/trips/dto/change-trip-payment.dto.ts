import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean } from "class-validator";

import { rawValueOf } from "../../common/dto/transforms";

/**
 * The payment state to set on a Trip.
 *
 * ── WHY A BOOLEAN AND NOT AN ENUM ───────────────────────────────────────────
 * There are exactly two states — BETAALD and NIET BETAALD — and no third one
 * is coming: "partially paid" would be an amount rather than a state, and would
 * belong beside the money rather than here. A boolean makes every other value
 * unrepresentable, so nothing arbitrary from a caller can be stored.
 *
 * BETAALD and NIET BETAALD are how the SCREEN says it, in Dutch. The API says
 * `isPaid`, like every other flag in this system.
 *
 * ── WHY IT IS NOT PART OF UpdateTripDto ─────────────────────────────────────
 * The same reason status has its own endpoint. Payment is a decision about
 * money made in one click, not a field edited among others, and mixing it into
 * the general update would let a request that meant to correct a container
 * number also mark a Trip paid.
 */
export class ChangeTripPaymentDto {
  @ApiProperty({
    description:
      "True marks the Trip BETAALD, false NIET BETAALD. Setting the state it already has is idempotent. This never changes the Trip's status.",
    example: true,
  })
  /*
   * The RAW value, before the global pipe's implicit conversion touches it.
   *
   * Without this the endpoint would accept far more than a boolean:
   * `enableImplicitConversion` turns "BETAALD" into true and, worse, turns the
   * string "false" into true as well — a request meaning to mark a Trip UNPAID
   * would mark it paid. Reading the original value lets @IsBoolean refuse
   * everything that is not genuinely true or false, which is what the API
   * contract promises.
   */
  @Transform(rawValueOf)
  @IsBoolean()
  isPaid!: boolean;
}
