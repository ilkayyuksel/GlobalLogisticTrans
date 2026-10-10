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

`POST /trip-pricing/trip/{tripId}/reprocess` answers with the snapshot it just
stored — `pricing` (incl. `routePricingId`, `routeMatchMethod`,
`combinationRouteGroupId`), `items` and `routeMatch` (the route(s) matched, the
selected Combination with both legs, and the Over ST applied) — in exactly the
shape of `GET /trip-pricing/snapshots`. It is read back from storage in one
consistent read (`TripPricingService.requireCurrentSnapshot`), never matched
again for the response. A Trip reopened between the write and the read-back is
refused with the usual 409; its stored snapshot is never answered as current.
The Trip detail page shows this response directly, without a second request.

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

## Only a CLOSED Trip has a current price

Pricing describes finished work. A Trip's stored snapshot is its CURRENT price
only while the Trip is CLOSED (`trip-pricing/current-pricing.ts`, the single
rule; the Engine's own precondition reads the same constant):

- CLOSED → the snapshot is shown everywhere.
- Reopened (CLOSED → OPEN), cancelled or deleted → no price is shown anywhere,
  at once. The snapshot is NOT deleted: it stays stored as history.
- OPEN → CLOSED → the Engine prices the Trip in full from its current data and
  replaces the old snapshot; the ordering guard below still applies.
- Edits to a Trip that is not CLOSED — waiting time, Custom Values, a Cost
  Confirmation, a group — calculate nothing: `PricingRecalculationService`
  checks the status first and answers `pricing: null` with
  `PRICING_TRIP_NOT_CLOSED`. The same edits to a CLOSED Trip reprice it.

The reads that show a price (effective pricing, the snapshot endpoints, the
export labels) use the repository's `findCurrent…` queries, which join on the
Trip's status. The Engine and the snapshot store use the unfiltered read, so a
reopened Trip's old snapshot can still be found and replaced.

## A Custom Property without a price contributes nothing

A fixed-price Custom Property may be configured without a price. Assigned to a
Trip, it adds no Others line and the Engine logs a warning naming the property;
everything else on the Trip is priced as usual. Nothing is invented: the
property is simply not charged until an Administrator configures its price and
the Trip is recalculated.

This used to refuse the whole calculation, which left a CLOSED Trip with no
snapshot — every pricing column showed "-" — and made any later recalculation
fail, so the previous snapshot stayed on screen. It is the same rule that
already applied to a Toll or Tunnel property on a route with no configured cost.

## Concurrent recalculations of one Trip

Two recalculations of the same Trip may run at once — two quick edits, or an
edit straight after closing — and finish in either order. A snapshot's
`calculated_at` is the moment the Engine STARTED reading the Trip, and the
snapshot store never replaces a snapshot whose inputs were read later than the
one being written (a conditional update on `calculated_at`). The older result is
discarded with a warning. When two FIRST snapshots race, the loser is retried as
an ordinary replace instead of failing.

## Automatic recalculation after grouping or ungrouping

A Trip's Combination leg is decided by its GROUP, and the leg decides the
Backload and which leg owes TAR. Grouping (`POST /trip-groups`) and ungrouping
(`PATCH /trips/{id}/group`) write only `tripGroupId`, so they are a pricing
input that the Trip's own row does not show.

After the group change has COMMITTED, the Trips whose leg it changed are
recalculated — the same recalculation as above, one Trip per call:

Which Trips: the pricing domain compares every affected Trip's leg before and
after the change with `combinationLegOf`, the rule the Engine prices with.
Forming or splitting a manual group changes nobody's leg and reprices nothing.
Grouping one order's two legs reprices both. Taking one leg out of a genuine
pair reprices BOTH, because the leg left behind is no longer a Combination
either. Trips outside the group are never touched.

Only CLOSED Trips: an OPEN Trip is priced when it closes, from whatever group it
is in by then, exactly as before.

After the commit, never inside the transaction: the Engine reads the Trip and
its group for itself and must see the new membership.

The failure contract below applies unchanged: the group change is kept, and a
leg that cannot be priced answers with `pricing: null` and a reason code. The
Ritten list refetches after either action, so both legs show their new prices.

Historical Trips already priced on a stale group are NOT repaired
automatically; they are repriced the next time they are grouped, ungrouped or
otherwise recalculated.

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

Route matching (`PricingComponentResolver`): the match method; a trusted typo
(`FUZZY`) at info level; nothing reliable (`NOT_FOUND`, `AMBIGUOUS`) as a
warning with the road, the layers tried and the nearest configurations with
their edit scores; a Combination pair that is not identified, with its reason;
and whether Over ST applies to a matched leg, with the reason when it does not.
See `pricing_rules.md` — *How a road is matched*.

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