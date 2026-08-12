## Pricing

The Pricing Engine is intentionally not finalized.

The current schema only defines the required entities.

Detailed calculation logic will be documented in:

pricing_rules.md

pricing_formula.md

pricing_examples.md

Once finalized, the database schema may be extended without breaking the existing model.

---

# Purpose of this document

This document defines the **formal formula** of each pricing component.

It defines only how a value is computed.

The business rules that decide *when* a component applies are defined in
`pricing_rules.md`.

Worked examples are in `pricing_examples.md`.

---

# Waiting Time

## Inputs

| Symbol | Source | Type |
|---|---|---|
| `waited` | `trip.waiting_time_minutes` | whole minutes; not recorded counts as `0` |
| `free` | Setting `PRICING.WAITING_TIME_FREE_MINUTES` | whole minutes, `>= 0` |
| `blockMinutes` | Setting `PRICING.WAITING_TIME_BLOCK_MINUTES` | whole minutes, `> 0` |
| `blockPrice` | Setting `PRICING.WAITING_TIME_BLOCK_PRICE` | EUR, `>= 0` |

## Formula

```
billableMinutes = max(0, waited - free)
blocks          = ceil(billableMinutes / blockMinutes)
amount          = blocks * blockPrice
```

A pricing line is produced only when `blocks >= 1`.

## Produced line

| Line field | Value |
|---|---|
| Component | `WAITING_TIME` |
| Calculation order | `4` |
| Quantity | `blocks` |
| Unit price | `blockPrice` |
| Amount | `amount` |

## Rounding

Two roundings occur, and they are not the same thing.

**The block count is rounded up.** `ceil` is where the block size takes effect:
it is what makes a started block cost a whole block. This rounding changes the
price.

**The amount is rounded half-up to two decimals, once.** Because `blocks` is a
whole number and `blockPrice` carries at most two decimals, their product
already has at most two decimals — so for Waiting Time this rounding never
changes a value. It is applied as a guarantee that the line matches the
precision of the column that stores it, not as part of the calculation.

No intermediate value is rounded. `billableMinutes` is exact whole minutes, and
`blocks` is rounded once, before the multiplication.

## Examples

Worked examples for every case, including no waiting time, waiting below and
exactly at the free allowance, one and multiple billable blocks, partial-block
rounding and a zero block price, are in `pricing_examples.md`.

---

# Toll and Tunnel

Both components share one formula. They differ only in which Pricing Component
identifies them.

## Inputs

| Symbol | Source | Type |
|---|---|---|
| `applies` | a Custom Property referencing this component is assigned to the Trip | boolean |
| `departure` | `trip.terminal` | text; may be absent |
| `destination` | `trip.destination_city` | text |
| `routeCost` | active `route_cost` for `(departure, destination, component)` | EUR, `>= 0`; may be absent |

## Formula

```
if not applies        -> no line
if no departure       -> fail: the route cannot be resolved
if no routeCost       -> fail: the amount is not configured
amount = routeCost
```

There is no arithmetic. The configured amount reaches the breakdown unchanged.

A line is produced only when the component applies, and when it applies the
calculation either produces that line or fails. It never produces a line of
zero in place of a missing amount.

## Produced line

| Line field | Toll | Tunnel |
|---|---|---|
| Component | `TOLL` | `TUNNEL` |
| Calculation order | `5` | `6` |
| Quantity | `null` | `null` |
| Unit price | `null` | `null` |
| Amount | `routeCost` | `routeCost` |

Quantity and unit price stay empty because the charge is a flat amount for the
route, not a rate applied to a measured quantity.

The pricing line does **not** reference the Custom Property that made it apply.
The component identifies the line, and the Custom Property is a one-to-one
consequence of it, so the reference would carry no information the line does not
already hold. See `database_model.md` §4.12.

## Rounding

The amount is rounded half-up to two decimals, once, in the same way as every
other component. Because it is copied from a two-decimal configured value, this
rounding never changes it; it is applied so the line guarantees its own
precision.

## Examples

Worked examples, including an applied cost, a cost that does not apply, an
unconfigured route and an unresolvable route, are in `pricing_examples.md`.
