# Planning Rules

## Purpose

This document defines how trips are managed after they have been imported.

The planning system is responsible for organizing trips, assigning drivers and vehicles, managing statuses, grouping trips and allowing manual adjustments by the administrator.

Planning is the central workflow of the application.

---

# General Principles

Planning is performed by the Administrator.

Drivers never modify trips.

The planning system should always preserve history.

No operation should permanently remove important business data.

---

# Planning Views

The planning dashboard supports multiple views.

Supported views:

- Day
- Week
- Month

Trips are grouped by planning date.

---

# Trip Dates

Every trip contains two different dates.

## Original Date

The date extracted from the PDF.

This value never changes.

---

## Planning Date

The date chosen by the Administrator.

Initially:

Planning Date = Original Date

If a trip is postponed,

only the Planning Date changes.

The Original Date remains unchanged.

---

# Moving Trips

The Administrator may move any trip to another planning day.

Examples:

Driver ran out of time.

Customer requested another day.

Terminal closed.

Vehicle unavailable.

Moving a trip must never modify:

Booking Number

Container

PDF

Trip Group

Original Date

Only the Planning Date changes.

---

# Trip Status

Every trip has exactly one status.

Supported statuses:

NEW

PLANNED

IN_PROGRESS

FINISHED

CANCELLED

DELETED

---

## NEW

The trip has just been imported.

No driver assigned.

---

## PLANNED

Driver and vehicle assigned.

Waiting to be executed.

---

## IN_PROGRESS

Optional future status.

The driver has started the trip.

---

## FINISHED

The trip has been completed.

Pricing calculations become final.

The trip remains visible.

---

## CANCELLED

The customer cancelled the trip.

The trip remains in the database.

Cancelled trips are hidden from active planning by default.

---

## DELETED

Logical deletion.

The Administrator has removed the trip from planning.

The trip is never physically deleted.

---

# Trip Assignment

Every trip is assigned to:

One Driver

One Vehicle

Assignment is performed manually.

---

# Vehicle Assignment

Vehicles are selected from Settings.

A vehicle cannot be typed manually.

Only registered vehicles may be selected.

---

# Driver Assignment

Drivers are selected from Settings.

Drivers on vacation should not be selectable.

The system should clearly indicate unavailable drivers.

---

# Planning Order

Within a planning day,

trips should be grouped by Driver.

Trips belonging to the same Driver should appear together.

Inside each Driver group,

trips are sorted chronologically.

---

# Driver Colors

Each Driver receives a unique planning color.

Every trip assigned to that Driver uses the same color.

This improves visual planning.

Colors are configured automatically.

---

# Trip Groups

Trips originating from one Combination PDF belong to the same Trip Group.

A Trip Group is only a visual relationship.

Trips remain fully independent.

---

# Combination Trips

Combination trips share:

Trip Group

Booking Number

PDF

They may have different:

Driver

Vehicle

Planning Date

Status

Container Number

Waiting Time

Custom Properties

Pricing

---

# Group Operations

The Administrator may:

View Group

Collapse Group

Expand Group

Remove Group

Removing a group should never delete trips.

It only removes the relationship.

---

# Container Number

Container Number may be empty.

Example:

Loading trip.

After the driver has collected the container,

the Administrator manually enters the container number.

The value is stored permanently.

Parser updates must never overwrite manually entered container numbers.

---

# Waiting Time

Every trip contains Waiting Time.

Waiting Time is entered manually.

Format:

Hours

Minutes

Waiting Time affects pricing.

---

# Custom Properties

Every trip supports multiple Custom Properties.

Examples:

Over Sint-Niklaas

Flat

TAR

Additional properties may be added in Settings.

Multiple values may be selected.

Custom Properties affect pricing.

---

# PDF

Every trip keeps a reference to its original PDF.

The Administrator can:

View PDF

Download PDF

Reprocess PDF

The PDF never changes.

---

# Reprocessing

The Administrator may reprocess a trip.

Reprocessing:

Uses the current parser.

Uses the current pricing rules.

Does not overwrite manually maintained planning information.

Manual fields include:

Driver

Vehicle

Planning Date

Container Number entered manually

Waiting Time

Custom Properties

Status

Notes

---

# Finish Trip

When a trip is marked as Finished:

Status becomes FINISHED.

Pricing is recalculated.

Trip remains visible.

Trip becomes available for reporting.

---

# Delete Trip

Deleting a trip means:

Status = DELETED

The trip remains in the database.

Deleted trips are hidden by default.

Deleted trips remain available for exports if explicitly requested.

---

# Notes

Each trip may contain internal notes.

Notes are never imported from PDFs.

Notes are editable by the Administrator.

---

# Filters

Planning should support filtering by:

Date

Driver

Vehicle

Status

Terminal

Booking Number

Container Number

Trip Type

Combination

Custom Properties

---

# Search

Search should support:

Booking Number

Container Number

Address

Driver

Vehicle

Terminal

PDF filename

---

# History

Every important action should be stored.

Examples:

Trip imported

Trip updated

Trip cancelled

Trip moved

Driver changed

Vehicle changed

Status changed

Pricing recalculated

Container number entered manually

Custom Properties changed

Waiting Time changed

---

# Responsibilities

Parser

Creates Parsed Trips.

Backend

Creates and updates Trips.

Planning

Organizes Trips.

Pricing Engine

Calculates prices.

Frontend

Displays planning.

The planning system never performs parsing.