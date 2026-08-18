import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * DEVELOPMENT-ONLY dummy data.
 *
 * Every value in this file is fabricated. It exists so the planning board,
 * Prisma Studio and PgAdmin have something realistic to display while the
 * applications are being built.
 *
 * This is deliberately NOT part of `prisma db seed`. That command runs
 * prisma/seed.ts, which seeds only the reference data required in every
 * environment (the pricing components). Mixing the two would risk fake Trips
 * reaching a real database.
 *
 * Run with:  pnpm db:seed:dev
 *
 * The script wipes the transactional tables first, so it is safe to re-run.
 * It never touches pricing_component — that belongs to prisma/seed.ts.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in the value.",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Dates are relative to today so the planning views always show current data. */
function dayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

/** TIME columns carry only a time-of-day; the date part is ignored. */
function timeOfDay(hours: number, minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}

/**
 * Removes previously generated dummy data.
 *
 * Order follows the foreign keys: children before parents. pricing_component is
 * excluded on purpose — it is reference data owned by prisma/seed.ts.
 */
async function clearTransactionalData(): Promise<void> {
  await prisma.tripPricingItem.deleteMany();
  await prisma.tripPricing.deleteMany();
  await prisma.tripHistory.deleteMany();
  await prisma.tripCustomProperty.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.tripGroup.deleteMany();
  await prisma.parserRun.deleteMany();
  await prisma.pdfDocument.deleteMany();
  await prisma.importedEmail.deleteMany();

  await prisma.maintenance.deleteMany();
  await prisma.vehicleAssignment.deleteMany();
  await prisma.vacation.deleteMany();

  await prisma.vehicle.deleteMany();
  await prisma.trailer.deleteMany();
  await prisma.driver.deleteMany();

  await prisma.customProperty.deleteMany();
  await prisma.routePricing.deleteMany();
  await prisma.routeCost.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.note.deleteMany();
}

