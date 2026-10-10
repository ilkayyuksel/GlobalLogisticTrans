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

The Combination Surcharge — the Backload — is charged to every Trip that belongs
to a TripGroup: its own surcharge, on its own pricing snapshot. An imported
Combination and a group an operator made by hand are treated alike, and so is a
Trip left alone in its group after its partner was unlinked. A Trip in no group
is charged none.

The surcharge is configurable. The amount is determined through Settings
(`COMBINATION_SURCHARGE`).

A group of two therefore carries two surcharges, one per Trip. Nothing depends on
the partner Trip — its status, its planning date, or whether it is in the same
export.

Group membership is a pricing input. Grouping and unlinking reprice every CLOSED
Trip whose group changed at once, replacing its snapshot: a Trip that joins a
group has exactly one surcharge line afterwards, however often it is repriced,
and a Trip that leaves has none. An OPEN Trip is priced when it closes, from the
group it is in by then. The Ritten list and the BASIS export only show the stored
line; neither decides it. In BASIS the amount comes first in COMBI EN KOST
(`50.00`, or `50.00 + 55.00` with other costs) and INFO says `COMBI` — both
read from that line, so a Trip without it shows neither.

This replaces an earlier rule under which only a genuine Combination — one
document, two legs — carried the surcharge. The genuine rule still decides where
TAR belongs; see below.

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

Waiting time is charged only once it reaches a configured **threshold**. Below
that threshold nothing is charged at all.

From the threshold upwards, a configured **free allowance** is deducted and only
what remains is billable.

Billable waiting time is charged in configurable time blocks.

## Which minutes are waiting time

The waiting time the rules below apply to is the COUNTED time of the window the
operator entered: only the part inside 06:00 → 20:00 on each day the window
touches. A window may end the next day ("Volgende dag").

| Window | Counted |
|---|---:|
| 10:00 → 12:00, same day | 120 min |
| 05:00 → 07:00, same day | 60 min |
| 10:00 → 08:00, next day | 720 min |
| 10:00 → 12:00, next day | 960 min |
| 22:00 → 02:00, next day | 0 min |

The 06:00 → 20:00 window is fixed and is not a Setting. It decides how long the
truck waited, never what that costs: the counted minutes are stored as
`waiting_time_minutes` when the Trip is written, and the Pricing Engine prices
that value with the threshold, allowance and blocks below, exactly as before.
See `database_model.md`, "Waiting Time".

## Settings

Four Settings govern the calculation. All four live in the PRICING category.

| Key | Value type | Unit | Meaning |
|---|---|---|---|
| `WAITING_TIME_THRESHOLD_MINUTES` | INTEGER | minutes | The wait at which charging begins. A shorter wait is never charged. |
| `WAITING_TIME_FREE_MINUTES` | INTEGER | minutes | The allowance deducted from the total wait once the threshold is reached. |
| `WAITING_TIME_BLOCK_MINUTES` | INTEGER | minutes | The size of one billable block. |
| `WAITING_TIME_BLOCK_PRICE` | DECIMAL | EUR per block | The price charged for one billable block. |

`WAITING_TIME_THRESHOLD_MINUTES` is zero or greater. A value of zero means there
is no threshold, and charging begins as soon as the free allowance is exceeded.

## The configured rule

The business currently configures:

| Setting | Value |
|---|---|
| `WAITING_TIME_THRESHOLD_MINUTES` | `150` (2h30) |
| `WAITING_TIME_FREE_MINUTES` | `120` (2h00) |
| `WAITING_TIME_BLOCK_MINUTES` | `15` |
| `WAITING_TIME_BLOCK_PRICE` | `13.75` |

which is EUR 55.00 per chargeable hour, stated as a quarter-hour block price.

In words:

**Below 150 minutes there is no Waiting Time line at all.** A wait of 2h15 is
entirely free even though it already exceeds the two-hour allowance.

**From 150 minutes upwards**, the chargeable minutes are the total wait less the
120-minute allowance, and those minutes are then charged by the block rule
below.

| Waiting | Chargeable minutes | Amount |
|---:|---:|---:|
| 0:00 – 2:29 | — | no line |
| 2:30 | 30 | 27.50 |
| 2:45 | 45 | 41.25 |
| 3:00 | 60 | 55.00 |
| 3:15 | 75 | 68.75 |
| 3:30 | 90 | 82.50 |

## The threshold and the allowance are two different rules

