import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNumber, IsString, Max, Min, MinLength } from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim } from "../../common/dto/transforms";

/**
 * An operator correcting one price on one Trip.
 *
 * ── WHAT THE CALLER MAY NOT SEND ────────────────────────────────────────────
 * There is no `overriddenBy` field, and adding one would be a security bug: a
 * browser that names the author of a change can name somebody else. The
 * identity comes from the verified access token, on the server, where it cannot
 * be chosen by the caller.
 *
 * `componentCode` is validated only as a non-empty string here. WHICH codes may
 * carry an override is a pricing rule, not a request-shape rule, and it lives
 * in `isOverridableComponent()` — repeating the list in a decorator would give
 * the system two answers that could drift apart.
 */
export class UpsertTripPricingOverrideDto {
  @ApiProperty({
    description:
      "The component to correct. Only BASE_PRICE, TOLL and TUNNEL may be overridden; anything else is refused.",
    example: "BASE_PRICE",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  componentCode!: string;

  @ApiProperty({
    description:
      "The corrected amount. Zero is a legitimate value — a Trip genuinely without toll — and is stored as an explicit 0.00 rather than treated as a withdrawal. Withdrawing a correction is a DELETE.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    example: 120,
  })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  amount!: number;
}