async function main(): Promise<void> {
  console.log("Clearing existing dummy data...");
  await clearTransactionalData();

  // --- Fleet -------------------------------------------------------------

  const [driverJan, driverPiet, driverAhmet] = await Promise.all([
    prisma.driver.create({
      data: {
        name: "Jan Peeters",
        phoneNumber: "+32 470 11 22 33",
        email: "jan.peeters@example.com",
        emergencyContact: "+32 470 99 88 77",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Piet Janssens",
        phoneNumber: "+32 471 22 33 44",
        email: "piet.janssens@example.com",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Ahmet Yilmaz",
        phoneNumber: "+32 472 33 44 55",
        notes: "Prefers long-distance routes.",
      },
    }),
  ]);

  const [truckOne, truckTwo, truckThree] = await Promise.all([
    prisma.vehicle.create({
      data: {
        licensePlate: "1-ABC-123",
        displayColor: "#2563eb",
        brand: "Volvo",
        model: "FH16",
        year: 2021,
        description: "Main long-distance tractor unit.",
      },
    }),
    prisma.vehicle.create({
      data: {
        licensePlate: "1-DEF-456",
        displayColor: "#16a34a",
        brand: "Scania",
        model: "R450",
        year: 2022,
      },
    }),
    prisma.vehicle.create({
      data: {
        licensePlate: "1-GHI-789",
        displayColor: "#ea580c",
        brand: "DAF",
        model: "XF",
        year: 2019,
        notes: "Spare unit.",
      },
    }),
  ]);

  const trailerOne = await prisma.trailer.create({
    data: {
      licensePlate: "Q-TRL-001",
      brand: "Krone",
      model: "Box Liner",
      year: 2020,
      description: "40ft container chassis.",
    },
  });

  // Historized Driver-to-Vehicle links. Truck one deliberately has a closed
  // period followed by an open one, so Driver resolution by date is visible.
  await prisma.vehicleAssignment.createMany({
    data: [
      {
        vehicleId: truckOne.id,
        driverId: driverJan.id,
        validFrom: dayOffset(-365),
        validTo: dayOffset(-31),
        notes: "Reassigned after Jan moved to the Scania.",
      },
      {
        vehicleId: truckOne.id,
        driverId: driverPiet.id,
        validFrom: dayOffset(-30),
      },
      {
        vehicleId: truckTwo.id,
        driverId: driverJan.id,
        validFrom: dayOffset(-30),
      },
    ],
  });

  await prisma.vacation.create({
    data: {
      driverId: driverAhmet.id,
      startDate: dayOffset(7),
      endDate: dayOffset(18),
      reason: "Annual leave",
    },
  });

  await prisma.maintenance.createMany({
    data: [
      {
        vehicleId: truckOne.id,
        status: "COMPLETED",
        maintenanceDate: dayOffset(-45),
        description: "Annual service and brake inspection.",
        cost: 1250.0,
        workshop: "Volvo Trucks Antwerpen",
      },
      {
        vehicleId: truckThree.id,
        status: "PLANNED",
        maintenanceDate: dayOffset(21),
        description: "Tachograph recalibration.",
        cost: 180.0,
      },
      {
        trailerId: trailerOne.id,
        status: "IN_PROGRESS",
        maintenanceDate: dayOffset(-2),
        description: "Tyre replacement, axle 2.",
        cost: 640.5,
        workshop: "Banden Service Gent",
      },
    ],
  });

  // --- Configuration -----------------------------------------------------

  const [propertyTar, propertyFlat, propertySintNiklaas] = await Promise.all([
    prisma.customProperty.create({
      data: {
        name: "TAR",
        description:
          "Terminal Access Regulation surcharge. Applied automatically by the Pricing Engine — see the AUTOMATIC_CUSTOM_PROPERTY_ID setting.",
        defaultPrice: 20.0,
        displayOrder: 1,
        color: "#f59e0b",
      },
    }),
    prisma.customProperty.create({
      data: {
        name: "Flat",
        description: "Flat rate agreed with the customer.",
        defaultPrice: 50.0,
        displayOrder: 2,
        color: "#8b5cf6",
      },
    }),
    prisma.customProperty.create({
      data: {
        name: "Over Sint-Niklaas",
        description: "Detour via Sint-Niklaas.",
        defaultPrice: 27.5,
        displayOrder: 3,
        color: "#06b6d4",
      },
    }),
  ]);

  // Route-priced Custom Properties. They decide only WHETHER the component
  // applies to a Trip; the amount comes from route_cost for the Trip's route,
  // which is why defaultPrice is absent — the CHECK constraint forbids one.
  const componentsForProperties = await prisma.pricingComponent.findMany({
    where: { code: { in: ["TOLL", "TUNNEL"] } },
  });

  function requireComponentId(code: string): string {
    const component = componentsForProperties.find((c) => c.code === code);

    if (!component) {
      throw new Error(
        `Pricing component "${code}" is missing. Run \`pnpm prisma db seed\` first.`,
      );
    }

    return component.id;
  }

  const [propertyToll, propertyTunnel] = await Promise.all([
    prisma.customProperty.create({
      data: {
        name: "Toll",
        description: "Toll charge for the Trip's route.",
        pricingComponentId: requireComponentId("TOLL"),
        displayOrder: 4,
        color: "#64748b",
      },
    }),
    prisma.customProperty.create({
      data: {
        name: "Tunnel",
        description: "Tunnel charge for the Trip's route.",
        pricingComponentId: requireComponentId("TUNNEL"),
        displayOrder: 5,
        color: "#0ea5e9",
      },
    }),
  ]);

  // A route is Terminal -> Destination (pricing_rules.md, Route-Based Pricing),
  // and `departure` must hold the SAME string the Trips carry, because the
  // Pricing Engine matches routes by exact equality.
  //
  // The departures below are the terminals the real transport orders actually
  // print — `PSA Quay 869` and `Quay 869`. They were previously fabricated
  // names ("PSA Antwerp", "DP World Antwerp Gateway", "MSC PSA European
  // Terminal") that appear in no document, which left every imported Trip
  // unpriceable. There is no alias layer: the PDF's terminal IS the route key.
  //
  // Amounts are carried over unchanged from the routes they replace.
  await prisma.routePricing.createMany({
    data: [
      // Destination unchanged; only the departure is corrected.
      {
        routeName: "PSA Quay 869 - Dourges",
        departure: "PSA Quay 869",
        destination: "Dourges",
        basePrice: 520.0,
      },
      {
        routeName: "PSA Quay 869 - Bousbecque",
        departure: "PSA Quay 869",
        destination: "Bousbecque",
        basePrice: 450.0,
      },
      {
        routeName: "Quay 869 - Rotterdam",
        departure: "Quay 869",
        destination: "Rotterdam",
        basePrice: 380.0,
      },
      // The two legs of combination.pdf. Added so that fixture is priceable
      // end to end; each reuses the amount of the other route sharing its
      // departure, rather than introducing an invented figure.
      {
        routeName: "Quay 869 - Kallo",
        departure: "Quay 869",
        destination: "Kallo",
        basePrice: 380.0,
      },
      {
        routeName: "PSA Quay 869 - Warneton",
        departure: "PSA Quay 869",
        destination: "Warneton",
        basePrice: 450.0,
      },
    ],
  });

  // Route-dependent costs. Keyed by the route itself rather than by a
  // route_pricing row, so they survive a change of Pricing Strategy.
  //
  // The Rotterdam tunnel amount deliberately matches the TUNNEL pricing item
  // already stored for BK-2026-1003, so that historical snapshot finally has a
  // configuration that could have produced it.
  await prisma.routeCost.createMany({
    data: [
      {
        departure: "Quay 869",
        destination: "Rotterdam",
        pricingComponentId: requireComponentId("TUNNEL"),
        amount: 12.5,
        notes: "Liefkenshoek tunnel.",
      },
      {
        departure: "Quay 869",
        destination: "Rotterdam",
        pricingComponentId: requireComponentId("TOLL"),
        amount: 9.75,
      },
      {
        departure: "PSA Quay 869",
        destination: "Dourges",
        pricingComponentId: requireComponentId("TOLL"),
        amount: 18.0,
      },
      {
        departure: "PSA Quay 869",
        destination: "Bousbecque",
        pricingComponentId: requireComponentId("TOLL"),
        amount: 14.25,
      },
    ],
  });

  // Dummy pricing configuration. Real values are intentionally absent from
  // pricing_rules.md, so these exist only to make local runs possible.
  await prisma.setting.createMany({
    data: [
      {
        category: "PRICING",
        key: "PRICING_STRATEGY",
        value: "ROUTE_BASED",
        valueType: "STRING",
        description: "Active pricing strategy (dummy development value).",
      },
      {
        category: "PRICING",
        key: "FUEL_PERCENTAGE",
        value: "15",
        valueType: "DECIMAL",
        description: "Fuel surcharge percentage (dummy development value).",
      },
      {
        category: "PRICING",
        key: "WAITING_TIME_FREE_MINUTES",
        value: "120",
        valueType: "INTEGER",
        description:
          "The first two hours of waiting are never charged. Deducted from the total wait once the threshold is reached.",
      },
      {
        category: "PRICING",
        key: "WAITING_TIME_THRESHOLD_MINUTES",
        value: "150",
        valueType: "INTEGER",
        description:
          "Charging begins at two and a half hours. A shorter wait costs nothing, even where it already exceeds the free allowance.",
      },
      {
        category: "PRICING",
        key: "WAITING_TIME_BLOCK_MINUTES",
        value: "15",
        valueType: "INTEGER",
        description: "Billable waiting is charged per quarter of an hour.",
      },
      {
        category: "PRICING",
        key: "WAITING_TIME_BLOCK_PRICE",
        value: "13.75",
        valueType: "DECIMAL",
        description: "EUR 55.00 per chargeable hour, in quarter-hour blocks.",
      },
      {
        category: "PRICING",
        key: "AUTOMATIC_CUSTOM_PROPERTY_ID",
        value: propertyTar.id,
        valueType: "STRING",
        description:
          "The Custom Property the Pricing Engine applies without anyone assigning it: TAR. Every Trip pays it, except the DELIVERY leg of a genuine Combination — the pair pays it once, on the COLLECTION. The amount is the property's own configured price.",
      },
      {
        category: "PRICING",
        key: "COMBINATION_SURCHARGE",
        value: "50",
        valueType: "DECIMAL",
        description: "Combination surcharge per Trip: both legs receive it.",
      },
      {
        category: "PRICING",
        key: "DISTANCE_RATE_PER_KM",
        value: "2.75",
        valueType: "DECIMAL",
        description:
          "Price per kilometre for Distance-Based Pricing (dummy development value).",
      },
      {
        category: "PRICING",
        key: "PRICING_RULE_VERSION",
        value: "2026.1",
        valueType: "STRING",
        description:
          "Version of the pricing ruleset, stamped onto every calculated snapshot. Bumped when the pricing configuration changes.",
      },
      {
        category: "GENERAL",
        key: "COMPANY_NAME",
        value: "Global Logistic Trans",
        valueType: "STRING",
        description: "Company name shown on exports.",
      },
    ],
  });

  // --- Import chain ------------------------------------------------------

  async function createImportChain(
    bookingNumber: string,
    subject: string,
    daysAgo: number,
  ) {
    const email = await prisma.importedEmail.create({
      data: {
        senderEmail: "orders@eucon.example.com",
        subject,
        messageId: `<${bookingNumber}.${daysAgo}@eucon.example.com>`,
        receivedAt: dayOffset(-daysAgo),
        processedAt: dayOffset(-daysAgo),
        processingStatus: "PROCESSED",
        importType: "NEW",
      },
    });

    const pdf = await prisma.pdfDocument.create({
      data: {
        importedEmailId: email.id,
        importSource: "EMAIL",
        originalFilename: `${bookingNumber}.pdf`,
        storagePath: `/storage/pdf/2026/${bookingNumber}.pdf`,
        fileSizeBytes: BigInt(180_000 + daysAgo * 137),
        fileHash: `sha256-dummy-${bookingNumber}`,
        mimeType: "application/pdf",
        parserVersion: "1.4.0",
      },
    });

    await prisma.parserRun.create({
      data: {
        pdfDocumentId: pdf.id,
        parserVersion: "1.4.0",
        startedAt: dayOffset(-daysAgo),
        finishedAt: dayOffset(-daysAgo),
        durationMs: 820 + daysAgo,
        result: "SUCCESS",
        metadata: {
          detectedLayout: "eucon_trucking_order_v1",
          confidence: 0.97,
          detectedSections: ["header", "transport", "return_terminal"],
        },
      },
    });

    return pdf;
  }

  const pdfClosedOne = await createImportChain(
    "BK-2026-1001",
    "NEW: Trucking Order BK-2026-1001",
    12,
  );
  const pdfCombination = await createImportChain(
    "BK-2026-1002",
    "NEW: Trucking Order BK-2026-1002 Combination",
    9,
  );
  const pdfClosedTwo = await createImportChain(
    "BK-2026-1003",
    "NEW: Trucking Order BK-2026-1003",
    6,
  );
  const pdfOpenOne = await createImportChain(
    "BK-2026-1004",
    "NEW: Trucking Order BK-2026-1004",
    2,
  );
  const pdfOpenTwo = await createImportChain(
    "BK-2026-1005",
    "NEW: Trucking Order BK-2026-1005",
    1,
  );
  const pdfCancelled = await createImportChain(
    "BK-2026-1006",
    "NEW: Trucking Order BK-2026-1006",
    4,
  );

  const parserMetadata = {
    rawTerminal: "Return to Terminal: PSA Quay 869",
    rawAddress: "FR-59166 Bousbecque",
    rawDate: "27.07.2026",
    matchedLabels: ["Booking", "Container", "Startpoint"],
  };

  // --- Trips -------------------------------------------------------------

  const tripClosedOne = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfClosedOne.id,
      vehicleId: truckOne.id,
      status: "CLOSED",
      bookingNumber: "BK-2026-1001",
      containerNumber: "MSCU1234567",
      containerType: "40HC",
      terminal: "PSA Quay 869",
      destinationCity: "Bousbecque",
      destinationCountry: "France",
      originalPlanningDate: dayOffset(-10),
      planningDate: dayOffset(-10),
      startTime: timeOfDay(7, 30),
      endTime: timeOfDay(15, 0),
      executionDatetime: dayOffset(-10),
      waitingTimeMinutes: 90,
      distanceKm: 142.5,
      internalNotes: "Customer confirmed delivery slot by phone.",
      parserMetadata,
    },
  });

  const combinationGroup = await prisma.tripGroup.create({ data: {} });

  // Both Trips of a Combination share the PDF and the Booking Number, but plan
  // independently — different days, different trucks.
  const tripCombinationA = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfCombination.id,
      tripGroupId: combinationGroup.id,
      vehicleId: truckTwo.id,
      status: "CLOSED",
      bookingNumber: "BK-2026-1002",
      containerNumber: "TGHU7654321",
      containerType: "20TK",
      terminal: "PSA Quay 869",
      destinationCity: "Dourges",
      destinationCountry: "France",
      originalPlanningDate: dayOffset(-7),
      planningDate: dayOffset(-7),
      startTime: timeOfDay(6, 0),
      endTime: timeOfDay(14, 30),
      executionDatetime: dayOffset(-7),
      distanceKm: 198.0,
      parserMetadata,
    },
  });

  const tripCombinationB = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfCombination.id,
      tripGroupId: combinationGroup.id,
      vehicleId: truckOne.id,
      status: "OPEN",
      bookingNumber: "BK-2026-1002",
      containerType: "20TK",
      terminal: "PSA Quay 869",
      destinationCity: "Dourges",
      destinationCountry: "France",
      originalPlanningDate: dayOffset(-7),
      planningDate: dayOffset(3),
      startTime: timeOfDay(8, 0),
      endTime: timeOfDay(16, 0),
      internalNotes: "Moved to next week at customer request.",
      parserMetadata,
    },
  });

  const tripClosedTwo = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfClosedTwo.id,
      vehicleId: truckTwo.id,
      status: "CLOSED",
      bookingNumber: "BK-2026-1003",
      containerNumber: "CMAU4455667",
      containerType: "45PH",
      terminal: "Quay 869",
      destinationCity: "Rotterdam",
      destinationCountry: "Netherlands",
      originalPlanningDate: dayOffset(-4),
      planningDate: dayOffset(-4),
      startTime: timeOfDay(9, 0),
      endTime: timeOfDay(17, 0),
      executionDatetime: dayOffset(-4),
      distanceKm: 103.2,
      parserMetadata,
    },
  });

  const tripOpenOne = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfOpenOne.id,
      vehicleId: truckOne.id,
      // Driver override: the vehicle's assigned driver is on another job.
      driverId: driverAhmet.id,
      status: "OPEN",
      bookingNumber: "BK-2026-1004",
      containerType: "20FL",
      terminal: "PSA Quay 869",
      destinationCity: "Antwerp",
      destinationCountry: "Belgium",
      originalPlanningDate: dayOffset(1),
      planningDate: dayOffset(1),
      startTime: timeOfDay(7, 0),
      endTime: timeOfDay(12, 0),
      internalNotes: "Loading — container number follows from the driver.",
      parserMetadata,
    },
  });

  const tripOpenTwo = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfOpenTwo.id,
      vehicleId: truckTwo.id,
      status: "OPEN",
      bookingNumber: "BK-2026-1005",
      containerNumber: "HLXU9988776",
      containerType: "40HC",
      terminal: "PSA Quay 869",
      destinationCity: "Gent",
      destinationCountry: "Belgium",
      originalPlanningDate: dayOffset(2),
      planningDate: dayOffset(2),
      startTime: timeOfDay(10, 0),
      endTime: timeOfDay(16, 30),
      waitingTimeMinutes: 45,
      parserMetadata,
    },
  });

  const tripCancelled = await prisma.trip.create({
    data: {
      pdfDocumentId: pdfCancelled.id,
      status: "CANCELLED",
      bookingNumber: "BK-2026-1006",
      containerType: "20TK",
      terminal: "PSA Quay 869",
      destinationCity: "Lille",
      destinationCountry: "France",
      originalPlanningDate: dayOffset(-1),
      planningDate: dayOffset(-1),
      internalNotes: "Cancelled by customer (CANCEL: email).",
      parserMetadata,
    },
  });

  await prisma.tripCustomProperty.createMany({
    data: [
      { tripId: tripClosedOne.id, customPropertyId: propertyTar.id },
      { tripId: tripClosedTwo.id, customPropertyId: propertyFlat.id },
      {
        tripId: tripOpenTwo.id,
        customPropertyId: propertySintNiklaas.id,
      },
      // Gives the TUNNEL pricing item already stored for this Trip a source:
      // the Trip carries the property, and the route carries the amount.
      { tripId: tripClosedTwo.id, customPropertyId: propertyTunnel.id },
      // An OPEN Trip on a route that has a configured toll. It has no pricing
      // snapshot yet, so it demonstrates the path without contradicting one.
      { tripId: tripCombinationB.id, customPropertyId: propertyToll.id },
    ],
  });

  await prisma.tripHistory.createMany({
    data: [
      {
        tripId: tripClosedOne.id,
        eventType: "TRIP_IMPORTED",
        occurredAt: dayOffset(-12),
        performedBy: "system|imap-service",
        description: "Trip created from NEW: email.",
      },
      {
        tripId: tripClosedOne.id,
        eventType: "CONTAINER_NUMBER_ENTERED",
        occurredAt: dayOffset(-10),
        performedBy: "auth0|dev-administrator",
        newValue: { containerNumber: "MSCU1234567" },
      },
      {
        tripId: tripClosedOne.id,
        eventType: "STATUS_CHANGED",
        occurredAt: dayOffset(-10),
        performedBy: "auth0|dev-administrator",
        previousValue: { status: "OPEN" },
        newValue: { status: "CLOSED" },
      },
      {
        tripId: tripCombinationB.id,
        eventType: "PLANNING_DATE_CHANGED",
        occurredAt: dayOffset(-5),
        performedBy: "auth0|dev-administrator",
        previousValue: { planningDate: dayOffset(-7).toISOString() },
        newValue: { planningDate: dayOffset(3).toISOString() },
        description: "Moved at customer request.",
      },
      {
        tripId: tripOpenOne.id,
        eventType: "DRIVER_CHANGED",
        occurredAt: dayOffset(-1),
        performedBy: "auth0|dev-administrator",
        newValue: { driver: "Ahmet Yilmaz" },
        description: "Override: regular driver unavailable.",
      },
      {
        tripId: tripCancelled.id,
        eventType: "TRIP_CANCELLED",
        occurredAt: dayOffset(-1),
        performedBy: "system|imap-service",
        previousValue: { status: "OPEN" },
        newValue: { status: "CANCELLED" },
      },
    ],
  });

  // --- Pricing (CLOSED Trips only) ---------------------------------------

  const components = await prisma.pricingComponent.findMany();
  const componentByCode = new Map(components.map((c) => [c.code, c]));

  /**
   * The catalog carries both the identity and the position of a component.
   *
   * `display_order` holds the sequence defined in pricing_rules.md, which is
   * exactly what `calculation_order` must record — see database_schema.md §9.2.
   */
  function requireComponent(code: string): { id: string; displayOrder: number } {
    const component = componentByCode.get(code);
    if (!component) {
      throw new Error(
        `Pricing component "${code}" is missing. Run \`pnpm prisma db seed\` first.`,
      );
    }
    return component;
  }

  async function createPricing(
    tripId: string,
    items: {
      code: string;
      description: string;
      amount: number;
      quantity?: number;
      unitPrice?: number;
      customPropertyId?: string;
    }[],
    calculatedAt: Date,
  ): Promise<void> {
    // The stored total must equal the sum of the items — a rule the Backend
    // owns, since PostgreSQL cannot express a cross-table aggregate.
    const totalPrice = items.reduce((sum, item) => sum + item.amount, 0);

    const pricing = await prisma.tripPricing.create({
      data: {
        tripId,
        totalPrice,
        calculatedAt,
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.1",
        calculationStatus: "CALCULATED",
      },
    });

    await prisma.tripPricingItem.createMany({
      data: items.map((item) => {
        const component = requireComponent(item.code);

        return {
          tripPricingId: pricing.id,
          pricingComponentId: component.id,
          customPropertyId: item.customPropertyId,
          description: item.description,
          amount: item.amount,
          // The component's documented position, not the array index: a Trip
          // without a Combination surcharge still numbers Fuel as step 3.
          calculationOrder: component.displayOrder,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        };
      }),
    });
  }

  await createPricing(
    tripClosedOne.id,
    [
      { code: "BASE_PRICE", description: "Antwerp - Bousbecque", amount: 450 },
      { code: "FUEL_SURCHARGE", description: "Fuel 15%", amount: 67.5 },
      {
        code: "WAITING_TIME",
        description: "30 billable minutes",
        amount: 25,
        quantity: 1,
        unitPrice: 25,
      },
      {
        code: "CUSTOM_PROPERTY",
        description: "TAR",
        amount: 35,
        customPropertyId: propertyTar.id,
      },
    ],
    dayOffset(-10),
  );

  await createPricing(
    tripCombinationA.id,
    [
      { code: "BASE_PRICE", description: "Antwerp - Dourges", amount: 520 },
      { code: "COMBINATION", description: "Combination surcharge", amount: 75 },
      { code: "FUEL_SURCHARGE", description: "Fuel 15%", amount: 78 },
    ],
    dayOffset(-7),
  );

  await createPricing(
    tripClosedTwo.id,
    [
      { code: "BASE_PRICE", description: "Antwerp - Rotterdam", amount: 380 },
      { code: "FUEL_SURCHARGE", description: "Fuel 15%", amount: 57 },
      { code: "TUNNEL", description: "Liefkenshoek tunnel", amount: 12.5 },
      {
        code: "CUSTOM_PROPERTY",
        description: "Flat",
        amount: 50,
        customPropertyId: propertyFlat.id,
      },
    ],
    dayOffset(-4),
  );

  // --- Calendar and notes ------------------------------------------------

  await prisma.calendarEvent.createMany({
    data: [
      {
        title: "Quarterly review with Eucon",
        eventType: "MEETING",
        startDate: dayOffset(5),
        startTime: timeOfDay(10, 0),
        endTime: timeOfDay(11, 30),
        color: "#2563eb",
      },
      {
        title: "Tachograph recalibration - 1-GHI-789",
        description: "Vehicle unavailable for planning.",
        eventType: "MAINTENANCE",
        startDate: dayOffset(21),
        startTime: timeOfDay(8, 0),
        endDate: dayOffset(21),
        endTime: timeOfDay(17, 0),
        color: "#ea580c",
      },
      {
        title: "Insurance renewal deadline",
        eventType: "REMINDER",
        startDate: dayOffset(30),
        startTime: timeOfDay(9, 0),
      },
    ],
  });

  await prisma.note.createMany({
    data: [
      {
        title: "Terminal opening hours",
        content:
          "PSA Quay 869: 06:00-22:00 on weekdays, closed Sundays.",
        color: "#f59e0b",
      },
      {
        title: "Pending",
        content:
          "Ask Eucon whether BK-2026-1002 combination trips can be invoiced together.",
      },
    ],
  });

  // --- Summary -----------------------------------------------------------

  const counts = {
    drivers: await prisma.driver.count(),
    vehicles: await prisma.vehicle.count(),
    trailers: await prisma.trailer.count(),
    vehicleAssignments: await prisma.vehicleAssignment.count(),
    vacations: await prisma.vacation.count(),
    maintenance: await prisma.maintenance.count(),
    importedEmails: await prisma.importedEmail.count(),
    pdfDocuments: await prisma.pdfDocument.count(),
    parserRuns: await prisma.parserRun.count(),
    tripGroups: await prisma.tripGroup.count(),
    trips: await prisma.trip.count(),
    tripHistory: await prisma.tripHistory.count(),
    customProperties: await prisma.customProperty.count(),
    tripCustomProperties: await prisma.tripCustomProperty.count(),
    tripPricing: await prisma.tripPricing.count(),
    tripPricingItems: await prisma.tripPricingItem.count(),
    routePricing: await prisma.routePricing.count(),
    routeCosts: await prisma.routeCost.count(),
    settings: await prisma.setting.count(),
    calendarEvents: await prisma.calendarEvent.count(),
    notes: await prisma.note.count(),
  };

  console.log("\nDummy data created:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(22)} ${count}`);
  }
  console.log("\nDevelopment seed completed.");
}

main()
  .catch((error: unknown) => {
    console.error("Development seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
