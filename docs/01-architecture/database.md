# Database

This document describes the logical database model.

Implementation details (Prisma, SQL, etc.) are intentionally excluded.

---

# Core Principles

- Every entity has a unique identifier.
- Data should never be unnecessarily duplicated.
- Historical information must be preserved.
- Relationships should be explicit.
- Business logic is not part of the database model.

---

# Core Entities

The Transport Management System consists of the following core entities.

## Trip

Represents one transport movement.

A Trip contains:

- Vehicle
- Driver
- Status
- Trip Group
- Original Date
- Planning Date
- Execution Date
- Start Time
- End Time
- Container Number
- Container Source
- Container Type
- Booking Number
- Terminal
- Address
- Waiting Time
- PDF
- Pricing
- Notes

Relationships

Trip

→ Vehicle

→ Driver

→ TripGroup

→ PdfDocument

→ TripPricing

→ TripHistory

→ TripCustomProperties

---

## Trip Status

Supported values

OPEN

FINISHED

CANCELLED

---

## Trip Group

Groups multiple trips belonging to one transport order.

Trips remain independent.

---

## Vehicle

Represents one truck.

Contains:

- License Plate
- Driver
- Status
- Maintenance
- Documents

---

## Driver

Represents one driver.

Contains:

- Name
- Contact Information
- Vacation Planning
- Active Status

---

## PDF Document

Represents one imported PDF.

Contains:

- Original filename
- Storage location
- Import date
- Email metadata
- Parser information

---

## Trip Pricing

Contains all calculated prices belonging to one trip.

Calculation rules are documented separately.

---

## Maintenance

Stores maintenance history.

Maintenance records are never deleted.

---

## Calendar Event

Represents appointments inside the planner.

---

## Note

Represents administrator notes.

Notes may optionally belong to a calendar event.

---

## Custom Property

Represents configurable administrator-defined properties.

Examples

Flat

Tar

Over St-Niklaas

Future custom values

---

## Settings

Stores configurable application settings.

Examples

Fuel percentage

Pricing configuration

Parser configuration

General application settings

---

## Trip History

Stores audit information.

Every important change should be traceable.

Examples

Planning change

Container change

Status change

Manual override

Pricing recalculation

Driver change