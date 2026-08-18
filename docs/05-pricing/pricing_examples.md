# Pricing Examples

Worked examples for each pricing component.

Every example applies the formula defined in `pricing_formula.md` under the
business rules defined in `pricing_rules.md`. Where an example and a rule appear
to disagree, the rule is correct and the example is a defect.

Configured values shown here are the development values used by the seed. They
are examples, not official prices.

---

# Waiting Time

## Configuration used in these examples

These examples illustrate the FORMULA, so they use a deliberately simple
configuration rather than the one the business currently runs:

| Setting | Value |
|---|---|
| `PRICING.WAITING_TIME_THRESHOLD_MINUTES` | `0` |
| `PRICING.WAITING_TIME_FREE_MINUTES` | `60` |
| `PRICING.WAITING_TIME_BLOCK_MINUTES` | `30` |
| `PRICING.WAITING_TIME_BLOCK_PRICE` | `25.00` |

A threshold of zero means charging begins as soon as the allowance is exceeded,
which is what examples 1 to 10 below show. Examples 9 and 10 override one of the
other values, as noted, and examples 11 to 14 show the threshold in use.

The configuration the business actually runs — a 150-minute threshold, a
120-minute allowance, 15-minute blocks at 13.75 — is set out in
`pricing_rules.md`.

## Examples

| # | Case | `waited` | `billableMinutes` | `blocks` | Amount | Line produced |
|---|---|---|---|---|---|---|
| 1 | No waiting time recorded | not recorded | 0 | 0 | — | no |
| 2 | Zero waiting time | 0 | 0 | 0 | — | no |
| 3 | Below the free allowance | 45 | 0 | 0 | — | no |
| 4 | Exactly the free allowance | 60 | 0 | 0 | — | no |
| 5 | One billable block | 90 | 30 | 1 | 25.00 | yes |
| 6 | Multiple billable blocks | 180 | 120 | 4 | 100.00 | yes |
| 7 | Partial block rounds up | 105 | 45 | 2 | 50.00 | yes |
| 8 | One minute over the allowance | 61 | 1 | 1 | 25.00 | yes |
| 9 | Zero block price (`blockPrice = 0.00`) | 90 | 30 | 1 | 0.00 | yes |
| 10 | No free allowance (`free = 0`) | 10 | 10 | 1 | 25.00 | yes |

With `threshold = 150`, `free = 120`, `blockMinutes = 15` and
`blockPrice = 13.75` — the business configuration:

| # | Case | `waited` | `billableMinutes` | `blocks` | Amount | Line produced |
|---|---|---|---|---|---|---|
| 11 | Past the allowance, short of the threshold | 135 | 0 | 0 | — | no |
| 12 | One minute short of the threshold | 149 | 0 | 0 | — | no |
| 13 | Exactly the threshold | 150 | 30 | 2 | 27.50 | yes |
| 14 | A full extra hour | 180 | 60 | 4 | 55.00 | yes |

## Notes

**Examples 11 and 12** are the reason the threshold exists. Both waits exceed
the 120-minute allowance and neither is charged: the allowance alone would have
billed a block for each.

**Example 13** shows that the threshold is not the deduction. At 150 minutes the
charge covers the 30 minutes past the ALLOWANCE, not the 0 minutes past the
threshold.

**Examples 1 and 2** are identical in outcome. Waiting time that was never
recorded and waiting time explicitly recorded as zero are both zero minutes.

**Examples 3 and 4** show the free allowance is inclusive: waiting exactly the
allowance produces nothing billable.

**Example 5** is the case stored in the development seed for booking
BK-2026-1001. The Trip records 90 minutes waited; 30 are billable; that is one
block at 25.00.

**Example 6** shows the allowance is deducted once, not per block: 180 minutes
waited gives 120 billable minutes and four blocks, not five.

**Example 7** is the rounding case. 45 billable minutes is one and a half
blocks; the second block was started, so both are charged. The customer pays
50.00 for 45 minutes of billable waiting.

