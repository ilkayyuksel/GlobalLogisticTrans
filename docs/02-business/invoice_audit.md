# Excel invoice check (factuurcontrole)

The customer sends a weekly Excel overview of the transports they pay for. The
invoice check reads that file, compares every line with what TRANO holds, and
produces the SAME file corrected. Code: `apps/backend/src/invoice-audit/`.

It is a separate flow. It reads stored data — pricing snapshots, route-match
records, Trip groups, Cost Confirmations — and never matches a route again,
never prices a Trip and never changes a snapshot.

This document grows with the implementation phases agreed in October 2026.
Phase 1 (price comparison and Fuel), phase 2 (identification, Cost
Confirmation lines, Combinations), phase 3 (Remarks, red text, yellow rows) and
phase 4 (added lines, totals structure, Fuel header), phase 5 (preview,
correction, separate payment confirmation) and phase 6 (verification of the
written workbook) are implemented.

## The document

- The customer's own workbook is corrected in place; its layout, formats,
  formulas, hidden columns, totals row and summary block are kept.
- Columns are found by their header text (`invoice-columns.ts`), never by
  position. Fuel is any header of the form `Fuel 24%`.
- A line states at least two of: a planning date, a booking number, a
  container number (owner, October 2026) — matched on the pair it states, the
  third corrected to its Trip's. A row stating only one is reported as
  incomplete. A Cost Confirmation line (below) states a day and a booking.
- A cell that BORROWS a shared formula (in week 41, `M3`–`M68` borrow `M2`'s
  `24%*L2`) is read as its own translated formula, because Excel recalculates
  it from the row's Tarief.

## Identifying lines (phase 2)

Matching an Excel line to a Trip (`matching/`) is a different step from judging
how that Trip's route was priced (`pricing/price-reliability.ts`).

### Transport lines

Strongest evidence first (`matching/row-decisions.ts`). The date is either of
the Trip's two dates, exactly; DELETED Trips are never candidates. A line is
`NOT_FOUND` only after all three pairs were tried, whatever its Remarks say.

1. date + booking + container: one CLOSED Trip is `MATCHED`, several are
   `AMBIGUOUS`, only unfinished ones `NOT_FINISHED`;
2. any TWO of the three, when no Trip matches all three (`decideByTwoValues`,
   candidates in `matching/two-value-candidates.ts`):
   - date + booking → the container is corrected;
   - date + container → the booking is corrected;
   - booking + container on another day → the date is corrected to the Trip's
     `planningDate` (owner, October 2026).

   The three pairs are judged together. Exactly one Trip, CLOSED → `MATCHED`
   with the one value that differs corrected (red) to the Trip's; a Trip
   holding no such value (a Trip stored without a container) is matched all
   the same and nothing is corrected. Not CLOSED → `NOT_FINISHED`; two or more
   → `AMBIGUOUS`, nothing chosen; none → `NOT_FOUND`. One shared value is never
   enough. A line matched on two values yields to another line's claim on the
   same Trip exactly as a corrected line does (`CONFLICT`).

   A Trip EC charge lines (stating no container) name by their own date and
   booking is CLAIMED by them too (`toCostLineClaims`): containers are shared
   — week 41 R42 (Laakdal) and R53–R54 (ANRDUB2812770) both state PVDU 1106430
   — so another line's date and container reaching it is no misprint of its
   booking. It is no free candidate for a correction; a line only it could be
   is a `CONFLICT` naming those EC lines, never corrected onto it.

The lines are matched in two passes over the whole document, so the order of
the lines never changes the answer. First every exact match; then step 2, where
a Trip another line already matches EXACTLY is no candidate — it is accounted
for. That is how a second line of one booking with a misprinted date finds its
own Trip instead of colliding with the first line's. When only such Trips share
two values, the line is `CONFLICT` naming that row: it may be the same transport
invoiced twice, and a person decides.

Never two values at once, never a fuzzy number. Two lines whose corrections
reach the same Trip are both `CONFLICT` (`matching/identity-conflicts.ts`) and
nothing is corrected. Rows stating the same date, booking and container are one
transport split over several rows and never conflict.

