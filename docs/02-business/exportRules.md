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