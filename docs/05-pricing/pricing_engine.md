# Pricing Engine

## Purpose

The Pricing Engine is responsible for calculating all financial information related to a trip.

The Pricing Engine is a dedicated microservice.

Its only responsibility is calculating prices.

It never:

- imports PDFs
- parses PDFs
- manages planning
- stores trips
- modifies trips
- renders UI

---

# General Principles

The Pricing Engine always receives validated Trip data.

It calculates all pricing using the current pricing configuration.

The Pricing Engine should always produce deterministic results.

The same input should always produce the same output.

---

# Responsibilities

The Pricing Engine is responsible for:

Calculating tariffs

Applying custom property costs

Applying waiting time costs

Applying fuel surcharge

Applying combination rules

Applying tunnel costs

Applying ferry costs

Applying additional costs

Calculating totals

Producing pricing breakdowns

---

# Responsibilities of Other Services

Parser

Extracts information.

Backend

Stores trips.

Calls the Pricing Engine.

Frontend

Displays pricing.

Settings

Manage pricing configuration.

---

# Input

The Pricing Engine receives a complete Trip object.

Example information includes:

Booking Number

Container Type

Planning Date

Original Date

Driver

Vehicle

Route

Terminal

Address

Custom Properties

Waiting Time

Trip Type

Combination Information

Manual Overrides

Current Settings

The engine should never query PDFs.

---

# Output

The Pricing Engine returns a complete pricing result.

The result includes:

Tariff

Fuel

Waiting Cost

Tunnel Cost

Additional Costs

Other Costs

Total

Calculation Details

Warnings

---

# Pricing Flow

Trip

↓

Validation

↓

Pricing Rules

↓

Formula Calculation

↓

Pricing Breakdown

↓

Final Total

↓

Stored in Database

---

# Pricing Rules

The Pricing Engine never contains hardcoded business values.

All calculations must originate from configurable pricing rules.

Changing a pricing rule should immediately affect future calculations.

Previously calculated trips should only change after a manual recalculation.

---

# Recalculation

## Manual recalculation

The Administrator can manually recalculate pricing.

Recalculation uses:

Current Pricing Rules

Current Fuel Percentage

Current Custom Property Configuration

Current Waiting Time Rules

Parser information is not modified.

Planning information is not modified.

## Automatic recalculation after a Trip input changes

Three writes change what a Trip is worth without touching its status, and each
of them recalculates the Trip and answers with the result:

Assigning or removing a Custom Property

Entering, changing or clearing a Waiting Time window

Recording a Cost Confirmation

The recalculation is AWAITED. It is never fire-and-forget: a response that
returned before the Engine finished would carry the figures from before the
change, and no screen can tell those from current ones.

Only a change to the Trip's OWN inputs triggers this. A change to global
configuration — the fuel percentage, the TAR price, the waiting-time rules —
never reprices a historical CLOSED Trip. Manual recalculation is how an
Administrator applies new configuration.

The Trip's status is never touched. A CLOSED Trip stays CLOSED: the price of a
finished job may change, the fact that it is finished may not.

## The failure contract

The underlying write and the recalculation are separate concerns, and a pricing
problem never undoes a write:

The write is KEPT. It succeeded, and the endpoint answers 2xx.

`pricing` is null and `reasonCode` carries a stable machine-readable code —
PRICING_MISSING_ROUTE_PRICING, PRICING_TRIP_NOT_CLOSED and the rest.

The PREVIOUS figures are never returned. They describe the Trip before the
change, and presenting them as current would be a stale amount that nothing on
the screen reveals. The Ritten row shows the empty marker instead.

Nothing is rolled back, and the Trip is never reopened.

A Trip whose route has no configured price is an ORDINARY state on this data,
not an edge case. Refusing the operator's edit until an administrator configures
the route would block the work rather than the price.

## Dependency direction

The three domains that trigger a recalculation depend on the Pricing Engine.
The Engine does not depend on them in return: it reads Trips, assignments and
confirmed costs through narrow READ modules that depend on nothing but the
database.

    TripCustomPropertyModule ─┐                ┌─> TripReadModule
    CostConfirmationModule ───┼─> PricingEngine┼─> CostConfirmationReadModule
    TripModule ───────────────┘       │        └─> TripCustomPropertyReadModule
                                      └─> TripPricingModule ─> TripReadModule

A read module must never import the Pricing Engine, and no cycle may be hidden
behind a lazy reference.

Closing a Trip still prices it through an EVENT rather than a call, so the
planning domain does not know that closing produces a price. Recalculating after
an input change is a direct call because the caller must WAIT for the answer and
return it.

---

# Manual Changes

The Pricing Engine never changes:

Driver

Vehicle

Planning Date

Booking Number

Container Number

PDF

Trip Group

Status

Notes

The engine only calculates prices.

---

# Pricing Breakdown

Every calculation should produce a detailed breakdown.

Example:

Tariff

Fuel

Tunnel

Waiting Time

Custom Property

Other Costs

Total

The UI should display this breakdown.

The Excel export should use the same breakdown.

---

# Formula Execution

Pricing calculations are executed in a fixed order.

Validation

↓

Base Tariff

↓

Combination Rules

↓

Waiting Time

↓

Custom Properties

↓

Fuel

↓

Additional Costs

↓

Total

The order should remain consistent.

---

# Versioning

Every pricing calculation should store:

Pricing Engine Version

Pricing Rule Version

Calculation Timestamp

This allows historical calculations to be reproduced.

---

# Logging

Every calculation should be logged.

Log:

Trip ID

Pricing Version

Calculation Time

Execution Duration

Warnings

Errors

Never log confidential information.

---

# Error Handling

Calculation failures should never crash the application.

If pricing fails:

Return a structured error.

Log the failure.

Leave the trip unchanged.

Allow the Administrator to retry.

---

# Performance

The Pricing Engine should calculate trips independently.

Multiple trips may be calculated in parallel.

Combination trips should still produce two independent pricing results.

---

# Extensibility

Future pricing features should be added as new pricing rules.

The Pricing Engine architecture should remain unchanged.

Examples of future rules:

Night surcharge

Weekend surcharge

Holiday surcharge

Country surcharge

Customer-specific tariffs

CO₂ surcharge

Dynamic fuel calculation

The engine should support unlimited future rules.

---

# Responsibilities

Pricing Engine

Calculates prices.

Backend

Stores pricing results.

Frontend

Displays pricing.

Settings

Configure pricing behaviour.

The Pricing Engine never performs business logic unrelated to pricing.