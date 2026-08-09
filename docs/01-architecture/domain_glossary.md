# Domain Glossary

## Purpose

This document defines the business terminology used throughout the project.

Its primary purpose is to ensure that every service, developer and AI coding assistant interprets business concepts consistently.

All documentation, database models, backend services and frontend components should use the terminology defined in this document.

If a term is defined here, alternative names should not be introduced elsewhere.

---

# General Rules

- Every business term has exactly one meaning.
- Avoid synonyms unless explicitly documented.
- Backend, Frontend and Database must use the same terminology.
- New business terms should be added to this document before implementation.
- AI assistants should always reference this glossary before making architectural decisions.

---

# Trip

A Trip represents one transport movement.

A Trip may be planned, assigned, completed, cancelled or removed.

Every Trip is an independent business entity.

Even when part of a Combination, every Trip remains fully independent.

---

# Combination

A Combination consists of exactly two linked Trips.

Both Trips belong to the same TripGroup.

Both Trips may be planned independently.

Both Trips may have different:

- Planning Date
- Driver
- Vehicle
- Status
- Waiting Time
- Pricing

Removing one Trip from a Combination must never affect the other Trip.

---

# TripGroup

A TripGroup represents the relationship between two linked Trips.

Its only purpose is grouping.

A TripGroup contains no planning information.

A TripGroup contains no pricing information.

---

# Planning Date

The Planning Date is the date on which a Trip is scheduled to be executed.

The Administrator may change this date.

Changing the Planning Date does not modify the original imported information.

---

# Execution Date

The Execution Date is the actual date on which the Trip was completed.

Execution Date may differ from Planning Date.

---

# Driver

A Driver represents a person performing transport.

Drivers are manually maintained by the Administrator.

Drivers are assigned to Trips.

---

# Vehicle

A Vehicle represents a truck.

Vehicles are assigned manually.

Vehicles are linked to Drivers through the Settings page.

Historical Trips preserve their original Vehicle assignment.

---

# Trailer

A Trailer represents a trailer or semi-trailer.

Trailers are **not** assigned to Trips.

Trailers are currently only used for Maintenance administration.

---

# PdfDocument

A PdfDocument represents the original imported transport document.

The original PDF is never modified.

One PDF may create one or more Trips.

---

# ImportedEmail

An ImportedEmail represents an email processed by the IMAP service.

Supported email types include:

- NEW
- UPDATE
- CANCEL

Every processed email contains exactly one PDF attachment.

---

# ParserRun

A ParserRun represents one execution of the PDF Parser.

ParserRuns are immutable.

Multiple ParserRuns may exist for the same PDF.

---

# Status

Status represents the lifecycle of a Trip.

Examples include:

- New
- Planned
- Finished
- Cancelled
- Removed

Status values are defined centrally.

---

# Finished

Finished means that a Trip has been completed.

When a Trip becomes Finished:

- pricing is calculated
- pricing is stored
- the Trip becomes part of historical reporting

Changing Settings afterwards must not change historical pricing.

---

# Reprocess Pricing

Reprocess Pricing is a manual Administrator action.

Only pricing is recalculated.

Planning information must remain unchanged.

Current Settings are used during recalculation.

---

# Removed

Removed represents a soft delete.

Removed Trips remain stored in the database.

Removed Trips remain available for exports, history and auditing.

Removed Trips must never be physically deleted.

---

# Waiting Time

Waiting Time is entered manually by the Administrator.

Waiting Time is used by the Pricing Engine.

The Pricing Engine never determines Waiting Time automatically.

---

# Route Pricing

Route Pricing represents the configured base price for a transport route.

The Pricing Engine uses Route Pricing when Route-Based Pricing is enabled.

---

# Pricing Component

A Pricing Component represents one individual part of a pricing calculation.

Examples include:

- Base Price
- Fuel
- Waiting Time
- Toll
- Tunnel
- Combination
- Custom Property
- Manual Adjustment

---

# Manual Adjustment

A Manual Adjustment is a manually added pricing component.

It contains:

- Description
- Amount

Manual Adjustments are always positive.

Each Manual Adjustment is stored as its own Pricing Item.

---

# Custom Property

A Custom Property is a configurable business property assigned to a Trip.

Examples include:

- TAR
- Flat
- Over Sint-Niklaas

Custom Properties may influence pricing.

The Pricing Engine processes every assigned Custom Property.

---

# Route

A Route represents the transport path used to determine the Base Price.

A Route typically consists of:

- Departure
- Destination

Future versions may include additional criteria.

---

# Settings

Settings contain configurable application values.

Settings determine application behaviour.

Changing Settings only affects future calculations unless a manual reprocessing is performed.

---

# Pricing Engine

The Pricing Engine is responsible for calculating Trip pricing.

It never modifies planning data.

It only produces pricing data.

The Pricing Engine always follows the pricing order defined in `pricing_rules.md`.

---

# Historical Data

Historical Data represents immutable business information.

Historical records must never change automatically.

Historical information should remain reproducible at all times.

---

# Administrator

The Administrator is the only user of the application.

The Administrator manages:

- Planning
- Drivers
- Vehicles
- Maintenance
- Pricing
- Settings
- Calendar
- Notes

The application currently supports a single Administrator.

---

# Future Extensions

Future business terminology should always be added to this document before implementation.

Existing terminology should never be redefined without updating all related documentation.