The threshold decides **whether** waiting is charged. The allowance decides
**how much** of it is chargeable once it is. Both apply, in that order, and
neither can express the other:

- without the threshold, 2h15 would cost one block;
- without the allowance, 2h30 would be charged for its full two and a half
  hours rather than for the thirty minutes past the allowance.

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

The free allowance is a deduction. Waiting time that exceeds it is charged only
for the excess; the allowance itself is never billed, however long the total
wait becomes.

The threshold is separate and is applied first: a wait short of it produces
nothing billable even when it exceeds the allowance.

Waiting time equal to or below the free allowance produces nothing billable.

## How a partial block is charged

Every block that is **started** is charged in full.

Billable minutes that do not fill a whole block still cost one whole block. One
minute beyond the free allowance therefore costs the same as a full block.

## When a Waiting Time line is produced

A Waiting Time pricing line is produced only when at least one billable block
exists.

A Trip with no recorded waiting time, with waiting time below the threshold, or
with waiting time within the free allowance, carries no Waiting Time line at
all — the component did not apply.

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

# Which Configured Route a Trip Prices Against

A road may be configured **twice**:

- as an **ordinary route**, and
- as a **leg of a Combination route**, priced for itself because a Combination's
  outbound and return are their own transports and legitimately cost different
  amounts.

Both are legitimate and neither is a duplicate of the other. A Combination route
configuration is always exactly two legs, each with its own Tarief, distance and
tunnel, held together by a `combination_route_group` row — see
`database_schema.md` §8.1 and §8.1.1.

> This is route **configuration**. It is not a `trip_group`: that decides which
> Trips carry the €50 Backload, and nothing in it is read here.

## How a road is matched

One matcher — `route-pricing/route-matcher.ts` — for every trigger: closing,
closing again, every repricing edit, (un)grouping, a planning-date change and an
explicit reprocess all price through the Engine, and the Engine asks the matcher.
There is no per-trigger route selection.

**The road** is the Trip's real driving direction (`toTripRoute`): a DELIVERY
drives terminal → city, a COLLECTION city → terminal, a Trip without a direction
terminal → city. A route is configured the way it is driven, so a collection's
route is configured city → terminal. **The direction is never reversed** to find
a match: the reverse road is a different transport.

The layers, in order — the first that answers wins:

| Layer | Recorded as | What it accepts |
|---|---|---|
| Exact | `EXACT` | both ends equal, the terminal compared canonically (the PSA-before-Quay rule — the only configured equivalent) |
| Safe normalisation | `NORMALIZED` | equal after: canonical terminal, accents removed, lower case, `- _ . , ' / ( ) [ ]` read as a space, whitespace collapsed |
| One trusted typo | `FUZZY` | one end equal after normalisation; the other **one** edit away (a letter added, removed, changed, or two neighbours swapped), both spellings **8+ letters**, no digits; and no other configured road sharing that equal end fewer than **3** edits away (else `AMBIGUOUS`) |
| Nothing reliable | `NOT_FOUND` | the route components are priced at zero |
| More than one | `AMBIGUOUS` | never chosen between; the route components are priced at zero |

Why those thresholds: across every real place name in the documents, the
captures and the customer's price list, the closest two *different* places are
two edits apart and all such pairs are 7 letters or shorter (Gent/Genk,
Evergem/Avelgem); from 8 letters on, the closest pair is three apart. One edit
on 8+ letters therefore never reaches another real place, and the runner-up
margin refuses a typo that could belong to two roads.

**No aliases are invented.** `Kallo` and `Kallo (Beveren)`, `Antwerp` and
`Antwerpen`, `Saint` and `St` are different spellings to the matcher; making them
equal is a business decision, to be configured, never guessed.

**No match is not a zero price.** Every snapshot records which configuration
priced it and how — `trip_pricing.route_pricing_id` and `trip_pricing.route_match`
— so a Tarief of zero from `NOT_FOUND` is never mistaken for a route configured
at zero (`EXACT`, with its id). Nothing reliable is logged as a **warning** with
the Trip, the road, the layers tried and the three nearest configurations with
their edit scores; a trusted typo is logged as such. Amounts are never logged.

