import { ApiProperty } from "@nestjs/swagger";

/**
 * One pricing setting, and what bootstrapping would do about it.
 *
 * The shape an operator reads BEFORE anything is created. It answers three
 * questions at once: what is configured, what is missing, and what the
 * application would put there.
 */
export class PricingSettingStatusDto {
  @ApiProperty({ example: "FUEL_PERCENTAGE" })
  key!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The configured value, or null when the setting does not exist.",
    example: "15",
  })
  value!: string | null;

  @ApiProperty({ description: "True when a row exists, active or not." })
  isConfigured!: boolean;

  @ApiProperty({
    description:
      "False when the row exists but is switched off. The Pricing Engine treats an inactive setting exactly as it treats a missing one.",
  })
  isActive!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "What bootstrapping would write. Null when the setting is already configured — it never overwrites — and null when the value cannot be determined, in which case blockedReason says why.",
    example: "15",
  })
  proposedValue!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Why this setting cannot be created automatically. The automatic Custom Property's id is the case that occurs: it is an id in THIS database, so it is resolved by name rather than carried in the application, and a database without that property cannot have it filled in.",
  })
  blockedReason!: string | null;
}

export class PricingBootstrapPlanDto {
  @ApiProperty({ type: [PricingSettingStatusDto] })
  settings!: readonly PricingSettingStatusDto[];

  @ApiProperty({ description: "How many required settings have no row yet." })
  missingCount!: number;

  @ApiProperty({ description: "How many of those bootstrapping can create." })
  creatableCount!: number;

  @ApiProperty({
    description: "How many need an operator's attention before they can exist.",
  })
  blockedCount!: number;
}
