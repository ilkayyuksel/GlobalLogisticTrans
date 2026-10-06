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
| `COMBINATION` | `legs`: exactly two, each a full route price with its own five fields |

At most 500 entries per document. The bound exists because the whole import runs
in one transaction, and its size decides how long that transaction holds its
locks.

## Toll is an amount; no distance, and no active flag

A route carries its **Toll** as an amount, like its Tunnel, stored as a route
cost. An older entry still naming `kilometres` is **refused** rather than
ignored or converted, because either would let an operator believe the distance
had been used. The same goes for `active`, which route prices no longer have.

Over ST is not part of the import document: Combinations are created from their
legs, and Over ST is filled in on the screen (or sent as `overSt` on the
Combination endpoints).

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

## All or nothing

Twenty valid routes and one invalid one produce **no** database change.

The whole document is validated before anything is written, so the refusal lists
every problem at once rather than stopping at the first — an operator who pasted
eighty routes fixes them in one pass. The writing then happens in a single
transaction, which keeps the promise even against a failure the validation could
not foresee, such as a concurrent import taking one of the roads in between.

## Duplicates are refused, never merged

An entry whose route is already configured is an import **error**. Nothing is
overwritten, nothing is skipped and nothing is upserted: the existing
uniqueness rules decide, through the same lookup the manual create uses, so the
canonical terminal rule applies and `PSA Quay 869` collides with `Quay 869`.

The same road used twice **within** one document is refused as well, reported on
the later entry.

An ordinary route and a Combination leg may describe the same road. That is not a
duplicate — they are read in different pricing contexts and neither overwrites the
other — so the two scopes are checked apart.

## Checking before importing

`bulk/check` answers what the import would do and writes nothing. It returns the
counts and every reason the document would be refused:

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
    { "routeNumber": 4, "legNumber": null, "field": "toll", "message": "toll is required" },
    { "routeNumber": 9, "legNumber": null, "field": "legs", "message": "a Combination must have exactly 2 legs" },
    { "routeNumber": 11, "legNumber": 2, "field": "tarief", "message": "tarief must not be less than 0" }
  ]
}
```

A refused document is an ordinary `200` answer here rather than a failure: the
caller asked what *would* happen, and "nothing, for these three reasons" is the
answer to that question. `POST /bulk` refuses with `400` instead, carrying the same
lines in `error.details`.

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
