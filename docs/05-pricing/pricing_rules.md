# Pricing Rules

## Purpose

This document defines the business rules governing how transport pricing is calculated.

It intentionally does **not** define actual prices, percentages or monetary values.

All configurable values must be stored in the application's Settings.

The Pricing Engine reads the current Settings during every calculation.

This document only defines:

- when pricing is calculated
- which pricing components exist
- the calculation order
- business constraints
- recalculation behaviour

Actual monetary values are documented elsewhere.

---

# Design Principles

The Pricing Engine must be:

- deterministic
- configurable
- reproducible
- auditable
- extensible

Pricing calculations should never contain hardcoded business values.

Every configurable value must come from Settings.

---

# Pricing Lifecycle

Pricing is **not** calculated continuously.

Pricing is only calculated when one of the following events occurs.

## Event 1

Trip is marked as **Finished**.

↓

Pricing Engine executes.

↓

Pricing is stored.

---

## Event 2

Administrator selects:

**Actions → Reprocess Pricing**

↓

Pricing Engine executes again.

↓

Existing pricing is replaced by a newly calculated result.

---

No other action should trigger pricing calculations.

---

# Immutable Pricing

Once pricing has been calculated, the result remains unchanged.

Changing application settings must **never** modify existing pricing automatically.

Historical pricing must remain reproducible.

Example

Trip finished today.

Fuel percentage = 15%.

Tomorrow the Administrator changes Fuel percentage to 18%.

The finished Trip keeps using 15%.

Only a manual **Reprocess Pricing** recalculates using the latest Settings.

---

# Pricing Strategy

The application should support multiple pricing strategies.

The active strategy is configured in Settings.

Supported strategies include:

- Route-based pricing
- Distance-based pricing

Only one pricing strategy is active at a time.

Additional strategies may be introduced in future versions.

---

# Route-Based Pricing

The base transport price is determined by a configured transport route.

Example

Terminal A

↓

Destination B

↓

Configured Base Price

The actual prices are stored in the database.

They are not hardcoded.

---

# Distance-Based Pricing

The base transport price is calculated using:

Distance

×

Configured Price per Distance Unit

The calculation method is configurable.

---

# Pricing Order

Pricing components must always be calculated in the following order.

1. Base Route Price

2. Combination Surcharge

3. Fuel Surcharge

4. Waiting Time

5. Toll Costs

6. Tunnel Costs

7. Custom Properties

8. Manual Adjustments

9. Final Total

Changing this order may produce different pricing results.

The Pricing Engine must always follow this sequence.

---

# Base Price

Every Trip begins with exactly one Base Price.

The Base Price is determined using the active Pricing Strategy.

The Base Price forms the foundation of the pricing calculation.

---

# Combination Surcharge

Trips belonging to a Combination may receive an additional surcharge.

The surcharge is configurable.

The surcharge amount is determined through Settings.

Only Trips belonging to a TripGroup are eligible.

---

# Fuel Surcharge

Fuel is calculated as a percentage.

The percentage is configurable.

Fuel is calculated **only on the Base Price**.

Fuel must never be calculated on:

- Waiting Time
- Toll
- Tunnel
- Manual Adjustments
- Custom Property additions

---

# Waiting Time

Waiting Time is entered manually by the Administrator.

The Pricing Engine never calculates waiting time automatically.

The first configurable waiting period is free.

Only the remaining waiting time is billable.

Billable waiting time is charged in configurable time blocks.

## Settings

Three Settings govern the calculation. All three live in the PRICING category.

| Key | Value type | Unit | Meaning |
|---|---|---|---|
| `WAITING_TIME_FREE_MINUTES` | INTEGER | minutes | The free allowance granted before any waiting time becomes billable. |
| `WAITING_TIME_BLOCK_MINUTES` | INTEGER | minutes | The size of one billable block. |
| `WAITING_TIME_BLOCK_PRICE` | DECIMAL | EUR per block | The price charged for one billable block. |

`WAITING_TIME_FREE_MINUTES` is zero or greater. A value of zero means no free
allowance: waiting is billable from the first minute.

`WAITING_TIME_BLOCK_PRICE` is zero or greater, because negative pricing is not
supported. A value of zero means waiting time is recorded and reported but never
charged.

`WAITING_TIME_BLOCK_MINUTES` must be **greater than zero**. This is a
configuration validation rule rather than a business rule: the value is the
divisor that converts billable minutes into blocks, so zero leaves the
calculation undefined. The application rejects it when the Setting is updated,
and the Pricing Engine refuses to calculate if such a value somehow reaches it.

## How the free period interacts with the blocks

The free allowance is applied **first**, and only what remains is divided into
blocks. The two Settings are applied in that order and never the reverse.

The free allowance is a deduction, not a threshold. Waiting time that exceeds
the allowance is charged only for the excess; the allowance itself is never
billed, however long the total wait becomes.

Waiting time equal to or below the free allowance produces nothing billable.

## How a partial block is charged

Every block that is **started** is charged in full.

Billable minutes that do not fill a whole block still cost one whole block. One
minute beyond the free allowance therefore costs the same as a full block.

## When a Waiting Time line is produced

A Waiting Time pricing line is produced only when at least one billable block
exists.

A Trip with no recorded waiting time, or with waiting time within the free
allowance, carries no Waiting Time line at all — the component did not apply.

A Trip with at least one billable block always carries a line, including when
`WAITING_TIME_BLOCK_PRICE` is zero. That line records an amount of zero: the
waiting time was charged, at nothing.

## Recorded values

The pricing line records the number of blocks as its quantity and the configured
block price as its unit price, so the charge can be read back without
recalculating it.

