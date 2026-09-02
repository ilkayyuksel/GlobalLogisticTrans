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
      "Why this setting needs an operator before it can exist. The case that occurs is a row that exists but has been switched off: the Pricing Engine treats it as missing, and reactivating somebody's deliberate decision is not the bootstrap's to make.",
  })
  blockedReason!: string | null;
}

/** Whether one catalog component is present. */
export class PricingComponentStatusDto {
  @ApiProperty({ example: "BASE_PRICE" })
  code!: string;

  @ApiProperty({ description: "True when an active row already holds it." })
  isPresent!: boolean;
}

/**
 * The Custom Property the Pricing Engine applies without anyone assigning it.
 *
 * Its own section because it is neither a setting nor a component: it is an
 * ordinary Custom Property that AUTOMATIC_CUSTOM_PROPERTY_ID points at, and
 * that setting cannot be written until this property exists.
 */
export class AutomaticPropertyStatusDto {
  @ApiProperty({ example: "TAR" })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Its id in THIS database. Never carried in the application: an id from another environment would point at nothing, or at an unrelated property.",
  })
  id!: string | null;

  @ApiProperty()
  isPresent!: boolean;

  @ApiProperty({ description: "True when bootstrapping would create it." })
  willCreate!: boolean;
}

export class PricingBootstrapPlanDto {
  @ApiProperty({
    type: [PricingComponentStatusDto],
    description:
      "The pricing_component catalog. Every pricing item carries a foreign key into it, so a calculated breakdown cannot be stored until it is complete.",
  })
  components!: readonly PricingComponentStatusDto[];

  @ApiProperty({ description: "How many catalog components are absent." })
  componentsMissingCount!: number;

  @ApiProperty({ type: AutomaticPropertyStatusDto })
  automaticProperty!: AutomaticPropertyStatusDto;

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