A corrected date is written in the form the cell held a date — a date cell, an
Excel serial or `YYYY-MM-DD` text — so the customer's number format stays. A
correction never makes a price reliable: the matched line is compared under the
same price rules as every other line.

### Why a line found no Trip

A line that matched nothing, or several Trips, says why in its existing warning
(`matchProblem`, `matching/match-explanations.ts`): that all three pairs were
tried, or which Trips it could be. A matched line gets no extra explanation —
its status and its correction note say it. (The separate "Aanbevolen actie"
column of October 2026 was withdrawn by the owner.)

### Cost Confirmation (EC) lines

A row stating an EK, `EC <nr>` in Remarks, and none of a transport's own
details (time, container type, start/endpoint, route, distance, any other
amount) is a Cost Confirmation line (`workbook/supplementary-cost-line.ts`):
week 13 R41, week 36 R36–R37, week 41 R53–R54 and R107. One standing next to a
transport line with the same date, booking and container is that transport's
split EK instead.

It is resolved through the confirmation it names (`EC` = the confirmation's
`ccNumber`): exactly one confirmation, of one CLOSED Trip, with the line's
booking and — if the line states one — container. A misprinted booking is
corrected (red) when the line's container is that Trip's.

Every EC line's transport is identified on its own values — date, booking,
container — apart from its confirmation (`transportTrip`, owner, October
2026); the EC number never decides it. Its EK is checked against its
confirmation's Trip only when that is the Trip its values identify, or they
identify none; when they name a different Trip, the line is
`COST_LINE_UNRESOLVED`, says both, and its EK is not checked.

When the confirmation is not known, the line stays `COST_LINE_UNRESOLVED`, but
its transport is looked for apart (`matching/cost-line-transport.ts`, the same
pairs of values as a transport line; only a booking is ever corrected on an EC
line — its date may lawfully differ). Its warning then says whether the
transport was matched, and on which row, or found but not on the invoice, or
not found at all: a missing confirmation is never a failed transport match. Otherwise it is
`COST_LINE_UNRESOLVED` (yellow). A resolved line is compared ONLY on its EK,
with its own confirmation's amount — or with nothing when the Trip's EK is its
charged waiting time. What the Trip's Cost Confirmation lines charge is taken
off the EK its own line is compared with, so no confirmation is charged twice.
A Cost Confirmation line is never its transport's own line (owner, October
2026). It never settles its Trip on its own and never makes its Trip "stated"
on the invoice: a Trip only EC lines name is missing its line and is added like
any other missing transport (`toNamedTripIds`, and missing transports are
compared with transport lines only). The added line carries only the EK those
EC lines do not already charge (`missing/ek-on-cost-lines.ts`, the rule of
`reconcileTripRows`), and the Trip is then one payable transport over its EC
lines and the added line (`payment/invoice-payments.ts`). Beside a transport
line stating the same date, booking and container, an EK line is that
transport's split EK, as before.

**An EK line that states a whole transport is that transport's line** (owner,
October 2026, `matching/ec-transport-lines.ts`). A row shaped like an EC line
that states a day, a booking AND a container is matched as a transport line —
on those three values, never on its EC number — whenever no transport line of
the document names that Trip; its empty prices are then filled. Its `EC <nr>`
is a Remarks part: a number the Trip holds no confirmation for is reported on
the line beside a match that stands. When the Trip has a transport line of its
own, the row stays the EC line it is. Whatever the transport match finds for
such a row — one Trip, several, one in conflict — stands; only a row the three
values find NO Trip for goes on to its EC number, which never chooses between
Trips the match found. An EC line stating no container names a charge, not a
transport, and is handled as above.

### Combinations and `GEEN COMBI`

The customer marks a Combination with `COMBINATION ` as the Endpoint of the
first leg and the Startpoint of the second, which is the row directly below and
states the same container (all 13 pairs of week 41). A first leg pairs with that
row, or else with the ONE second leg of its container; anything else is
reported (`combination/excel-combination-pairs.ts`).

Each pair is judged against the system's grouping
(`combination/combination-verdict.ts`):

