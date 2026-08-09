# PDF Parser Rules

## Purpose

This document defines how transport order PDFs are converted into structured trips.

The parser only extracts structured information.

It never performs:

- Database operations
- Pricing calculations
- Planning
- Business decisions

The parser produces Parsed Trips that are validated by the Backend.

---

# Supported Documents

Currently supported:

- Eucon Trucking Orders

The parser should be extensible so that additional document layouts can be added in the future without modifying existing parsers.

Each supported layout should have its own parser implementation.

---

# General Principles

The parser should always use the PDF text layer.

OCR should only be used as a fallback if a future layout contains scanned pages.

The parser must never rely on fixed coordinates alone.

It should use a combination of:

- Labels
- Text blocks
- Relative positions
- Regular expressions
- Section detection

to maximize robustness.

---

# Output

The parser always returns:

One Parsed Trip

or

Multiple Parsed Trips

The Backend decides what to do with them.

---

# Required Fields

Each Parsed Trip should contain:

Booking Number

Container Type

Terminal

Address

Date

Start Time

End Time

Trip Type

Container Number (optional)

Combination Information

Raw Parser Metadata

---

# Booking Number

Booking Number is the primary business identifier.

Rules:

Always required.

Always unique.

Combination trips share the same Booking Number.

The parser must fail if no Booking Number can be found.

---

# Container Number

Container Number is optional.

There are two situations.

## Delivery

The container is usually already known.

The parser should extract it.

## Loading

The container often does not yet exist.

The parser should return:

Container Number = NULL

The Admin will manually enter the container number after the driver has collected the container.

The parser must never reject a trip because the container number is missing.

---

# Container Type

Always extract.

Examples:

20TK

20FL

45PH

etc.

---

# Terminal

Extract using labels such as:

Return to Terminal

Startpoint

Terminal

The parser should normalize terminal names where possible.

---

# Address

Extract the loading or delivery address depending on the trip.

Only the final city and country should be stored.

Examples

FR-62119 DOURGES

↓

Dourges, France

BE-2040 Antwerp

↓

Antwerp, Belgium

FR-59166 Bousbecque

↓

Bousbecque, France

The complete raw address should still remain available in Parser Metadata.

---

# Date and Time

Extract:

Date

Start Time

End Time

If only one time exists,

Start Time = End Time.

---

# Trip Type

The parser should determine whether the trip is:

Normal Trip

or

Combination Trip

---

# Combination Detection

A Combination exists when the document explicitly contains:

Combination

Combin

or another supported keyword.

Maximum:

2 trips.

Never more.

---

# Combination Rules

A Combination always consists of exactly two trips.

Both trips share:

Booking Number

PDF

Trip Group

Both trips remain fully independent after import.

Each trip can later:

Move to another planning day.

Receive another driver.

Receive another vehicle.

Be completed independently.

Be cancelled independently.

---

# Trip Group

When parsing a Combination,

the parser should assign both Parsed Trips the same temporary Group Identifier.

The Backend replaces this temporary identifier with the database Trip Group.

---

# Manual Fields

The parser should never overwrite manually maintained values.

Examples:

Assigned Driver

Assigned Vehicle

Waiting Time

Custom Properties

Container Number entered manually

Status

Finished

Planning Date

These values belong to the Backend.

---

# UPDATE Documents

UPDATE documents never create new trips.

The parser extracts the updated information.

The Backend compares:

Database

↓

Parsed Trip

↓

Field by field

Only changed parser-managed fields are updated.

Manual fields remain untouched.

After the update,

Pricing is recalculated.

---

# CANCEL Documents

The parser extracts:

Booking Number

Trip Information

The Backend marks the trip(s) as:

CANCELLED

No trip is deleted.

---

# Parser Metadata

Every parsed document should retain raw parser metadata.

Examples:

Detected Layout

Parser Version

Matched Labels

Confidence

Raw Address

Raw Terminal

Raw Date

Detected Sections

Debug Information

This metadata is used for diagnostics.

---

# Validation

The parser validates:

Known layout

Readable PDF

Booking Number

Container Type

Date

Address

Unsupported layouts should fail gracefully.

---

# Parser Errors

Parser failures should never crash the import process.

Instead,

the parser returns a structured error describing:

Reason

Missing fields

Detected labels

Unexpected layout

Stack trace (development only)

---

# Extensibility

Every new PDF layout should receive:

Its own parser

Its own regression tests

Its own examples

Existing parsers should never be modified unless fixing a bug.

---

# Responsibilities

Parser

Extract information.

Backend

Validate.

Persist.

Compare.

Pricing Engine

Calculate pricing.

Frontend

Display parser results.

The parser never performs business logic.