**Which route a stored price came from is visible.** Every snapshot also keeps
the road(s) it matched as they were configured then (`trip_pricing_route_leg`)
and, for a Combination, the selected pair (`trip_pricing.combination_route_group_id`).
The API returns this as `routeMatch` — on the snapshot read
(`GET /trip-pricing/snapshots`, the Trip detail panel) and on the effective
pricing of every Trip (`GET /trips`, the Ritten Tarief cell) — read from the
stored calculation, never matched again for display. A changed or removed
configuration therefore does not change what a stored price says about itself;
an older snapshot reports `method: null` ("not recorded") rather than a guess;
an OPEN Trip has no current price and therefore no current route. For a
Combination, `routeMatch.overSt` reports the Over ST and the surcharge the
calculation applied, read from its own lines.

**Configuration never reprices.** Changing, adding or removing a route or a
Combination changes no stored price; it is read by the next calculation of a
Trip (an edit while CLOSED, closing again, or an explicit reprocess).

## The rule that decides

Which kind of configuration applies is decided by the rule that already existed —
the same answer the TAR allocation uses, `combinationLegOf`, described under
*What counts as a genuine Combination* below — and then by the **pair**:

| The Trip's leg | Configuration it prices against |
|---|---|
| DELIVERY or COLLECTION of a genuine Combination | the leg of the **Combination configured for both roads of the pair** — each road matched as above, then the one Combination holding both |
| NONE — an ordinary Trip, or a group an operator made by hand | the **ordinary** configuration |
| INVALID — the Trips of one document are grouped but are not one delivery and one collection | the **ordinary** configuration |

An INVALID group is reported rather than priced on a guess, so it takes the
ordinary configuration rather than a Combination one.

### A genuine leg falls back

A genuine Combination leg whose **pair** is not identified prices against the
ordinary configuration of its own road. Not identified means: either road is no
configured leg at all, both roads are legs but of different Combinations, or
more than one Combination holds the pair (`AMBIGUOUS`). The reason is logged as a
warning. Every Combination Trip priced before Combination routes existed was
priced against the ordinary route; the fallback keeps that, and configuring the
Combination of the pair is what changes it.

A **single road never picks a Combination.** One road may be a leg of many
Combinations — a shared outbound with different returns — and choosing the first
of them was arbitrary. That fallback was removed.

## One match, read three times

The configured route is matched **once** per calculation, and the Tarief, the
road's length and the road's tunnel all come from that one row. Three independent
lookups could each match a different row now that a road can be configured twice,
and the Trip would be priced with a mixture of the two.

Concretely, from the matched row:

| Amount | Source |
|---|---|
| Tarief | `route_pricing.base_price` of the matched row |
| Toll | the TOLL `route_cost` of the matched row's owner — the LEG for a Combination leg, the matched row's own (configured) road otherwise |
| Tunnel | the TUNNEL `route_cost` of the matched row's owner — the LEG for a Combination leg, the matched row's own (configured) road otherwise |

The ordinary route's costs are read by the **configured** spelling of the matched
row, not the Trip's: a Trip matched despite a difference in letter case or a
trusted typo finds the Toll and Tunnel of the route that priced its Tarief. With
no match there are no route costs at all — the Toll and Tunnel follow the Tarief
to zero rather than come from a lookup the Tarief was refused.

A Combination leg **owns** its route costs (`route_cost.route_pricing_id`), which
is what stops the two configurations of one road sharing a toll or tunnel
amount: editing the Combination's can no longer change what every ordinary Trip
on that road pays.

---

# Toll and Tunnel Costs

Toll and Tunnel are both **route-dependent**, and the route decides both whether
they apply and how much they cost. Both are configured the same way: an
**amount** per route, stored as a RouteCost.

## Toll and Tunnel: an amount for the road

Trip

↓

Route (Terminal → Destination City)

↓

RouteCost — the configured amount for the TOLL, and for the TUNNEL, component

↓

TripPricingItem

The amount is charged as configured: no rate, no quantity, no rounding. A route
with no TOLL (or TUNNEL) cost produces no line, as against a line of zero; a
route configured **as** zero is a decision and produces a line of zero.

Each leg of a Combination carries its **own** toll and tunnel, stored as
RouteCosts owned by that leg rather than by the road. A leg's costs are read only
through the leg, and the road's only through the road, so the ordinary route and
the Combination leg on the same road have independent amounts.

## History: the toll was briefly kilometres × a rate

For a period the toll was derived as `route_pricing.kilometres` ×
`PRICING.TOLL_RATE_PER_KM`. The business returned to a toll amount per route:

- the Engine reads the TOLL route costs again — the ones stored before that
  period were never deleted and are used again as they are;
