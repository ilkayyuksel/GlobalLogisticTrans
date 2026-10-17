# API

REST API documentation.

Every endpoint is described in full by the OpenAPI document the application serves
at `/docs` in development, generated from the controllers themselves — so it cannot
drift from what the code accepts. This file carries the few things a generated
schema cannot say well: the shape of a document a person types by hand, and why it
looks the way it does.

Endpoints will be documented here as they are implemented.

---

# Bulk import of route prices

`POST /api/v1/route-configuration/bulk`
`POST /api/v1/route-configuration/bulk/check`

Configures many routes from one JSON document, instead of typing each one into
Settings → Prijzen → Routeprijzen.

## JSON is the input format, and only that

Nothing about the document is stored. Each entry becomes exactly the same
relational records a route configured by hand becomes — a `route_pricing` row, a
`combination_route_group` with two legs, a tunnel `route_cost` — created through
the very services the single-route endpoints use. There is no JSON column
anywhere, no route holds a second route in a blob, and there is no pricing logic
of its own: an imported route is priced by the Engine exactly as a hand-configured
one is.

## The document

```json
{
  "routes": [
    {
      "type": "NORMAL",
      "departure": "Antwerp",
      "destination": "Kallo",
      "tarief": 100,
      "toll": 25,
      "tunnel": 0
    },
    {
      "type": "COMBINATION",
      "legs": [
        {
          "departure": "Antwerp",
          "destination": "Kallo",
          "tarief": 100,
          "toll": 25,
          "tunnel": 0
        },
        {
          "departure": "Kallo",
          "destination": "Antwerp",
          "tarief": 80,
          "toll": 30,
          "tunnel": 15
        }
      ]
    }
  ]
}
```

The field names are the API's own — `departure`, `destination`, `tarief`,
`toll`, `tunnel` — the same names the single-route endpoints take and the
same ones the OpenAPI schema lists. One vocabulary rather than two spellings of
each field.

| Entry | Contains |
|---|---|
| `NORMAL` | one route: `departure`, `destination`, `tarief`, `toll`, `tunnel` |
| `COMBINATION` | `legs`: exactly two, each a full route price with its own five fields; optional `overSt`: `{ "tarief", "toll", "tunnel" }`, each a number or `null` |

At most 500 entries per document — refused rather than truncated.

## Toll is an amount; no distance, and no active flag

A route carries its **Toll** as an amount, like its Tunnel, stored as a route
cost. An older entry still naming `kilometres` is **refused** rather than
ignored or converted, because either would let an operator believe the distance
had been used. The same goes for `active`, which route prices no longer have.

Over ST travels with its Combination (14 October 2026): an optional `overSt`
with the screen's three amounts, each a number or `null` (`0` counts as
configured). The JSON export writes it whenever one is configured. Before this,
an imported or re-imported Combination always arrived WITHOUT Over ST, and so
never owed Over ST or the €70 surcharge.

## A Combination is exactly two legs

One leg is refused, three are refused, and a missing leg is never filled in from
its partner. The two legs may differ on all three amounts — that is the point of a
Combination — and they must describe different roads.

The rule is enforced three times over, each time for its own reason: by the import
DTO, so a caller learns immediately; by `CombinationRoutePricingService`, which is
also called from inside the application; and by the database, which has only two
leg positions per group.

> A Combination here is route **configuration**. It has nothing to do with a
> TripGroup in the Rittenlijst, which is what decides the €50 Backload.

## Invalid entries are skipped; the rest is imported (October 2026)

This **replaces** the earlier all-or-nothing rule, under which two Combinations
whose legs were the same road refused an entire price list.

Every entry is judged on its own, by exactly the same rules as before — none was
relaxed. An entry that breaks one is **skipped** and reported with its number,
the road(s) it names and every reason; all other entries are imported. Only a
document that cannot be read at all (not an object, no `routes` array, empty, more
than 500 entries) is refused as a whole with `400`, creating nothing.

| `code` of a reason | Skipped because |
|---|---|
| `INVALID` | a field or the shape of the entry breaks a rule (missing `tarief`, negative toll, three legs…) |
| `SAME_ROUTE_LEGS` | both legs of a Combination are the same road |
| `DUPLICATE_IN_IMPORT` | an earlier entry of this document configures the same route or Combination |
| `ALREADY_CONFIGURED` | it is already configured — found while checking, or refused by the database while writing |

