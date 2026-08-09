# Business Rules

This document describes the business behaviour of the Transport Management System.

It intentionally does NOT describe implementation details.

Whenever implementation changes, these business rules should remain valid.

---

# 1. Email Processing

Transport orders are received by email.

The monitored mailbox is configured through environment variables.

Only emails from configured trusted senders may be processed.

The subject determines the type of processing.

Supported prefixes:

NEW:

UPDATE:

CANCEL:

Every supported email contains exactly one PDF attachment.

---

## NEW

A NEW email represents one new transport order.

The PDF is downloaded.

The PDF is parsed.

One or more trips are created depending on the PDF contents.

---

## UPDATE

An UPDATE email represents an update of an existing transport order.

The parser extracts the updated values.

The existing trip(s) must be updated.

Only values present inside the PDF may overwrite existing automatic values.

Manual values entered by an administrator must never be overwritten automatically.

The complete update history should remain traceable.

---

## CANCEL

A CANCEL email represents a cancelled transport order.

Trips are never physically deleted.

Instead they receive the status:

Cancelled

Cancelled trips remain available for history and exports.

---

# 2. PDF Processing

The PDF parser is responsible for extracting structured information.

The parser never performs business decisions.

The parser only returns structured data.

The required extracted fields are documented separately inside:

pdfParserRules.md

---

# 3. Trip Creation

A parsed PDF can generate:

one trip

multiple trips

a combination of linked trips

Trip creation rules are documented in:

pdfParserRules.md

---

# 4. Trip Planning

Trips are automatically planned on the scheduled execution date extracted from the PDF.

Administrators may move trips to another planning date.

Changing the planning date does NOT change the original transport date.

The system therefore distinguishes between:

Original planned date

Actual planning date

Actual execution date

These values must remain available for reporting.

---

# 5. Driver Assignment

Each trip must be assigned to exactly one vehicle.

A vehicle may optionally be linked to a driver.

Assignments are managed by administrators.

Planning should visually group trips by assigned vehicle.

Trips assigned to the same vehicle should appear together.

Each vehicle receives a unique planning color.

The color remains consistent throughout the application.

---

# 6. Trip Status

A trip progresses through a defined lifecycle.

Example:

Open

↓

Planned

↓

In Progress

↓

Finished

↓

Cancelled

Status transitions should always remain valid.

Invalid transitions are not allowed.

Trips are never deleted.

---

# 7. Finished Trips

When a trip is marked as Finished:

Pricing calculations are executed.

Statistics are updated.

Dashboard values are refreshed.

The trip becomes available for export.

Pricing behaviour is documented inside:

pricing/pricing_rules.md

---

# 8. Combination Trips

One transport order may contain multiple trips.

These trips belong to the same Trip Group.

Trips remain completely independent.

Each trip has its own:

planning date

execution date

status

driver

vehicle

container

booking

One trip may be moved without affecting the others.

The relationship between trips must always remain visible.

---

# 9. Export

Administrators can export trips.

Supported exports:

Daily

Weekly

Future exports may include:

Monthly

Custom date range

Exports always include calculated pricing.

Cancelled trips remain exportable.

---

# 10. Fleet Management

Vehicles are managed centrally.

Trailers are managed separately.

Maintenance records are never deleted.

Maintenance history must remain complete.

Future maintenance reminders are generated from the configured maintenance schedule.

---

# 11. Driver Availability

Administrators can register driver absences.

Unavailable drivers cannot be assigned to new trips during the configured period.

Historical trips remain unaffected.

---

# 12. Settings

Administrators manage:

Vehicles

Drivers

Custom Properties

Pricing Settings

Fuel Settings

General Settings

These settings affect future planning only.

Historical trips should remain unchanged unless explicitly recalculated.

---

# 13. Pricing

Pricing is rule based.

Pricing is never hardcoded.

The calculation rules are documented separately.

See:

pricing/pricing_rules.md

---

# 14. Auditability

Every important change should remain traceable.

Examples:

Manual container changes

Trip updates

Planning changes

Driver changes

Pricing recalculations

Cancellation

The system should always make clear whether a value originated from:

PDF

Administrator

Automatic calculation

System default

---

# 15. Data Integrity

Trips are never permanently deleted.

Historical information must remain available.

Manual administrator input always has priority over automatically extracted values unless explicitly reset.

The system should always preserve historical consistency.