| Both rows matched to two different Trips, and | Verdict |
|---|---|
| the Trips form one group of exactly two | `RECOGNISED` |
| neither Trip belongs to any group | `GEEN_COMBI` — the Backload of both lines is removed (the cell is emptied), the one exception to "only ever up" |
| anything else (one grouped, two groups, a group of three) | `REVIEW` |

A row of the pair not reliably matched, or a leg without a partner, is
`REVIEW`. A `REVIEW` line, and a recognised pair whose two snapshots do not
carry the same `combinationRouteGroupId`, is `COMBINATION_REVIEW`: yellow,
nothing written. Both lines of a `GEEN_COMBI` pair get `GEEN COMBI` in Remarks
(phase 3).

### Missing transports

The period is Monday to Friday of the ISO week of the transport lines
(`toInvoicePeriod`); lines in more than one ISO week name no period and nothing
is added. A CLOSED, unpaid Trip planned (`planningDate`) in that period whose
identity no line states and that no line resolved to is missing — unless an
UNRESOLVED line (not found, ambiguous, conflict, incomplete row — never an EC
line, which is not a transport's own line) states its booking or container: then it may be that very
transport with a typo, and it is reported as blocked instead of added
(`missing/missing-trip-blocking.ts`). Missing transports are decided only after
the whole matching above, so a Trip a line reaches through a corrected value is
on the invoice and is neither added nor blocked.

How each missing transport is written is phase 4 — see "Added lines" below.

## Comparing prices (phase 1)

### Only a reliable price is used

Before a line is compared, the matched Trip's stored price is judged from what
was stored with it (`pricing/price-reliability.ts`). The line is
`PRICE_UNRELIABLE` — marked yellow, nothing written, never settled — when:

| Stored data | Reason |
|---|---|
| no snapshot | `NO_SNAPSHOT` |
| `routeMatch.method` is null | `METADATA_MISSING` |
| route `NOT_FOUND` / `AMBIGUOUS` | `ROUTE_NOT_FOUND` / `ROUTE_AMBIGUOUS` |
| grouped Trip, Combination not `MATCHED` | `COMBINATION_NOT_PRICED` |
| snapshot contradicts the Trip's group (Backload or Combination without a group, a group without a Combination record) | `SNAPSHOT_INCONSISTENT` |
| (phase 2) a Combination the Excel marks that cannot be confirmed | `COMBINATION_REVIEW` |

**The system's own match decides** (owner, October 2026). A route the matcher
FOUND — `EXACT`, `NORMALIZED`, or `FUZZY` (which the matcher only records for
one unique, uncontested road) — is relied on as found. The check does not judge
the Trip's place and the priced place a second time: `Eindhout` priced on
`LAAKDAL (EINDHOUT)`, `Kallo` on `Kallo (Beveren)` are the system's successful
matches, and their spelling is no reason to doubt the price. Until October 2026
the check reconstructed a "relation" between the two names for every
`NORMALIZED` match and refused any place in brackets other than `Rumbeke` ↔
`ROESELARE (RUMBEKE)`; that second judgement is gone. For a grouped Trip one
found route still proves nothing about its pair: the Combination conditions
above apply unchanged.

**A route chosen by hand** (snapshot `routeSelection = MANUAL`, owner,
October 2026, completed 20 October 2026). The automatic `NOT_FOUND`,
`AMBIGUOUS` or `PAIR_NOT_CONFIGURED` the choice was made for is no reason to
distrust the price. It is relied on when what is stored NOW confirms it:

| Stored now | Otherwise |
|---|---|
| the snapshot records a route: a whole Combination for a grouped Trip, none for an ungrouped one | `SNAPSHOT_INCONSISTENT` |
| the chosen configuration still exists | `MANUAL_ROUTE_REMOVED` |
| `trip_route_selection` holds the very route the snapshot was priced on — a choice an explicit reprocess (or a road, group or status change) removed is never used | `SNAPSHOT_INCONSISTENT` |
| a chosen Combination: the snapshot's legs are Leg 1 and Leg 2, this Trip priced on one of them | `SNAPSHOT_INCONSISTENT` |
| a chosen Combination: the pricing partner (`pricingPartnerOf`) is chosen AND priced on the other leg of the same Combination — read from its own stored price, also when it is not on the invoice | `COMBINATION_NOT_PRICED` |

These facts are read, never decided: `pricing/manual-route-facts.reader.ts`
(one query for the choices and group members, one for partner prices not
already read). Nothing is matched or priced again. A reliable chosen route is
then compared component by component exactly like any other line, so a real
difference is still corrected or reported. Proven end to end in
`invoice-manual-route.spec.ts`.

The Trip's road, the priced road and the stored match method are shown beside
an unreliable price for information (`pricing/route-description.ts`), never as
a reason of their own. All messages the check shows are Dutch.

### Only ever up

Each component — Tarief, Fuel, Backload, Tol, Tunnel, Others, EK — is compared
on its own with the effective pricing (`EffectivePricingService`), both sides
rounded to the cent (half up):

| System vs invoice | Result |
|---|---|
| system strictly higher | the cell is raised (`RAISE`) |
| equal | nothing |
| system lower | nothing is written; reported as `INVOICE_HIGHER` |

The preview shows each line's comparison per component (`comparisons`,
`dto/invoice-price-comparison.dto.ts`): the Excel figure, Trano's, and what the
corrected file writes — the differences and the components that agree
(`agreements`, read with the same expected amounts the comparison used), in
the invoice's column order. A line that was not compared, or whose price is
not relied on, shows no Trano figure.

