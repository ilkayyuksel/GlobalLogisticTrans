# Parser Layouts

## Purpose

This document describes every supported Eucon PDF layout.

The parser must first identify the document layout.

Only after the layout has been detected may the parser start extracting data.

The parser should never assume that every PDF has the same structure.

Instead, every supported layout should have its own parser implementation.

---

# Supported Layouts

Currently three layouts are supported.

Layout 1

Single Collection

1 Page

Layout 2

Single Collection

2 Pages

Layout 3

Combination

2 Pages

Future layouts may be added independently.

---

# Layout Detection

The parser should first determine:

Number of pages

↓

Presence of "COMBINATION"

↓

Presence of "COLLECTION"

↓

Presence of "DELIVERY"

↓

Select parser

Never start extracting fields before the layout has been identified.

---

# Layout 1

## Single Collection

Pages

1

Characteristics

Page header

Page 1 of 1

Contains

COLLECTION

Does NOT contain

COMBINATION

Example

transportorder1212816.pdf

Business Result

Creates

1 Trip

Trip Type

Collection

---

## Important Sections

VOYAGE DETAILS

CONTAINER/CARGO

LOADING 1

Redelivery Depot

---

## Fields

Booking Number

Container Type

Address

Date

Time

Return Terminal

Redelivery Depot

Container Number

Optional

Remarks

Optional

---

## Address

Always use the address below

LOADING 1

Only store

City

Country

Examples

F-62119 DOURGES

↓

Dourges, France

---

## Terminal

Always use

Return to Terminal

or

Redelivery Depot

Ignore

Startpoint

---

# Layout 2

## Single Collection

Pages

2

Characteristics

Page 1 contains the trip.

Page 2 only contains additional depot information.

Example

transportorder1352505.pdf

Business Result

Creates

1 Trip

---

## Important Sections

Page 1

VOYAGE DETAILS

CONTAINER/CARGO

LOADING 1

Page 2

Redelivery Depot

Only use Page 2 when required information is missing on Page 1.

Page 1 always has priority.

---

## Fields

Same as Layout 1.

---

## Address

Extract

LOADING 1

Store

Bousbecque, France

instead of

FR-59166 Bousbecque

---

## Container Number

Usually absent.

Return

NULL

Admin enters it later.

---

# Layout 3

## Combination

Pages

2

Characteristics

Contains

COMBINATION

Page 1

DELIVERY

Page 2

COLLECTION

Example

transportorder1212625.pdf

Business Result

Creates

2 Trips

---

## Trip 1

Delivery

Container usually known.

Extract

Container Number

Booking Number

Container Type

Delivery Address

Delivery Date

Delivery Time

---

## Trip 2

Collection

Container often unknown.

Return

Container Number = NULL

Extract

Booking Number

Container Type

Loading Address

Loading Date

Loading Time

---

## Grouping

Both trips belong to one Trip Group.

They share

PDF

Booking Number

Trip Group

They remain independent afterwards.

---

## Planning

After import

Both trips may

Move independently

Receive another driver

Receive another vehicle

Finish independently

Be cancelled independently

The group only indicates that they originated from one Combination document.

---

# Section Detection

The parser should identify sections instead of coordinates.

Supported sections

VOYAGE DETAILS

CONTAINER/CARGO

DELIVERY

DELIVERY 1

LOADING

LOADING 1

Return to Terminal

Redelivery Depot

Startpoint

Address

Date/time

Remarks

Unknown sections should never crash the parser.

---

# Address Rules

Never parse an address based on line numbers.

Instead

Locate

Address

↓

Read following lines

↓

Stop at

Date/time

or

Remarks

Store

City

Country

Raw address remains available in Parser Metadata.

---

# Terminal Rules

Priority

Return to Terminal

↓

Redelivery Depot

↓

Terminal

↓

Startpoint

Startpoint should only be used when no terminal exists.

---

# Booking Number Rules

Locate

Bookings nr/Trip nr

Extract

Booking Number

Ignore

Trip Number

Example

Bookings nr/Trip nr:

ANRBEL2768902 /74204240

Store

ANRBEL2768902

---

# Container Rules

Priority

Container:

↓

Container Number inside CONTAINER/CARGO

↓

NULL

Never invent a container number.

---

# Container Type Rules

Locate

Cntr type

Use the first valid value.

Examples

45PH

45RH

20TK

20RF

etc.

---

# Date Rules

Always use

Date/time

for planning.

Ignore

Document creation date.

Ignore

Estimated Closing

Estimated Sailing

Estimated Arrival

Those are voyage information only.

---

# Unsupported Layouts

If no supported layout is detected

Return

Unsupported Layout

Do not attempt best-effort parsing.

This prevents incorrect trip creation.

---

# Future Layouts

Every new layout should receive

Its own parser

Its own regression tests

Its own example PDF

Existing layouts should never be modified to support unrelated formats.

The parser should remain modular.