**Example 8** shows the consequence of charging started blocks: one minute
beyond the allowance costs a whole block, the same as example 5's thirty
minutes.

**Example 9** distinguishes a priced zero from an absent charge. Blocks were
billable, so a line exists; the configured price was zero, so the amount is
zero. Contrast with examples 1 to 4, which produce no line at all.

**Example 10** shows a system configured without a free allowance. Every
recorded minute is billable, and the first minute already costs a full block.

## Invalid configuration

`WAITING_TIME_BLOCK_MINUTES = 0` is not an example, because it has no result.
Zero is rejected when the Setting is updated, and the Pricing Engine refuses to
calculate if such a value somehow reaches it. See `pricing_rules.md`.

---

# Toll and Tunnel

## Configuration used in these examples

Custom Properties:

| Name | Pricing Component | Default Price |
|---|---|---|
| `Toll` | `TOLL` | none — route-priced |
| `Tunnel` | `TUNNEL` | none — route-priced |
| `TAR` | none — fixed-price | `35.00` |

RouteCost:

| Departure | Destination | Component | Amount |
|---|---|---|---|
| `PSA Antwerp` | `Dourges` | `TOLL` | `18.00` |
| `MSC PSA European Terminal` | `Rotterdam` | `TUNNEL` | `12.50` |
| `MSC PSA European Terminal` | `Rotterdam` | `TOLL` | `9.75` |

## Examples

| # | Case | Trip route | Assigned | Result |
|---|---|---|---|---|
| 1 | Not assigned | any | — | no line |
| 2 | Toll applies | PSA Antwerp → Dourges | Toll | `TOLL` line, order 5, `18.00` |
| 3 | Tunnel applies | MSC PSA European Terminal → Rotterdam | Tunnel | `TUNNEL` line, order 6, `12.50` |
| 4 | Both apply | MSC PSA European Terminal → Rotterdam | Toll, Tunnel | two lines: `9.75` at order 5, `12.50` at order 6 |
| 5 | Assigned, route not configured | PSA Antwerp → Lille | Toll | **calculation fails** |
| 6 | Assigned, wrong component configured | PSA Antwerp → Dourges | Tunnel | **calculation fails** — that route has a TOLL cost, not a TUNNEL cost |
| 7 | Assigned, no terminal on the Trip | ? → Gent | Toll | **calculation fails** — the route cannot be resolved |
| 8 | Mixed with a fixed-price property | PSA Antwerp → Dourges | Toll, TAR | `TOLL` `18.00` at order 5 and `CUSTOM_PROPERTY` `35.00` at order 7 |
| 9 | Zero configured cost | route with `TOLL` = `0.00` | Toll | `TOLL` line of `0.00` |
| 10 | Distance-based strategy | PSA Antwerp → Dourges | Toll | `TOLL` line, `18.00` — unchanged by the strategy |

## Notes

**Example 1** shows that a route with a configured cost charges nothing unless
the Trip is assigned the property. Configuration alone never creates a charge.

**Example 4** shows the two components are independent. One route may carry
both, and each produces its own line at its own position.

**Examples 5, 6 and 7** are the three ways the calculation fails. All three mean
the Administrator stated a cost applies and the system cannot determine its
amount. None of them produces a line, and none of them produces a zero.

**Example 8** shows the two kinds of Custom Property side by side on one Trip.
`Toll` is classified `TOLL` at order 5 and takes its amount from the route;
`TAR` is classified `CUSTOM_PROPERTY` at order 7 and takes its amount from its
own default price. Only the `TAR` line carries a Custom Property reference.

**Example 9** distinguishes a configured zero from missing configuration. A
route may legitimately have no toll charge while still being configured, and
that is recorded as a line of `0.00`. Contrast with example 5, where nothing is
configured and the calculation fails.

**Example 10** shows route costs are independent of the Pricing Strategy. The
base price would be calculated from distance, and the toll is unchanged.

## Interaction with the Fuel Surcharge

Fuel is calculated on the Base Price alone. A toll or tunnel charge never enters
the fuel base, whatever its amount. See `pricing_rules.md`.
