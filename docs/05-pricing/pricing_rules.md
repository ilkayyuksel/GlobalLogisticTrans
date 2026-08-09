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

Both:

- free period
- billing interval

are configurable through Settings.

---

# Toll Costs

Trips may include Toll Costs.

Toll Costs are added directly to the total.

They are configurable per Trip.

---

# Tunnel Costs

Trips may include Tunnel Costs.

Tunnel Costs are added directly to the total.

They are configurable per Trip.

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
- Combination Surcharge
- Route Prices
- Distance Rate
- Custom Property Prices

Actual values are intentionally excluded from this document.

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