Waiting time that is not recorded on a Trip counts as zero minutes.

The formula is defined in `pricing_formula.md` and worked through in
`pricing_examples.md`.

---

# Toll and Tunnel Costs

Toll and Tunnel are **route-dependent** costs.

They share one rule, stated once here rather than twice, because they differ
only in which Pricing Component they use.

Whether they apply is decided per Trip.

How much they cost is decided by the route.

These two decisions are configured separately, and the Pricing Engine combines
them:

Trip

↓

TripCustomProperty — whether the cost applies

↓

RouteCost — how much it costs on this route

↓

TripPricingItem

## Applicability

A route-dependent cost applies to a Trip when the corresponding Custom Property
is assigned to that Trip.

Assignment uses the same mechanism as every other optional Trip feature. The
Administrator ticks Toll or Tunnel on the Trip exactly as they would tick TAR or
Flat.

A Custom Property that represents a route-dependent cost references a Pricing
Component and defines no price of its own. See `database_model.md` §4.12.

## Amount

The amount comes from the RouteCost configured for the Trip's route and that
Pricing Component.

The route is the Trip's Terminal and Destination City, resolved the same way
whichever Pricing Strategy is active. A route-dependent cost is incurred
regardless of how the base price was calculated.

The amount is never taken from the Custom Property, which carries none.

## Missing Configuration

If a route-dependent cost is assigned to a Trip and no active RouteCost exists
for that route and component, the calculation **fails**.

The cost is never skipped and never priced as zero.

The Administrator stated the cost applies; pricing the Trip without it would
understate the total with no visible cause. A missing amount is missing
configuration, not a price of zero.

The same applies when the Trip has no resolvable route.

## Classification

Each route-dependent cost is classified by its own Pricing Component and appears
at that component's position in the pricing sequence — Toll at 5 and Tunnel at
6, never at the Custom Property position.

Route-dependent costs are added directly to the total. Fuel is never calculated
on them.

The formula is defined in `pricing_formula.md` and worked through in
`pricing_examples.md`.

---

# Custom Properties

Trips may contain zero or more Custom Properties.

Each Custom Property may define an additional pricing component.

Examples include:

- TAR
- Flat
- Over Sint-Niklaas

The Pricing Engine should never hardcode these properties.

Instead:

Trip

↓

TripCustomProperty

↓

CustomProperty

↓

Configured Pricing

The engine simply processes every assigned Custom Property.

---

# Manual Adjustments

The Administrator may manually add pricing adjustments.

Each adjustment contains:

- Description
- Amount

Manual Adjustments are always positive amounts.

Negative pricing adjustments are currently not supported.

Every Manual Adjustment becomes its own Pricing Item.

---

# Pricing Components

Every pricing component is stored individually.

Examples include:

- Base Price
- Fuel
- Waiting Time
- Toll
- Tunnel
- Custom Property
- Manual Adjustment

The Final Total is the sum of all Pricing Components.

---

# Trip Pricing

Each Trip has exactly one active pricing result.

The pricing result contains:

- Total Price
- Calculation Timestamp
- Pricing Version
- Calculation Status

Detailed calculation steps are stored separately.

---

# Trip Pricing Items

Every pricing component is stored as an individual Pricing Item.

This provides:

- transparency
- auditing
- debugging
- reporting

New pricing components should not require database changes.

---

# Settings

The following values are configurable through Settings.

Examples include:

- Pricing Strategy
- Fuel Percentage
- Waiting Time Free Period
- Waiting Time Billing Interval
- Waiting Time Block Price
- Combination Surcharge
- Route Prices
- Route Costs (Toll, Tunnel)
- Distance Rate
- Custom Property Prices
- Pricing Rule Version

Actual values are intentionally excluded from this document.

## Pricing Rule Version

`PRICING_RULE_VERSION` (STRING, PRICING category) records which version of the
ruleset a calculation ran against. It is stamped onto every stored snapshot as
`trip_pricing.pricing_rule_version`.

It is configuration rather than code: an administrator bumps it when the pricing
Settings change, so it travels with the rules it describes. It is distinct from
`trip_pricing.pricing_engine_version`, which records the version of the Pricing
Engine code that produced the snapshot and is maintained in the source. Two
snapshots may share an engine version and differ in rule version, or the
reverse; keeping the two apart is what makes a disputed calculation explainable.

Changing this Setting never alters an existing snapshot. Only an explicit
Reprocess Pricing produces a new one.

---

# Export

Exported Excel files should contain:

- Base Price
- Fuel
- Waiting Time
- Toll
- Tunnel
- Every Custom Property
- Manual Adjustments
- Final Total

The exported pricing should match the stored pricing exactly.

---

# Reprocessing

When the Administrator selects:

Actions → Reprocess Pricing

The Pricing Engine should:

1. Read the latest Settings.
2. Recalculate the pricing.
3. Replace the previous pricing result.
4. Preserve the previous pricing in history (future extension).

No Trip planning information should be modified.

---

# Business Constraints

Pricing is always calculated in EUR.

Negative pricing is not supported.

Pricing is never calculated automatically after Settings change.

Historical pricing remains unchanged until manually reprocessed.

The Pricing Engine should never modify:

- Driver
- Vehicle
- Planning Date
- Waiting Time
- Notes
- Container Number

Pricing only produces pricing data.

---

# Future Extensions

The Pricing Engine should remain compatible with future features such as:

- Customer-specific pricing
- Customer discounts
- Country surcharges
- Weekend surcharges
- Night surcharges
- Holiday pricing
- Automatic route pricing
- Dynamic fuel index
- Multiple currencies
- VAT support
- Invoice generation
- Pricing history
- Pricing approval workflow