A component the Excel leaves empty is compared as €0,00 (owner, October 2026)
and raised to Trano's stored figure like any other (red, the Fuel as the
customer's formula, a zero left empty); the preview shows that cell as
`€0.00 (leeg)` (`excelCellEmpty`). A line stating no transport price
at all says so (`transportPricesFilled`): its prices come from Trano. With a
price that is not relied on — or no stored price — nothing is filled and the
reliability warning says why. An EC line is never given a transport price; a
transport only EC lines name is added as a missing line (see above).

- An empty cell compares as zero. A cell holding a word, a dash, an Excel error
  or an uncalculated formula makes the whole line `AMOUNT_UNREADABLE`.
- The toll is compared as Maut + Tol B + Tol FR and raised in Tol B only.
- A transport stated on several rows (Cost Confirmation lines) is added up per
  component. A raise that several rows could carry is `NOT_DISTRIBUTABLE`, and
  then nothing on the whole line is written.
- The only amount that may go down is the Backload of an established
  `GEEN COMBI` (removal, phase 2).

### Fuel

Fuel is compared on its own on every reliably priced line — also when the
Tarief already agrees, and whatever the other components do. The expected
Fuel is **the Trip's own percentage of the line's FINAL Tarief** — the higher
of the invoice's Tarief and the system's, since a Tarief is only ever raised
(owner, 19 October 2026). The percentage is the one stored on the snapshot's
fuel line (or, for an older snapshot, the ratio of its own Fuel to its own
Tarief), never the current setting; the amount comes from the pricing read
side (`fuelOnTarief` in `trip-pricing/effective-pricing.ts`, the same rule as
every screen), so the check has no Fuel rule of its own.

| System Tarief / Fuel | Invoice Tarief | Invoice Fuel | Fuel owed | Result |
|---|---|---|---|---|
| 200 / 40 (20%) | 200 | 30 | 40 | raised to 40 |
| 200 / 40 (20%) | 150 → 200 | 30 | 40 | Tarief and Fuel raised |
| 200 / 40 (20%) | 250 (stays) | 40 | 50 | raised to 50 |
| 200 / 40 (20%) | 250 (stays) | 60 | 50 | left; reported as invoice higher |

A Tarief of zero owes no Fuel, and a Fuel on the invoice is never lowered.
Proven end to end in `invoice-fuel-check.spec.ts`.

The target is the higher of the invoice's Fuel and the system's. Because Excel
recalculates every formula when the file is opened, the cell is written so it
keeps that target (`pricing/fuel-cell-plan.ts`):

