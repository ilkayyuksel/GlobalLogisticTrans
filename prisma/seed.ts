import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Database seed.
 *
 * Seeds only the reference data that database_schema.md explicitly requires to
 * exist. It is safe to run repeatedly: every step checks before it writes.
 *
 * Deliberately NOT seeded — see the note at the bottom of this file:
 *   - Setting rows (pricing values are excluded from the documentation)
 *   - RoutePricing rows (route prices are customer data)
 *   - Driver / Vehicle / Trailer (created manually by the Administrator)
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in the value.",
  );
}

// Prisma 7 no longer reads the connection URL from schema.prisma, so the client
// is constructed with an explicit driver adapter.
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * The pricing components required by pricing_rules.md.
 *
 * The array order is the calculation order defined in pricing_rules.md
 * ("Pricing Order"), and display_order is derived from it below. Changing the
 * order here changes the order the Pricing Engine and the Excel export use, so
 * it must stay in sync with that document.
 *
 * Codes are taken verbatim from database_schema.md §8.2.
 */
const PRICING_COMPONENTS = [
  {
    code: "BASE_PRICE",
    name: "Base Price",
    description:
      "Base transport price determined by the active pricing strategy (route-based or distance-based).",
  },
  {
    code: "COMBINATION",
    name: "Combination Surcharge",
    description:
      "Surcharge applied automatically to every Trip belonging to a Combination Trip Group.",
  },
  {
    code: "FUEL_SURCHARGE",
    name: "Fuel Surcharge",
    description:
      "Percentage calculated on the base transport price only. Never applied to any other component.",
  },
  {
    code: "WAITING_TIME",
    name: "Waiting Time",
    description:
      "Billable waiting time beyond the configured free period, charged in configurable blocks.",
  },
  {
    code: "TOLL",
    name: "Toll",
    description: "Toll costs added directly to the total.",
  },
  {
    code: "TUNNEL",
    name: "Tunnel",
    description: "Tunnel costs added directly to the total.",
  },
  {
    code: "CUSTOM_PROPERTY",
    name: "Custom Property",
    description:
      "Amount contributed by one Custom Property assigned to the Trip.",
  },
  {
    code: "MANUAL_ADJUSTMENT",
    name: "Manual Adjustment",
    description:
      "Adjustment entered manually by the Administrator, stored as its own pricing item.",
  },
] as const;

/**
 * Creates any missing pricing component.
 *
 * `code` is unique only among active rows (a partial unique index), which
 * Prisma cannot model as a unique field. `upsert` is therefore unavailable and
 * the existence check is explicit.
 *
 * Existing rows are left untouched, so a locally renamed component is not
 * silently reverted by re-running the seed.
 */
async function seedPricingComponents(): Promise<void> {
  let createdCount = 0;

  for (const [index, component] of PRICING_COMPONENTS.entries()) {
    const existing = await prisma.pricingComponent.findFirst({
      where: { code: component.code, isActive: true },
    });

    if (existing) {
      continue;
    }

    await prisma.pricingComponent.create({
      data: {
        code: component.code,
        name: component.name,
        description: component.description,
        // Positions start at 1 so the stored order reads the same as the
        // numbered list in pricing_rules.md.
        displayOrder: index + 1,
      },
    });

    createdCount += 1;
  }

  console.log(
    `Pricing components: ${createdCount} created, ${PRICING_COMPONENTS.length - createdCount} already present.`,
  );
}

async function main(): Promise<void> {
  await seedPricingComponents();

  console.log("Seed completed.");
  console.log(
    "Reminder: pricing Settings are not seeded and must be configured before " +
      "the Pricing Engine can run. See the note in prisma/seed.ts.",
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * WHY Settings are not seeded
 * ---------------------------
 * pricing_rules.md states: "It intentionally does not define actual prices,
 * percentages or monetary values" and "Actual values are intentionally excluded
 * from this document."
 *
 * Seeding invented numbers would be worse than seeding nothing: `setting.value`
 * is NOT NULL, so a placeholder would look like real configuration and could
 * silently produce incorrect prices on a finished Trip.
 *
 * The following keys must be configured before pricing can run
 * (documented in pricing_rules.md "Settings"):
 *
 *   PRICING / Pricing Strategy               route-based or distance-based
 *   PRICING / Fuel Percentage
 *   PRICING / Waiting Time Free Period
 *   PRICING / Waiting Time Billing Interval
 *   PRICING / Combination Surcharge
 *   PRICING / Distance Rate                  price per kilometre
 *
 * Route prices live in the route_pricing table, and Custom Property prices in
 * custom_property.default_price — both are maintained through the Settings UI.
 */
