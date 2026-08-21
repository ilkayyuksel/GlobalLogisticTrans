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

### Every document is kept

NEW, UPDATE and CANCEL documents are all stored, and none of them replaces
another: an order that receives three updates and is then cancelled keeps all
five documents. The original order is reached through the Trip itself; every
later document through the audit trail, where the event it caused points at it.
One document may concern several Trips - a Combination names two bookings - and
is stored once, with one event per Trip.

The action is recorded when the document arrives (`imported_email.import_type`,
or MANUAL_UPLOAD when there is no email) and is never inferred from a filename.

### An UPDATE for a booking we do not have

Sometimes the original order never reaches us and the first document for a
booking is a revision of it. The UPDATE then CREATES the Trip, from its own
document:

- the Trip is an ordinary imported Trip, status Open
- it carries the parser-controlled values that document states
- the operator-controlled fields stay empty, as they do for any import
- its planning date and original planning date are the document's own date;
  today's date is never used as a fallback
- the UPDATE document becomes the Trip's source document, and its provenance
  stays UPDATE - the action is what arrived

This is NOT recorded as an update. There was no earlier state, so there is no
change set, and no field change is invented. The event says what happened: an
UPDATE document created this Trip because no Trip held its booking number. The
interface shows the document as "Rit aangemaakt" and does NOT mark the Trip
"Bijgewerkt", which means an existing Trip was revised.

A later UPDATE for that booking is an ordinary revision, compared against the
Trip as the first one created it. Everything else is unchanged: a NEW order for
the booking runs into the duplicate rule, a CANCEL cancels it, and an UPDATE
after cancellation or for a CLOSED Trip is refused exactly as before - never by
creating a second Trip.

### Every UPDATE has its own change set

An UPDATE is compared against the Trip AS IT STANDS at that moment, never
against the original order. Each update writes one audit row per field it moved,
all pointing at that update's document, so three updates keep three separate
answers. An update that moves nothing is still recorded, with an empty change
set: the document arrived and was accepted.

A value that returns to an earlier one counts as changed again, because the
document said something the Trip did not.

Only these fields may be changed by a document: container number, container
type, terminal, destination city, destination country, the document's own date,
start and end time, direction and parser metadata. Everything the operator owns
is untouched.

### The latest update is what the interface highlights

A Trip reports its most recent APPLIED update. The fields that update moved are
marked in the planning list and on the Trip page; when a newer update arrives,
the previous update's fields stop being marked. The mark means "the latest
update changed this", not "this was changed at some point".

"Bijgewerkt" is a DERIVED marker shown beside the status of an OPEN Trip that
has such an update. It is not a status: the lifecycle remains Open, Afgewerkt
and Geannuleerd, and no transition leads to or from "Bijgewerkt".

---

## CANCEL

A CANCEL email represents a cancelled transport order.

Trips are never physically deleted.

Instead they receive the status:

Cancelled

Cancelled trips remain available for history and exports.

Cancellation is a SOFT cancellation: the Trip, its pricing, its custom
properties and its group membership are all preserved.

### Cancelled is terminal for automatic documents

Once a Trip is Cancelled, no automatically processed PDF may move it again:

- an UPDATE: document is stored and refused (`REFUSED_CANCELLED`)
- a NEW: document does not create a second Trip — a cancelled Trip keeps its
  booking number, so the import runs into the existing one
- a second CANCEL: document reports `ALREADY_CANCELLED` and writes nothing

The only way back to Open is the operator's explicit "Openen" action through
the status endpoint. It changes the lifecycle state and nothing else, and it
triggers no pricing.

### Documents that could not be applied are still recorded

An update after cancellation, a repeated cancellation, a cancellation of
finished work and a new order for a booking number that is still held are all
stored and recorded against the Trip they named. None of them changes it. The
record says what arrived and why nothing moved.

### Arrival order must not decide the outcome

A mailbox is not a queue: an UPDATE: and a CANCEL: for the same booking may be
delivered or retried in either order. Both

    NEW -> UPDATE -> CANCEL

and

    NEW -> CANCEL -> UPDATE

must end with the Trip Cancelled. Lifecycle correctness may never depend on the
order documents are processed in — the rules above are what guarantee it, not
the sequence of the scan.

### No manual deletion

Removing a transport by hand is not part of the workflow, and the Trips action
menu offers no "Verwijderen". A transport leaves the planning because a CANCEL:
document says so.

---

## COST CONFIRMATION

Eucon sends a Cost Confirmation after we report a waiting time. It confirms the
amount Eucon will pay for that waiting time.

The email subject begins with

COST CONFIRMATION

and usually repeats the number and the booking:

COST CONFIRMATION NR 4139505 ANRDUB2793105

The subject is a hint. The PDF is the document, and its body is what is read.
When the two disagree the confirmation is REFUSED rather than resolved: two
different bookings in one message means one of them is wrong, and recording an
amount against either would be a guess about somebody else's money.

### What is read

From the block Eucon prints at the top of the notification:

    COST CONFIRMATION NR 4132482 ANRDUB2789089 EUCU4530818
    Costcode: WAIT - Waiting Time
    Amount: EUR 25.00

the number, the booking number, the cost code and the amount. The container
reference at the end of the first line is optional — one real document prints
`????` where the others print a reference — and an unreadable one is recorded as
absent rather than refusing the confirmation.

### What it does

The Trip is found by EXACT booking number, like every other later document. The
confirmation is stored with its PDF, and:

- it never creates a Trip
- it never changes a status, a vehicle, a driver or a planning date
- it never changes the waiting time

A confirmation for a booking nobody holds is refused and nothing is written.
The email stays unread, so the next scan offers it again once the Trip exists.

### It is not the waiting time

Waiting time is minutes an operator enters, and the Pricing Engine prices them
through the configured rule. A Cost Confirmation is the money Eucon confirms for
those minutes. Both belong to the same Trip and neither replaces the other. The
confirmed amount is shown separately and is NOT merged into the WAITING_TIME
pricing line.

### It cannot be edited

The amount is a statement by somebody else. There is no endpoint to create,
change or delete a confirmation: it is written only by the import that read its
document, and it is displayed read-only.

### One per Trip

A Trip has at most ONE Cost Confirmation. Eucon confirms a Trip's waiting time
once, and the first confirmation is the authoritative one. The database enforces
it: `cost_confirmation.trip_id` is unique.

The same confirmation arriving twice — the same number for the same Trip, under
any filename — is recorded once and reported as already recorded.

A DIFFERENT confirmation for a Trip that already has one is REFUSED. The
existing amount stands: nothing is overwritten, nothing is summed, no second
record is created, and the Trip itself is not touched. The refusal is recorded
against the Trip with the document that carried it, so the arrival can still be
found, and the email is left unread like any other refused document.

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