1. the cell's own formula, if it comes to the target with the row's final Tarief;
2. otherwise the system's percentage in the customer's shape (`20%*L5`), if
   that comes to it exactly — the percentage is the one stored on the snapshot's
   fuel line, never the current setting;
3. otherwise the amount as a fixed figure.

Example (week 41, row 5): Tarief 229 → 300, Fuel `=24%*L5` = 54,96, system Fuel
45,00. The Fuel stays 54,96 and is written as a figure (`KEEP_AMOUNT`), because
`24%*L5` would become 72,00.

## Remarks and marking (phase 3)

### Remarks in the customer's words

Each Trip's first own transport line (never a Cost Confirmation line, never a
second split row) is completed with what it does not say yet
(`remarks/remark-plan.ts`, words in `remarks/customer-remark-vocabulary.ts`):

| Fact | Written as | Already there when a part… |
|---|---|---|
| an assigned Custom Property, also at €0 | its name in lower case: `flat`, `stop`, `chassis` | equals the name, any case |
| TAR charged by the Engine, or assigned | `tar` | begins with the word `tar` (`tar 869`, `Tar 1742 OP`) |
| every Cost Confirmation of the Trip | `EC <nr>` | names that number on ANY row of the Trip |
| a waiting window — also one ending the next day | `wachtuur H:MM tot H:MM` | contains `wachtuur` |
| a `GEEN_COMBI` pair | `GEEN COMBI` | is exactly those words |
| the Trip's Extra notities (`internal_notes`), whatever its price | the note as written, on one line, last | contains the whole note, any case |

- New parts go at the END, separated by `,` without a space; the existing text
  stays exactly as it was (only trailing spaces give way to the comma).
- No translation is invented: a property name is written as its name in lower
  case — also when this invoice has never used the word, which is no reason
  for a note (owner, October 2026). A waiting window ending the next day
  (`waiting_time_ends_next_day`) is written like any other, as the stored
  window pricing used (`wachtuur 22:00 tot 1:30`); only a waiting time without
  a complete window — a duration alone, a missing begin or end — is not
  written, and reported. Over ST is never written.
- The Trip's own facts are only written on a line whose price is relied on;
  `GEEN COMBI` also on a line marked for its price, because the pair itself was
  established from two reliably matched Trips.
- A completed Remarks cell is red, as in the owner's own corrections of week 36.
- Running the check again on the corrected file adds nothing.

### Red and yellow

`workbook/cell-marking.ts`:

- **red text** on exactly the cells whose value this check changed: a raised
  or removed amount, a corrected container or booking number, completed
  Remarks. A Fuel cell rewritten only to keep its amount (`KEEP_AMOUNT`) is not
  red.
- **felgeel**, the whole row from column A to the last column of the header
  (`U` in week 41), empty cells included and over any fill the customer gave
  that row, for every line somebody has to look at.
- Fill and font are separate: a red value on a yellow row keeps both. Every
  change assigns a NEW style object to the one cell, because ExcelJS shares one
  style object between all cells with the same style.

### Totals

The cached results of the totals row and the summary block are refreshed
(`workbook/totals-refresher.ts`). ExcelJS keeps no cached result of exactly 0,
so a summary cell reading a total that came to nothing reads the freshly
computed figure rather than the cell — before October 2026 it kept its stale
figure (week 41: a Backloads line of 1300 beside a total without them).

## Added lines, totals structure and Fuel header (phase 4)

### The totals structure comes first

`workbook/totals-structure.ts` checks, before anything is planned into the
document, that the totals can take an added line. Added lines open room directly
above the totals row, and only a range that ends directly above it grows over
them. Required, as in every real week (week 41: totals on 128, summary
130–139):

- each amount column's total is `SUM(X<first line>:X<row above the totals>)`
  of its own column;
- one cell of the totals row is the grand total `SUM(L<t>:T<t>)`;
- every single reference in the summary block reads the totals row;
- the summary's Fuel label states the header's percentage.

A document without a totals row is sound: nothing can leave a line out. A
document that deviates (week 36 as corrected by hand had `SUM(N2:N138)` beside
`SUM(L2:L141)`) gets **no added line and no new Fuel header**. The missing
transports are still reported, with no row; the deviations are reported as
found and never "fixed".