- `route_pricing.kilometres` is kept in the database, unused, so no entered
  distance is lost; it is not converted into any amount;
- `PRICING.TOLL_RATE_PER_KM` is switched off (not deleted) and no longer read or
  offered;
- a Trip priced in that period keeps its stored toll line, which records the
  distance (`quantity`) and the rate (`unit_price`) it was charged with. No
  snapshot is changed.

## Over ST: Leg 2, on another day than Leg 1

A Combination carries **Over ST** — its own Tarief, Toll and Tunnel — beside its
two legs, stored on `combination_route_group`. It is charged:

- on **Leg 2** only — never on Leg 1 (the leg position is the configured
  Combination's, identified by the pair);
- only when Leg 2's `planningDate` **differs** from Leg 1's. The original
  planning date, a document date or a creation date play no part; a leg with no
  planning date owes no Over ST;
- only when the Combination **has Over ST configured**: at least one of its three
  amounts filled in. `0.00` counts as filled in; all three empty means no Over
  ST — and no surcharge — logged with the reason `NOT_CONFIGURED`;
- **component by component**: Leg 2's Tarief + Over ST Tarief, Toll + Over ST
  Toll, Tunnel + Over ST Tunnel. An unstated or zero component adds nothing;
- plus the **Over ST surcharge** — the Setting `PRICING.OVER_ST_SURCHARGE`,
  70.00 by default — **once**, on Leg 2's Tarief.

| Leg 1 date | Leg 2 date | Leg 2 Tarief / Toll / Tunnel (80 / 15 / 5) with Over ST 50 / 10 / 3 |
|---|---|---|
| 2026-10-06 | 2026-10-06 | 80 / 15 / 5 |
| 2026-10-06 | 2026-10-07 | 200 (80 + 50 + 70) / 25 / 8 |

The additions are written as lines of their own — BASE_PRICE, TOLL and TUNNEL
described "Over ST", and a BASE_PRICE line "Over ST toeslag" for the surcharge —
so the Tarief, Tol and Tunnel columns, the exports and the invoice check read
Leg 2's effective amounts from the snapshot, and nothing recalculates them.
**Fuel** is charged on the effective Tarief (Over ST and the surcharge
included), as decided by the business. The €50 Backload, the waiting time, the
Cost Confirmations and the EK rule are unaffected.

Every calculation produces these lines **from scratch** — never on top of a
stored snapshot — so recalculating twice adds nothing twice, and a calculation
after the dates are equal again carries none of it.

### Which Combination

A road may be a leg of many Combinations, so a Combination Trip is matched by
the **pair** of roads its two Trips drive (the same identity, `isSameCombination`,
that keeps a pair from being configured twice, matched with the layers above).
Tarief, Toll, Tunnel and Over ST all come from that one configuration. When the
pair is not identified, the leg prices against the ordinary route of its own
road and owes no Over ST.

Over ST reaches a Trip only when it is priced (closed or repriced); stored
snapshots do not change until then.

### A date change reprices Leg 2 automatically

Because Over ST reads both legs' `planningDate`, moving **either** leg to
another day can switch it on or off — always on Leg 2. So a `planningDate`
change reprices Leg 2 by itself, without "Prijs opnieuw berekenen":

| Change | Repriced |
|---|---|
| Leg 1's date | Leg 2 (its Over ST may appear or disappear) |
| Leg 2's date | Leg 2 |
| An ordinary Trip's date | nothing — its pricing does not read the date |

- **Who decides which Trips:** the pricing domain —
  `PricingRecalculationService.tripsAffectedByPlanningDate`, answered by the
  resolver's own pair lookup (`legsPricedByPlanningDate`), so the Trips named
  are exactly the ones whose price would move. Same pattern as
  `tripsAffectedByRegrouping`.
- **When:** after the write has committed, only on a real change of the stored
  date (re-saving the same Datum asks nothing), through the same `recalculate`
  as every other repricing — so it never throws, and a Trip that cannot be
  priced answers with a reason code.
- **Which status:** CLOSED Trips only. An OPEN Trip has no snapshot; it is
  priced when it closes, with the dates it has then.
- **Write paths:** the Trip edit (`TripService.update`), and a revised or
  repeated NEW document (`TripRevisionService`) — a document rewrites only OPEN
  Trips, but may date one whose CLOSED partner is Leg 2. Shared helper:
  `trips/planning-date-change.ts`.
- `originalPlanningDate` triggers nothing: Over ST does not read it.

### A road change reprices the pair

A leg's road — terminal, destination city or direction — decides which
configured PAIR both legs are priced on. So a real change of it (an edit of a
CLOSED Trip, or a document revising an OPEN leg whose partner is CLOSED)
reprices the Trip and every CLOSED member of its group from the same document
(`PricingRecalculationService.tripsAffectedByRoadChange` →
`PricingComponentResolver.tripsPricedByRoadOf`), deliberately whether or not
the pair is genuine right now: a direction change can make it malformed, and
the partner's price moves either way. A date and a road changed by one write
reprice each Trip once (`trips/planning-date-change.ts`,
`repriceAfterCombinationInputChange`).
- Not in `changesPricingInput`: that list names a Trip's OWN inputs, while a
  date change may reprice the partner and must leave an ordinary Trip alone.

## Applicability

A route-dependent cost applies to every Trip whose route has that cost
configured. A toll is a property of the road, not of the load: if the
route is tolled, the Trip driving it pays.

Nothing is assigned, ticked or selected per Trip. This changed: applicability
used to come from a Custom Property linked to the component, so a real charge
depended on somebody remembering to tick a box, and a Trip on a tolled route was
silently priced without its toll whenever the box was missed.

A route with NO cost configured for a component produces no line at all —
different from a route configured AS zero, which is somebody's decision and does
produce a line of zero.

An operator who disagrees with the amount corrects the Tol or Tunnel column on
the Ritten row; those overrides are unchanged.

The Custom Properties that link to the TOLL and TUNNEL components still exist,
because `route_cost` may only be stored for a component some property links to.
They are no longer applicability switches, and they are no longer offered for
manual assignment — see "Automatic and manual properties" below.

## Amount

The amount comes from the RouteCost configured for the Trip's route and that
Pricing Component.

The route is the Trip's Terminal and Destination City, resolved the same way
whichever Pricing Strategy is active. A route-dependent cost is incurred
regardless of how the base price was calculated.

# Automatic and manual properties

Two different things share the `custom_property` table, and the system tells
them apart from the model rather than from a list of names.

A property is **system-managed** when any of these holds:

| Reason | Which | Who decides |
|---|---|---|
| It references a Pricing Component | Toll, Tunnel | the route configuration |
| It is the configured automatic property | TAR | the Pricing Engine |
| It is the container-type property | Flat | the Trip's container type |

System-managed properties are not offered in "Custom waarden beheren", and the
API refuses an attempt to assign one by hand. Existing assignments are
untouched: the rule governs what may be assigned NEXT, and a historical
breakdown keeps every amount it was priced with.

Everything else is **manual** — a genuine per-Trip decision such as
Aan/Afkoppelen, Over/EX or Ashcco. Carrying a price does not make a property
automatic; all of these have one.

Tarief, Brandstof, Backload and the Cost Confirmation appear nowhere in that
table because they are not Custom Properties at all. Each is a Pricing Component
with its own calculator, so there is nothing for an operator to select.

Waiting time is the one that looks like both and is neither: it is a Trip FIELD
the operator types in, and the Engine prices it from the configured free period,
threshold, block size and block price. **Manual input, automatic amount.** It is
edited on the Ritten row and is not part of the property picker.

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

## The automatic Custom Property (TAR)

One Custom Property is applied by the Pricing Engine **without anyone assigning
it**. In this business that property is TAR.

Which property it is, is configuration, not code: the PRICING Setting
`AUTOMATIC_CUSTOM_PROPERTY_ID` holds the property's id. The engine never
recognises it by name, and the amount charged is the property's own
`default_price` — changing that price changes what new calculations charge, with
no code change.

### Which Trips pay it

| Trip | TAR |
|---|---|
| An ordinary Trip | charged |
| A Trip in a manually created group | charged — a manual group is not a Combination |
| The COLLECTION leg of a genuine Combination | charged |
| The DELIVERY leg of a genuine Combination | **not** charged |

A genuine Combination therefore carries **exactly one** TAR charge in total: the
two legs are one truck movement, and the movement is charged once.

### What counts as a genuine Combination

Both of the following, from persisted data only:

- the Trips share a `trip_group_id`, **and**
- they were created from the **same** `pdf_document_id` — one transport order
  printed both legs.

Trips an operator grouped by hand come from different documents, or from none,
and are therefore not a Combination. Nothing is inferred from planning dates,
booking numbers or the order rows appear in.

This decides the TAR allocation only. The Combination Surcharge follows plain
group membership — see Combination Surcharge above.

If the Trips of one document are grouped but do **not** form exactly one
DELIVERY and one COLLECTION, they are not a genuine Combination. Each is then
priced as a member of a manual group: it keeps its own Combination Surcharge and
owes TAR under the ordinary rule, on its own stated number. The shape is logged
as the data fault it is.

Pricing used to refuse such a group outright. It no longer does: the Combination
Surcharge follows plain membership, so refusing took away a charge that was
never in doubt — and with it the Trip's whole price.

### The assignments are overruled, not trusted

The automatic property is removed from the Trip's assignments and then applied
again where the rule says it belongs. Every starting state therefore produces
the same answer:

| Stored assignments | Result |
|---|---|
| none | charged where the rule says |
| assigned by hand as well | charged once, not twice |
| assigned to the wrong leg | charged on the correct leg only |
| assigned to both legs | one charge, on the collection |

An operator never has to tick TAR, and a tick left over from before this rule
existed cannot produce a second charge.

### Historical pricing is never rewritten

A stored snapshot records what was charged and is left alone. The rule applies to
**new** calculations only — a Trip closing, or an administrator asking for a
reprocess.

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
- Over ST Surcharge (Leg 2, when Over ST applies)
- Route Prices
- Route Costs (Toll, Tunnel)
- Distance Rate
- Custom Property Prices
- Pricing Rule Version

Actual values are intentionally excluded from this document.

## Configuring a new environment

Migrations create the tables; they do not configure the business. A freshly
migrated database therefore has no pricing Settings at all, and the Pricing
Engine refuses every calculation until they exist — no snapshot is written and
the Ritten pricing screen is empty.

The Backend closes that gap itself. The pricing bootstrap ensures the whole
foundation in one idempotent operation, and it runs automatically as the
application starts, so a deployment is configured without anyone remembering a
step. The same operation is available on demand from Settings → Prijzen, and
through `POST /api/v1/settings/pricing/bootstrap`.

It has three layers, and the order is not arbitrary:

1. **The `pricing_component` catalog.** Every `trip_pricing_item` carries a
   foreign key into it, so a breakdown cannot be STORED without it however
   correctly it was calculated. Absent rows are created; an existing component
   is left untouched, including one somebody has renamed.
2. **The TAR Custom Property.** An ordinary Custom Property, created only when
   no ACTIVE property already bears that name, priced at the standing €20. It
   is editable and deactivatable afterwards like any other.
3. **The Setting rows.** Created only where no row exists — an existing value is
   somebody's decision and is never overwritten.

Layer 3 depends on layer 2: `AUTOMATIC_CUSTOM_PROPERTY_ID` holds the id of a
Custom Property row in the database it lives in, so it is resolved from that
database by name rather than carried in the application, where an id from
another environment would point at nothing — or at some unrelated property,
which would silently charge the wrong amount on every Trip. Running the layers
the other way round leaves that setting with nothing to point at.

The report always precedes the write: the screen shows what would be created
before anything is created, and creating is idempotent — a second run, and every
subsequent restart, finds nothing missing and writes nothing.

A setting that EXISTS but has been switched off is reported as blocked rather
than repaired. The Engine treats it exactly as missing, but somebody disabled it
deliberately and reactivating it is their decision.

### Why the seed is no longer the mechanism

`prisma/seed.ts` still creates the component catalog and is still idempotent,
but the deployment never ran it: compose runs `migrate deploy`, and
`prisma db seed` invokes `tsx prisma/seed.ts` while `tsx` is a devDependency
that `pnpm install --prod` strips from the runtime image. A deployed database
therefore had its schema, an empty catalog, and no way to price anything — the
Engine calculated a Trip correctly and then failed to store the result against a
missing foreign key. Whether the database holds what the Engine requires is a
Backend invariant, so the Backend is where it is now ensured. The seed remains a
developer convenience for a database with no API running.

Route prices are configuration too, and have their own prerequisite: a pricing
component may only carry route costs once a Custom Property links to it (see
`database_model.md` §4.12). Until a property is linked to the TOLL and TUNNEL
components, a route's Toll and Tunnel cannot be stored.

Configuration becomes effective for the NEXT calculation. Creating or changing
a setting prices no Trip and alters no existing snapshot; a Trip already closed
keeps the amounts, and the rates, it was priced with. Only an explicit
Reprocess Pricing produces a new snapshot.

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