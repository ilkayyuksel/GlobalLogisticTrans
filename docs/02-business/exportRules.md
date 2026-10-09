# Export Rules

## Purpose

This document defines how trip information is exported from the Transport Management System.

Exports are primarily used for invoicing and administrative purposes.

The exported values should always reflect the latest calculated pricing.

---

# Supported Export Types

The system currently supports:

Daily Export

Weekly Export

Monthly Export (future)

Custom Period (future)

---

# Export Format

Current export format:

Microsoft Excel (.xlsx)

Future formats may include:

PDF

CSV

JSON

---

# Data Source

The export never performs calculations.

All prices must already exist in the database.

The export only reads data.

Pricing calculations belong exclusively to the Pricing Engine.

---

# Export Selection

The Administrator chooses:

Day

Week

Month (future)

The system exports all matching trips.

---

# Included Trips

By default include:

Finished Trips

Planned Trips

Cancelled Trips (optional)

Deleted Trips (optional)

Filters should be configurable.

---

# Export Layout

Rows represent trips.

Columns represent trip information.

Every trip occupies exactly one row.

Combination trips occupy two separate rows.

---

# Export Order

Trips are sorted by:

Planning Date

↓

Driver

↓

Start Time

↓

Booking Number

This ensures a predictable layout.

---

# Exported Information

Every exported trip should include:

Planning Date

Original Date

Booking Number

Container Number

Container Type

Terminal

Address

Driver

Vehicle

Status

Waiting Time

Custom Properties

Trip Type

Combination Indicator

Pricing Breakdown

Total

Notes (optional)

---

# Pricing

The export includes the complete pricing breakdown.

Examples:

Base Tariff

Fuel

Waiting Time

Tunnel

Custom Properties

Additional Costs

Total

No calculations should occur during export.

## Only a CLOSED Trip has a current price

A Trip that is OPEN, CANCELLED or DELETED shows no price anywhere — in the
Ritten list, both workbooks, the Trip page and the invoice check — even when
an older snapshot is stored for it. That snapshot is kept as history and is
replaced when the Trip closes again, which prices it afresh from its current
data. The rule lives in one place in the backend (`current-pricing.ts`).

## Where every money and remarks column comes from

Both workbooks are built in the browser from three backend answers: the Trip
(`GET /trips`, including its effective `pricing`), its stored pricing snapshot
(the Engine's lines), and the export words (`GET /trip-export/labels`). The
snapshot decides WHETHER a component applies — no line, an empty cell; a
stored €0 is printed as 0.00. The effective pricing decides what it is worth
where an operator may correct it. Nothing is calculated in the export.

### BASIS (the daily dispatch sheet)

| Column | Source and rule |
|---|---|
| COMBI EN KOST | The stored amounts joined with ` + `, in this order: the COMBINATION line (Backload, €50 per leg the Engine charged); the operator's Custom Properties, in the order INFO names them; the system-managed property charges (TAR, Flat); the EK — the effective EK (`trip.pricing.ek`: the charged waiting time, else the summed Cost Confirmations), printed when the snapshot has a waiting-time or Cost Confirmation line. A property without a price has no line and therefore no amount. |
| INFO | LOSRIT; `COMBI` when the snapshot has a COMBINATION line; the operator's PRICED Custom Properties (not route-priced, not system-managed), in display order; `TAR` when the Engine charged it; the waiting window when minutes were recorded; every Cost Confirmation reference (`CC4139505`), also when a charged waiting time is the EK; the operator's UNPRICED Custom Properties; the internal note. |

The two columns are read side by side, amount under word, so every word that
has an amount comes first and in the same order as its amount. A Custom
Property without a price is information only: it has no amount and is named
after all of them. Which properties are priced: for a priced Trip, those with a
stored line (an explicit €0 price has one, and prints `0.00`); for a Trip with
no current price, those with a configured price in the catalog.

An OPEN Trip has no current price (see below): COMBI EN KOST is empty, and
INFO carries no `COMBI` and no `TAR`, which describe a charge. Its properties,
waiting window, CC references, LOSRIT and note are still printed.

The CC references (in INFO and in Remarks) come from the Trip's Cost
Confirmation records — every one, newest first, each once — never from the
pricing snapshot. Which documents Eucon sent is a fact about the Trip, so an
OPEN Trip names all of them; reading them calculates nothing.

BASIS has no Tarief, Brandstof, Toll, Tunnel, EK or total column; those are
in PRIJSOVERZICHT.

### PRIJSOVERZICHT (the price list)

| Column | Source and rule |
|---|---|
| Tarief, Brandstof, Backload, Tol, Tunnel | Present when the snapshot has the line; the amount is the effective one, so a corrected Tarief carries its own fuel. |
| Others | The stored Custom Property lines, summed. |
| Wachttijd | The stored waiting-time line. Informational: it is not added to anything. |
| EK | The effective EK, exactly as in BASIS (shared `toEkAmount`). |
| Remarks | The backend's Remarks text: properties, TAR, the waiting window, every CC reference. |

The total of a Trip is Tarief + Brandstof + Backload + Tol + Tunnel + Others +
EK; the Wachttijd column is never part of it.

---

# Combination Trips

Combination trips remain separate rows.

Both rows should indicate:

Same Group

Same Booking Number

Independent Pricing

This preserves planning flexibility.

---

# PDF Reference

The export should optionally include:

PDF Filename

or

Document Reference

The PDF itself is not embedded.

---

# Formatting

Dates should use the configured format.

Currency should use:

EUR

Decimal separator should be configurable.

Column widths should be optimized automatically.

Headers should be bold.

---

# File Naming

Suggested format:

Trips_2026-08-10.xlsx

Weekly export:

Trips_Week_32_2026.xlsx

The filename should be configurable.

---

# Empty Exports

If no trips match the selected period,

the system should notify the Administrator.

An empty Excel file should not be generated.

---

# Export History

Every export should be logged.

Suggested information:

Date

User

Period

Number of Trips

Filename

Duration

---

# Performance

Exports should remain responsive.

Large exports should be generated asynchronously if necessary.

The Administrator should receive feedback during generation.

---

# Future Extensions

Future export options may include:

Customer-specific exports

Accounting exports

Invoice exports

Driver reports

Vehicle reports

Maintenance reports

Financial summaries

The export architecture should remain extensible.

---

# Responsibilities

Backend

Collect export data.

Pricing Engine

Provide calculated pricing.

Frontend

Allow export selection.

Excel Generator

Create the workbook.

The export process must never modify data.