### Added lines

`missing/added-rows.ts` (planning) and `workbook/invoice-row-appender.ts`
(writing). Each line goes directly above the totals row, which moves down with
the summary; every formula is rewritten for the move (`openRowsAt`).

- **Look**: each column takes the style the customer's lines usually have.
- **Red**: every amount written, the booking number and the container number —
  what the customer never stated. Everything else, Remarks included, keeps the
  customer's formatting.
- **Remarks**: the same facts and vocabulary as a completed line (`tar`,
  `EC <nr>`, lower-case property names, `wachtuur H:MM tot H:MM`, comma without
  space). For a Trip whose price is not reliable, property names and `tar` are
  left out — they come from that price; confirmations and waiting time are
  still written. What has no customer spelling is reported.
- **`COMBINATION`**: only for a Trip whose group holds exactly two Trips — on
  the Endpoint of a DELIVERY leg, on the Startpoint of a COLLECTION leg, spelled
  as the document's own legs spell it (`COMBINATION ` with its trailing space in
  every real week). Two missing legs of one group are written together, the
  DELIVERY leg first.
- **Amounts**: only when the stored price is reliable (see "Only a reliable
  price is used"). Otherwise the line is added with no amounts and the whole row
  is yellow. Zero is an empty cell (a Tarief of zero: no Fuel, an empty cell).
  **Fuel is a formula on the line's own Tarief** (`24%*L5`), so Excel
  calculates it like on the customer's own lines, at the Trip's OWN percentage
  — the rate its stored price was calculated at, never a constant and never
  today's setting; for a snapshot that recorded none, the document's own
  percentage (October 2026). A percentage is used only when its formula comes
  to the stored Fuel exactly; otherwise the amount is written as a figure.
- An added line with a reliable price is settled like any other (see "When a
  transport is payable"); one without stays unpaid. The document records every
  added line (see `invoice-audit-marker.ts`) so a later upload recognises it.

### Fuel header

`workbook/fuel-header.ts`. The header (`Fuel 24%`) and the summary's Fuel label
are rewritten only when, after the corrections, EVERY Fuel cell that states an
amount is `P%*L<own row>` for one and the same new P — the added lines included:
each one with a reliable price and a Fuel must come out exactly at P. A column
that ends up mixed keeps its header and label exactly. Only the number changes;
the words, spacing and trailing space (`Fuel 24% `) stay. The change is part of
the result (`fuelHeader`: address, before, after).

## Preview, correction and payment (phase 5)

Three separate steps (`invoice-audit.service.ts`, `payment/`):

1. **Check — the preview.** The document is examined
   (`invoice-examination.service.ts`) and the corrections are written into an
   in-memory copy of it, exactly as the corrected file will have them; the copy
   is never returned. The preview shows, beside every line: the yellow rows
   (`markedRowNumbers`), the added and blocked transports, the Fuel header, the
   totals of every amount column before and after (`workbook/line-totals.ts`,
   read off the cells), and which transports may be settled.
2. **Apply — the corrected file.** The same examination and writing, then the
   bytes. Nothing in the system changes; nothing is paid.
3. **Payment — the operator's confirmation.** The original file comes up again
   with the Trip ids the operator chose. The document is examined AGAIN — the
   preview is never trusted — and every chosen Trip must be payable on that
   fresh examination; one that is not (or is not on the invoice at all) refuses
   the whole request and nothing is paid. The rest are paid in one transaction
   whose update repeats the conditions (CLOSED, not yet paid), so a Trip
   reopened or paid by somebody in between rolls everything back
   (`payment/invoice-payment.repository.ts`). Chosen Trips already paid are left
   alone: confirming twice changes nothing.

### When a transport is payable

`payment/invoice-payments.ts` composes the whole rule — the lines of the
document (`payment/payment-eligibility.ts`) and the transports it did not state
(`payment/missing-trip-payments.ts`) — once, for the preview and for the
confirmation alike.

**A transport the document charges** is payable when ALL of:

- it has a line of its own: matched (MATCHED), or added by this check to an
  earlier correction of the document (ADDED_MISSING) — Cost Confirmation lines
  alone are never a ground (`NO_OWN_LINE`);
- the Trip is CLOSED (`NOT_CLOSED`);
- every line charging it came out `MATCHED_NO_CHANGES`, `PRICING_CORRECTED` or
  `INVOICE_HIGHER` — which requires a reliable price
  (`PRICE_NOT_SETTLED`);
- none of its lines is yellow (`LINE_MARKED`);
- no unresolved TRANSPORT line names it as a candidate
  (`payment/unresolved-line-claims.ts`): an ambiguous line (`AMBIGUOUS_MATCH`)
  or a conflict (`MATCH_CONFLICT`). An EC line that could not be linked never
  holds its transport back — it is never the transport's own line, and only its
  EK stays unchecked.

**A transport only unresolved lines name** — no line resolved to it — is listed
too, not payable, with those reasons (`NOT_CLOSED` for an unfinished one), so
no transport of the invoice stays unpaid without the check saying why.

Every transport not payable for a match problem carries `blockingRowNumbers`:
the rows to fix. The preview shows each reason with those rows and what to do.

**A transport this system holds that the invoice did not state** (owner,
October 2026) is paid when it was added to the corrected document with a price
this system relies on — the corrected invoice the customer pays carries it.
Only a price problem keeps it unpaid: added without amounts, yellow
(`PRICE_NOT_SETTLED`). Two kinds are not on the corrected invoice and stay
unpaid for that reason: not added because the document's totals deviate
(`NOT_ADDED`), and blocked because an unresolved line could be that transport
(`BLOCKED_BY_UNRESOLVED_LINE`, with the blocking rows). Until October 2026 an added transport was never settled.

A payable transport has a category: `UNCHANGED`, `RAISED`, `ADDED` (not on
the customer's invoice, added to the corrected one), or `INVOICE_HIGHER` —
payable, because everything owed is on the invoice, but shown apart because a
higher figure can point at an outdated price. A payable transport that is
already paid is reported as re-invoiced and never paid again.

## The written workbook is verified (phase 6)

No corrected file leaves the system unchecked (`workbook/invoice-workbook-verifier.ts`).

1. **A change plan first** (`workbook/change-plan.ts`), made from the
   examination's DECISIONS — pricing outcomes, corrections, completed Remarks,
   yellow rows, added lines, Fuel header — before the writer runs, and never
   from what the writer reports. Addresses are in the written document's rows:
   everything at or below the opening for added lines has moved down.
2. **Then the bytes.** The received file and the written file are both read
   FRESH by a new ExcelJS and compared cell by cell across the move
   (`workbook/workbook-integrity-check.ts`, `workbook/cell-comparison.ts`):
   - a planned cell holds exactly the planned value or formula, red where
     planned, every other style kept;
   - the totals row and summary keep their formulas (as rewritten for the
     inserted rows); their cached results may follow, their zero format may be
     blanked;
   - every other cell keeps value, formula and style — except the fill of a
     row planned yellow;
   - row heights and visibility, column widths and visibility, merged ranges and
     the other worksheets are unchanged; added lines carry their planned booking
     and container in red, yellow only when planned; the hidden record names
     exactly the added lines (`workbook/workbook-shape-check.ts`).
   Normalised as the same cell: a borrowed shared formula and the formula
   written out; a cached result of 0 and none; an empty border or a fill of
   pattern `none` and none; a font property left out and ExcelJS's base font.
3. **Independent totals checks** for a document whose structure was sound: on
   the written document every component SUM covers the added lines, the grand
   total is `SUM(L:T)` of the totals row, the summary reads the moved totals row
   (`totals-structure.ts`), and every total shows — at the cent — what its lines
   add up to (`totals-results.ts`).

Any difference the plan does not name refuses the whole file with
`InvoiceWorkbookIntegrityException` (500): no file, no success message, and the
payment confirmation — which produces and verifies the corrected file again
before it pays — pays nothing. The differences (addresses, never amounts) are
in the error's `details` and in the structured log.