Each entry is written in **its own transaction**: a route with its toll and
tunnel costs, a Combination with its group, both legs and their costs — all of
its rows or none. Nested transactions the configuration services open (the
Combination's own, a route-cost page read) run inside that same transaction
(`transactionBound` in `RouteConfigurationUnitOfWork`). One entry's failure
cannot undo another's success.

A failure while writing that is **not** "already configured" is not treated as a
bad entry: the import **stops** there (`outcome: "ABORTED"`), logs the error
with its stack, and reports where it stopped and how many entries after it were
not attempted. The entries before it stay imported.

```json
{
  "outcome": "PARTIAL",
  "imported": { "normalRoutes": 24, "combinationGroups": 0, "combinationLegs": 0, "totalRoutes": 24 },
  "skipped": [
    {
      "routeNumber": 15,
      "type": "COMBINATION",
      "route": "Antwerp to Kallo and Antwerp to Kallo",
      "reasons": [
        { "routeNumber": 15, "legNumber": null, "field": "legs",
          "message": "the two legs of a Combination must be different routes", "code": "SAME_ROUTE_LEGS" }
      ]
    }
  ],
  "stoppedAt": null,
  "notAttempted": 0
}
```

`outcome` is `COMPLETED` (nothing skipped), `PARTIAL` (some imported, some
skipped), `NOTHING_IMPORTED` (every entry skipped) or `ABORTED`.

## Duplicates are skipped, never merged

**One road identity everywhere** (14 October 2026, `isSameRoad`): both ends
through `normalizeLocation` — the canonical terminal rule (`PSA Quay 869` is
`Quay 869`) at either end, plus letter case, accents, punctuation and spacing.
The same identity guards the screen's create and update, the bulk import, the
Combination pair and the leg sync, so `Quay 869 → LOKEREN` is refused next to
`Quay 869 → Lokeren` — a pair the pricing matcher would otherwise read as one
road and price as AMBIGUOUS. Aliases, optional qualifiers and fuzzy matching
stay in pricing only. A refusal names the route as it is stored.

Nothing is overwritten and nothing is upserted: the existing uniqueness rules
decide, through the same lookup the manual create uses, so the canonical
terminal rule applies and `PSA Quay 869` collides with `Quay 869`. An entry whose
route or Combination pair is already configured is skipped.

Within one document the **first** occurrence is kept and every later entry
configuring the same route (or the same Combination pair, in either leg order)
is skipped, naming the entry it repeats. Amounts play no part in identity: the
same road with another Tarief is still the same route, and two conflicting
versions are never both imported.

An ordinary route and a Combination leg may describe the same road. That is not a
duplicate — they are read in different pricing contexts and neither overwrites the
other — so the two scopes are checked apart.

## Checking before importing

`bulk/check` answers what the import would do and writes nothing. It returns the
counts of what would be created, the entries that would be skipped (`skipped`,
shaped as above) and every reason as a flat list:

```json
{
  "isValid": false,
  "summary": {
    "normalRoutes": 12,
    "combinationGroups": 4,
    "combinationLegs": 8,
    "totalRoutes": 20
  },
  "errors": [
    { "routeNumber": 4, "legNumber": null, "field": "toll", "message": "toll is required", "code": "INVALID" },
    { "routeNumber": 9, "legNumber": null, "field": "legs", "message": "a Combination must have exactly 2 legs", "code": "INVALID" },
    { "routeNumber": 11, "legNumber": 2, "field": "tarief", "message": "tarief must not be less than 0", "code": "INVALID" }
  ],
  "skipped": [ "…" ]
}
```

`isValid` is true when nothing would be skipped. Skipped entries are an ordinary
`200` answer on both endpoints; only an unreadable document makes `POST /bulk`
answer `400`, with its lines in `error.details`.

`routeNumber` counts from 1 and is `null` when the problem is the document itself,
such as a missing `routes` array. It is a field rather than part of the sentence so
a screen can say "Route 4" in the operator's own language.

Both endpoints take the document **raw** rather than through a validated DTO. The
global ValidationPipe strips properties that carry no validation metadata, which
emptied every entry on its way in, and its field paths (`routes.3.toll`)
cannot name the entry at fault. Each entry is therefore validated
programmatically against the same DTO classes the manual endpoints use, with the
same options the pipe applies.

---

# Bulk delete of route prices

`POST /api/v1/route-configuration/bulk-delete`

```json
{ "routeIds": ["<uuid>"], "combinationGroupIds": ["<uuid>"] }
```

Deletes a selection of ordinary routes and Combinations in **one transaction**:
all of them, or — when any record is refused (missing, or a Combination leg
named as a route) — none. Each record is removed through the same service
method as the single delete, so a Combination always goes with both legs and
their tunnels. A Combination is named by its group id, never by a leg. An empty
selection is refused with 400. Historical TripPricing is unaffected: a snapshot
stores its amounts and reads no configuration again.

POST rather than DELETE, because the selection is a body and a DELETE with a
body is ignored or refused by enough proxies to be a trap.

# Combination leg price sync

`GET  /api/v1/route-configuration/combinations/{combinationGroupId}/legs/{1|2}/sync-targets`
`POST /api/v1/route-configuration/combinations/{combinationGroupId}/legs/{1|2}/sync`

Copies one Combination leg's stored **Tarief, KM and Tunnel** to every OTHER
Combination whose leg in the **same position** is the **same road** by the
application's one road identity, `isSameRoad` (`route-pricing/route-identity.ts`)
— the rule RoutePricing and RouteCost are matched by. The departure is compared
as a terminal through `isSameTerminal`, so `PSA Quay 869` and `Quay 869` are one
place (case and whitespace ignored); the destination is compared exactly. Never an
ordinary route, never the other leg position, never Over ST, From, To, the review
mark or the group itself. The values copied are Tarief, Toll and Tunnel.

The GET is the preview the confirmation shows and writes nothing. The POST
reads the source and the targets inside one transaction and saves each target
through the same Combination update an inline leg edit uses, so there is no
second way prices are written. Both answer with the source leg, its values and
`targetCombinationGroupIds`; an empty list means nothing was changed.


# Weekly invoice check

`POST /api/v1/invoice-audit/check` — multipart `file`
`POST /api/v1/invoice-audit/apply` — multipart `file`
`POST /api/v1/invoice-audit/payment` — multipart `file`, `tripIds`

Three steps, and only the last one changes anything in the system. The rules
behind them are in `docs/02-business/invoice_audit.md`.

- **check** answers the preview: per line the match, the price comparison and
  the cells the corrected document would write; `markedRowNumbers` (yellow);
  the added transports; `totals` before and after; and `payments` — every
  transport the invoice charges, with `payable`, `category` (`UNCHANGED`,
  `RAISED`, `INVOICE_HIGHER`), `reasons` and `alreadyPaid`. It computes the
  totals by writing the corrections into an in-memory copy of the upload, the
  same path `apply` uses; that copy is never returned.
- **apply** answers the corrected `.xlsx` as bytes, with `X-Invoice-Rows-Added`,
  `X-Invoice-Rows-Marked` and `X-Invoice-Cells-Corrected` beside it. It pays
  nothing. The bytes are verified against the change plan first; a file that
  differs by anything unplanned is refused with **500** and the differing
  cells in `details` — no file is answered.
- **payment** takes the ORIGINAL file again and `tripIds`, a JSON array of Trip
  ids sent as a form field:

  ```
  tripIds=["3f1b0d2e-0000-4000-8000-000000000001"]
  ```

  The document is examined afresh and its corrected file produced and
  verified again (a refused file pays nothing). Every chosen id must be payable on it now,
  or the request is refused with **409** — `details` names each refused id and
  its reasons (`NOT_ON_INVOICE`, `NOT_CLOSED`, `PRICE_NOT_SETTLED`, …) — and
  nothing is paid. Otherwise the chosen Trips not yet paid are marked paid in
  one transaction whose update repeats the conditions (CLOSED, not yet paid);
  a Trip that changed in between rolls the whole transaction back. Chosen
  Trips already paid are left as they are, so confirming twice changes
  nothing. Answers `{ paidTrips, alreadyPaid, paidTripIds }`. A selection that
  is not a non-empty, duplicate-free list of at most 500 UUIDs is a 400.
