# Database Model

## Purpose

This document defines the conceptual database model for the Transport Management System.

It serves as the single source of truth for the application's data architecture.

The purpose of this document is to define:

- Business entities
- Entity responsibilities
- Relationships
- Ownership
- Business constraints
- Lifecycle
- Future extensibility

This document intentionally does **not** describe PostgreSQL implementation details.

Database implementation details belong in:

- database_schema.md
- Prisma schema
- SQL migrations

---

# Design Principles

The database should be designed around the business, not around the user interface.

Every table should represent one business concept.

Every entity should have one clear responsibility.

The model should remain understandable, scalable and maintainable.

---

## Single Responsibility

Every entity should own exactly one responsibility.

Example

Trip

Represents one transport trip.

It should never contain:

Pricing logic

Parser logic

Import logic

Excel logic

---

## Separation of Concerns

Business domains should remain separated.

Planning should never contain pricing configuration.

Pricing should never contain parser information.

Parser should never contain planning information.

Maintenance should never contain trip information.

---

## Normalization

Avoid duplicated information whenever possible.

Store every business object only once.

Relationships should be represented using foreign keys.

---

## Auditability

Every important business action should remain traceable.

Historical information should never be lost.

The system should always allow administrators to determine:

Who changed something.

When it changed.

What changed.

---

## Soft Deletes

Business data should almost never be physically removed.

Instead,

records should become inactive.

Examples

Cancelled Trips

Deleted Trips

Inactive Drivers

Inactive Vehicles

Historical PDFs

Historical Emails

---

## Extensibility

The model should allow future extensions without breaking existing functionality.

Examples

Additional PDF layouts

Additional pricing rules

Multiple customers

Multiple companies

Multiple depots

Additional import sources

Future mobile application

---

## Ownership

Every entity has exactly one owning module.

Only the owner may modify the entity.

Other modules interact through services.

Example

Trip

Owner

Backend

Parser

Creates ParsedTrip only.

Pricing Engine

Reads Trip.

Never modifies Trip.

Frontend

Displays Trip.

Never modifies database directly.

---

## Configuration

Business configuration belongs in dedicated configuration entities.

Configuration should never be hardcoded.

Examples

Fuel Percentage

Custom Properties

Planning Defaults

Export Defaults

---

## Immutable Data

Certain values should never change after creation.

Examples

Imported Email

Original PDF

Original Import Timestamp

Original Planning Date

Parser Version

These values preserve history.

---

## Manual Overrides

Some fields may be edited by the Administrator.

Parser updates must never overwrite these values.

Examples

Planning Date

Driver Override

Assigned Vehicle

Waiting Time

Distance

Container Number entered manually

Notes

Custom Properties

---

## Versioning

Future versions of the application should remain compatible with existing data.

Database migrations should always preserve historical records whenever possible.

---

# Database Domains

The database is divided into logical business domains.

Each domain owns its own entities.

Cross-domain communication should remain minimal.

---

## Planning Domain

Purpose

Represents all transport planning.

Entities

Trip

TripGroup

TripHistory

This is the central domain of the application.

Every business process eventually results in one or more Trips.

---

## Import Domain

Purpose

Represents incoming transport orders.

Entities

ImportedEmail

PdfDocument

ParserRun

The Import Domain is responsible for tracking where transport orders originate.

A PdfDocument may originate from an ImportedEmail, a manual dashboard upload, or a future API import.

ImportedEmail only exists for email-based imports.

It never performs planning.

It never calculates pricing.

---

## Fleet Domain

Purpose

Represents company vehicles.

Entities

Vehicle

Trailer

Maintenance

VehicleAssignment

The Fleet Domain manages company assets.

VehicleAssignment records which Driver operates which Vehicle over time.

Trailers are used only for maintenance.

Trailers are not linked directly to Trips.

---

## People Domain

Purpose

Represents company personnel.

Entities

Driver

Vacation

Drivers are linked to Vehicles over time through VehicleAssignment.

A Trip may optionally override the derived Driver directly.

Vacation periods prevent driver assignment.

---

## Pricing Domain

Purpose

Stores calculated pricing information.

Entities

TripPricing

TripPricingItem

Pricing calculations belong exclusively to the Pricing Engine.

Pricing configuration belongs to Settings.

The Pricing Domain stores results, not business rules.

---

## Settings Domain

Purpose

Stores configurable business settings.

Entities

Setting

CustomProperty

Settings are stored as a single generic entity, organized by category (General, Planning, Import, Export, Pricing, ...).

These entities define system behaviour.

Changing settings should never require code changes.

---

## Calendar Domain

Purpose

Represents administrator planning.

Entities

CalendarEvent

Note

Calendar events are independent from transport Trips.

The calendar is intended for internal planning.

---

## Authentication

Authentication is managed externally using Auth0.

The application does not store user passwords.

Authentication data should remain outside the business database.

Future role management may introduce additional entities.

# 4. Entity Definitions

---

# 4.1 Trip

## Purpose

The Trip entity represents a single transport operation.

A Trip is the central entity of the entire Transport Management System.

Nearly every business process eventually creates, modifies or references one or more Trips.

Examples:

- Importing a new PDF
- Updating a planning
- Cancelling a transport
- Assigning a driver
- Assigning a vehicle
- Calculating pricing
- Exporting to Excel

All operate on Trips.

A Trip always represents one physical transport movement.

A Combination consists of two separate Trips linked together.

---

# Responsibilities

The Trip entity is responsible for storing:

- planning information
- transport information
- assignment information
- execution status
- parser results
- manual changes
- references to pricing
- references to PDFs

The Trip entity must never contain:

- pricing formulas
- parser logic
- import logic
- authentication
- UI information

---

# Entity Owner

Owner

Backend Service

Only the Backend Service may modify Trips.

Parser Service

May create new Trips.

May update parser-controlled fields.

May never modify manual fields.

Pricing Engine

Read-only.

May create pricing results.

Frontend

Read-only.

Requests modifications through Backend APIs.

---

# Lifecycle

A Trip progresses through the following lifecycle.

OPEN

↓

CLOSED

or

CANCELLED

or

DELETED (soft delete)

CANCELLED represents a business cancellation, normally triggered by a CANCEL: email.

DELETED represents an administrative soft delete, used when a Trip was created incorrectly or is a duplicate.

CANCELLED and DELETED are distinct states and must never be treated as the same value.

A DELETED Trip may be restored.

Trips are never physically deleted.

---

# Identity

Every Trip has exactly one unique identifier.

The identifier never changes.

It is independent from:

Booking Number

Container Number

PDF

Group

Driver

Vehicle

---

# Required Information

Every Trip should eventually contain:

Original Planning Date

Planning Date

Start Time

End Time

Status

Booking Number

Container Type

Terminal

Destination City

Destination Country

PDF Reference

Creation Timestamp

Start Time and End Time represent the planned time interval and are required to detect overlapping Vehicle assignments.

Original Planning Date preserves the date extracted at import and never changes.

Import Source is not stored on Trip. It is resolved through the PdfDocument.

Some information may temporarily be unavailable.

Example

Container Number

This may remain empty until the driver has collected the container.

---

# Optional Information

A Trip may contain:

Container Number

Driver Override

Vehicle

Waiting Time

Distance

Custom Properties

Internal Notes

Execution Date and Time

Parser Metadata

Pricing Result

Waiting Time is expressed in minutes.

Distance is expressed in kilometres, is manually entered per Trip and is used by Distance-Based Pricing.

Execution Date and Time records when the Trip was actually completed. It may differ from the Planning Date.

Internal Notes is a single free-text field. "Notes", "Manual Remarks" and "Internal Notes" all describe the same business concept and are stored only once.

Parser Metadata is parser-controlled and is described below.

---

# Manual Fields

Certain fields may be edited manually.

These values always have priority over parser updates.

Manual fields include:

Container Number

Planning Date

Driver Override

Vehicle

Waiting Time

Distance

Custom Properties

Internal Notes

Parser updates must never overwrite manual values.

---

# Immutable Fields

The following values should never change after creation.

Original Planning Date

Booking Number

PDF Reference

Creation Timestamp

These values preserve historical accuracy.

The following historical values are **not** stored on Trip. They are resolved through relationships:

Original PDF — through the PDF Reference

Original Email — through the PdfDocument

Original Import Date — through the ImportedEmail

Original Parser Version — through the ParserRun

Original Booking Reference — identical to the Booking Number

No duplicate storage should exist.

---

# Trip Status

Supported statuses:

OPEN

CLOSED

CANCELLED

DELETED

CANCELLED represents a business cancellation of the underlying transport.

DELETED represents an administrative soft delete of the Trip record.

A DELETED Trip may be restored to its previous status.

Status transitions should follow the business workflow.

Invalid transitions should be rejected.

Example

CLOSED

↓

OPEN

is not allowed.

---

# Combination Trips

A Trip may belong to a TripGroup.

If a Trip belongs to a TripGroup:

it remains an independent Trip.

Both Trips may:

move independently

receive different drivers

receive different planning dates

receive different waiting times

receive different pricing

Both Trips simply share a common group.

---

# PDF Relationship

Every Trip originates from exactly one PDF.

One PDF may generate:

one Trip

or

two Trips

Example

Single Transport

PDF

↓

Trip

Combination

PDF

↓

Trip A

Trip B

---

# Driver Assignment

The Driver of a Trip is primarily resolved from the active VehicleAssignment for the Trip's assigned Vehicle on the Trip's planning date.

A Trip may optionally define a Driver override.

If the override is set, it takes precedence over the derived Driver for that Trip only.

The override never changes the underlying VehicleAssignment.

One Driver may perform many Trips, whether derived or through override.

Drivers cannot be assigned, derived or overridden, while marked as unavailable.

---

# Vehicle Assignment

A Trip may have exactly one Vehicle.

Vehicles are assigned manually.

Vehicles are selected from active vehicles.

Inactive vehicles cannot be assigned.

A Vehicle cannot be assigned to two Trips whose planned time intervals overlap.

---

# Container Number

Container Number is optional.

Reason:

Loading transports often do not yet know the container number.

The Administrator enters the container manually after receiving it from the driver.

Parser updates must never erase manually entered container numbers.

---

# Address

The stored address represents the operational destination.

Only:

City

Country

are stored, as two separate values.

Street information is intentionally discarded.

The raw address text extracted from the PDF is preserved in Parser Metadata.

Example

FR-59166 Bousbecque, France

Belgium

NL-3047 Rotterdam

The parser performs address normalization.

---

# Waiting Time

Waiting Time is entered manually.

Waiting Time is expressed in minutes.

The parser never determines waiting time.

Waiting time contributes to pricing.

Waiting time is stored separately from pricing calculations.

---

# Custom Properties

Trips may contain multiple custom properties.

Examples

TAR

Flat

Over Sint-Niklaas

Future custom properties

Custom properties are configurable.

The Pricing Engine uses these values.

---

# Parser Metadata

A Trip may store the raw values extracted by the parser for that specific Trip.

Its only purpose is to explain **why** the Trip contains the business values it contains.

Examples

Raw Terminal text

Raw Destination text

Raw Address text

Raw Booking Number

Raw Container Number

Raw Date

Matched Labels

Parser Metadata is parser-controlled.

It is replaced whenever the PDF is reprocessed.

It is never a manual field.

The following information must **never** be stored in the Trip's Parser Metadata:

Parser Confidence

Detected Layout

Parser Warnings

Execution Statistics

Parser Timing

Parser Version

Those values belong exclusively to ParserRun.

Parser Metadata exists only for diagnostics, debugging and transparency.

The application must never make business decisions based on it.

If a value inside Parser Metadata becomes part of business logic, filtering, reporting or pricing, it must be promoted to a dedicated field.

---

# Pricing

Pricing is not stored directly inside Trip.

Trip references exactly one pricing result.

Historical pricing must remain reproducible.

---

# Notes

Trips may contain administrator notes.

Notes never affect pricing.

Notes never affect parser behaviour.

Notes are intended for internal communication.

---

# Audit

Every important modification should create a TripHistory record.

Examples

Driver changed

Vehicle changed

Planning date changed

Container entered

Status changed

Waiting time modified

Custom Property modified

Trip reopened

Trip cancelled

---

# Soft Delete

Trips are never physically removed.

Deleted Trips remain available for:

historical exports

auditing

pricing history

parser comparison

Deleted Trips should not appear in normal planning views.

---

# Business Constraints

A Trip always belongs to exactly one PDF.

A Trip may belong to zero or one TripGroup.

A Trip's Driver is derived from the active VehicleAssignment for its Vehicle, unless a Driver override is set directly on the Trip.

A Trip may have zero or one Vehicle.

A Trip always has exactly one Status.

A Trip may have zero or one Pricing Result. A Pricing Result only exists once the Trip reaches CLOSED status.

A Trip may have many History records.

A Trip may contain multiple Custom Properties.

Booking Number is unique per Trip, except that Trips belonging to the same TripGroup share the same original Booking Number.

A Vehicle cannot be assigned to two Trips with overlapping planned time intervals.

---

# Future Expansion

The Trip entity should support future features without structural redesign.

Examples

GPS Tracking

Live Driver Status

Digital Signatures

Photos

WhatsApp Integration

Customer Portal

Multiple Stops

Automatic ETA Calculation

Live Vehicle Position

The database design should remain compatible with these future extensions.

---

# 4.2 TripGroup

## Purpose

The TripGroup entity represents a logical relationship between multiple Trips.

Its primary purpose is to support Combination transports.

A TripGroup never represents a transport itself.

It only groups Trips that originate from the same business operation.

Currently a TripGroup contains a maximum of two Trips.

Future versions may support more than two Trips without requiring database changes.

---

## Responsibilities

The TripGroup is responsible for:

- grouping related Trips
- identifying Combination transports
- maintaining the relationship between Trips
- allowing group operations
- preserving independent planning of each Trip

The TripGroup must never store:

- planning information
- pricing
- driver assignments
- vehicle assignments
- addresses
- terminals

Those belong to the individual Trips.

---

## Entity Owner

Owner

Backend Service

The Backend creates TripGroups during import.

The Frontend may request group operations through Backend APIs.

Parser Service never creates groups directly.

Parser only indicates whether a Combination exists.

---

## Creation

A TripGroup is automatically created when:

A Combination PDF is imported.

Example

PDF

↓

TripGroup

↓

Trip A

Trip B

Single transports never receive a TripGroup.

---

## Relationship with Trips

One TripGroup

↓

contains

↓

One or Two Trips

Each Trip belongs to:

zero or one TripGroup

A Trip can never belong to multiple groups.

---

## Independent Trips

Grouping must never reduce the independence of Trips.

Every Trip may have:

Different planning date

Different driver

Different vehicle

Different waiting time

Different pricing

Different status

Different completion time

Only the logical relationship remains.

---

## Group Operations

The Administrator may:

View Group

Collapse Group

Expand Group

Move entire Group

Ungroup Trips

Group operations should never merge Trip data.

---

## Moving Trips

Trips inside a TripGroup may be moved independently.

Example

Trip A

Monday

Trip B

Tuesday

This is a valid situation.

The group relationship remains intact.

---

## Removing a Group

Removing a group does not remove Trips.

It simply removes the relationship.

Trip A

↓

Independent Trip

Trip B

↓

Independent Trip

Historical information should remain available.

---

## Business Constraints

A TripGroup must contain at least two Trips.

A TripGroup currently supports a maximum of two Trips.

If a TripGroup would be reduced to one Trip, the TripGroup must be dissolved rather than persisted with a single Trip.

Trips inside a group must originate from the same imported PDF.

Trips inside a group always share the same original Booking Number.

Booking Number is therefore not globally unique across all Trips.

Trips may have different Container Numbers.

---

## Future Considerations

The TripGroup entity should support future extensions such as:

Multi-stop transports

Three or more linked Trips

Automatic route optimization

Shared customer references

Shared invoice references

Shared planning operations

---

# 4.3 TripHistory

## Purpose

The TripHistory entity records every important change made to a Trip.

Its purpose is to provide a complete audit trail of the Trip lifecycle.

TripHistory should allow administrators to understand:

- what changed
- who changed it
- when it changed
- why it changed (optional)

TripHistory is append-only.

Records should never be edited or deleted.

---

## Responsibilities

TripHistory stores historical events only.

It never stores the current state of a Trip.

The current state always belongs to the Trip entity.

---

## Entity Owner

Owner

Backend Service

Every important modification performed through the Backend should automatically generate a TripHistory record.

No other service should create history records directly.

---

## Recorded Events

Examples include:

- Trip imported
- Trip updated from PDF
- Trip cancelled
- Trip reopened
- Planning date changed
- Driver assigned
- Driver changed
- Vehicle assigned
- Vehicle changed
- Waiting time modified
- Container number entered manually
- Container number modified
- Custom Properties changed
- Status changed
- Pricing recalculated
- Trip removed from group
- Trip added to group

The list should remain extensible.

---

## Relationships

One Trip

↓

has many

↓

TripHistory records.

A TripHistory record always belongs to exactly one Trip.

---

## Stored Information

Each history record should contain:

- Trip Reference
- Event Type
- Timestamp
- Performed By
- Previous Value (optional)
- New Value (optional)
- Description (optional)

This information allows reconstruction of every important business action.

---

## Business Constraints

TripHistory records are immutable.

History records should never be updated.

History records should never be deleted.

History should survive Trip status changes.

Deleted Trips still keep their history.

Cancelled Trips still keep their history.

---

## Future Considerations

Future versions may include:

- API caller information
- Device information
- IP address
- Automatic rollback support
- Activity timeline visualization

---

# 4.4 PdfDocument 

## Purpose

The PdfDocument entity represents one imported PDF document.

Every imported PDF is stored exactly once.

The PdfDocument serves as the original source for one or more Trips.

The original PDF should always remain available for:

- viewing
- downloading
- reparsing
- auditing
- troubleshooting

The PDF itself is immutable.

---

## Responsibilities

The PdfDocument entity is responsible for storing:

- file metadata
- storage location
- parser information
- import timestamps
- file integrity information
- relationships with Trips

The PdfDocument does not contain extracted business data.

Business information belongs to the Trip entity.

---

## Entity Owner

Owner

Backend Service

The IMAP Service downloads the PDF.

The Parser Service reads the PDF.

The Backend stores the PdfDocument metadata.

The Frontend may only request viewing or downloading.

---

## Creation

A PdfDocument is created whenever a valid email containing a PDF attachment is processed.

One email creates exactly one PdfDocument.

One PdfDocument may generate:

- one Trip
- two Trips (Combination)

---

## Relationships

Zero or One ImportedEmail

↓

may contain

↓

One PdfDocument

A PdfDocument may instead originate directly from a manual upload or a future API import, without an ImportedEmail.

One PdfDocument

↓

creates

↓

One or More Trips

ParserRun records also reference the PdfDocument.

---

## Stored Information

A PdfDocument should contain metadata such as:

- Original Filename
- Storage Path
- File Size
- File Hash
- MIME Type
- Upload Timestamp
- Parser Version
- Import Source

Import Source identifies how the document entered the system.

Supported values:

- EMAIL
- MANUAL_UPLOAD
- API (future)

The actual extracted transport data should never be stored inside PdfDocument.

---

## File Storage

The physical PDF is stored on disk.

The PDF file itself is never stored inside the database.

The database only stores metadata and a reference to the file location.

The storage location should be configurable.

Example

/uploads/pdfs/2026/08/booking123.pdf

The application should never depend on the original email attachment after import.

---

## File Integrity

Every PDF should receive a unique file hash.

The hash is used for:

- duplicate detection
- integrity verification
- troubleshooting

The hash should never change.

---

## Viewing

The Administrator should be able to:

- view the PDF
- download the PDF

Viewing always uses the stored PDF.

Never regenerate the PDF.

---

## Reprocessing

The Administrator may request that a PDF be processed again.

Reprocessing should:

- use the latest Parser version
- compare extracted data with existing Trips
- update parser-controlled fields only

Manual fields must remain untouched.

Examples of manual fields:

- Planning Date
- Driver
- Vehicle
- Waiting Time
- Custom Properties
- Notes
- Manually entered Container Number

---

## Business Constraints

A PdfDocument may optionally belong to one ImportedEmail (zero or one).

A PdfDocument without an ImportedEmail originates from a manual upload or another supported import source.

A PdfDocument always exists before any Trip is created.

A PdfDocument may create multiple Trips.

A PdfDocument is immutable.

The original file should never be replaced.

---

## Future Considerations

The PdfDocument entity should support future extensions such as:

- OCR processing
- parser confidence scores
- parser warnings
- image previews
- archived documents
- digital signatures
- document versioning

---

# 4.5 ImportedEmail 

## Purpose

The ImportedEmail entity represents a single email received by the IMAP Service.

Its purpose is to track the complete import lifecycle of transport orders received by email.

Every processed email should remain traceable, even if parsing fails.

The ImportedEmail entity is the starting point of the email import path only.

Import Flow (Email)

Email

↓

ImportedEmail

↓

PdfDocument

↓

Trip(s)

PdfDocuments originating from a manual upload or a future API import follow the same PdfDocument → Trip(s) flow without an ImportedEmail.

---

## Responsibilities

The ImportedEmail entity is responsible for storing:

- sender information
- subject
- received timestamp
- processing status
- email metadata
- relationship with the imported PDF

It never stores parsed transport information.

That belongs to the Trip entity.

---

## Entity Owner

Owner

IMAP Service

The IMAP Service creates ImportedEmail records.

The Backend may update processing status.

Other services should only read this entity.

---

## Creation

A new ImportedEmail is created whenever an email matches the configured import rules.

An email is processed when:

- sender is allowed
- subject starts with:

NEW:

UPDATE:

CANCEL:

- exactly one PDF attachment exists

Emails that do not satisfy these rules should not create Trips.

---

## Relationships

One ImportedEmail

↓

contains

↓

Exactly One PdfDocument

One ImportedEmail

↓

creates

↓

One or More Trips

---

## Processing Status

Every ImportedEmail should contain a processing status.

Suggested statuses:

RECEIVED

PROCESSING

PROCESSED

FAILED

IGNORED

These statuses help administrators troubleshoot import issues.

---

## Duplicate Detection

Every email should contain a unique Message-ID.

Duplicate Message-IDs should never be processed twice.

If a duplicate email is detected:

- no new Trips are created
- no new PdfDocument is created
- the duplicate should be logged

---

## UPDATE Emails

When the subject starts with:

UPDATE:

The system should:

- locate the existing Trip(s)
- compare parser-controlled fields
- update changed information
- preserve all manual planning data

The original ImportedEmail remains stored.

---

## CANCEL Emails

When the subject starts with:

CANCEL:

The related Trip(s) should receive:

Status = CANCELLED

Trips are never physically deleted.

The ImportedEmail remains stored.

---

## NEW Emails

When the subject starts with:

NEW:

The system creates:

ImportedEmail

↓

PdfDocument

↓

Trip(s)

This is the normal import flow.

---

## Stored Information

The ImportedEmail entity should contain metadata such as:

- Sender Email
- Subject
- Message ID
- Received Timestamp
- Processing Timestamp
- Processing Status
- Import Type (NEW / UPDATE / CANCEL)

The email body is optional.

Only store it if needed for debugging.

---

## Business Constraints

Each ImportedEmail represents exactly one received email.

Each ImportedEmail references exactly one PdfDocument.

Message-ID must be unique.

ImportedEmail records are immutable after successful processing, except for Processing Status.

ImportedEmail records should never be deleted.

---

## Future Considerations

The ImportedEmail entity should support future extensions such as:

- Outlook integration
- Gmail integration
- WhatsApp imports
- Manual uploads
- API imports
- Multiple attachments
- Email retry queue
- Import statistics

---

# 4.6 ParserRun

## Purpose

The ParserRun entity records every execution of the PDF Parser.

Its purpose is to provide diagnostics, debugging information and parser history.

ParserRun exists independently from the Trip entity.

A parser may fail before any Trip has been created.

---

## Responsibilities

The ParserRun entity stores information about:

- parser execution
- parser version
- execution duration
- parser result
- parser warnings
- parser errors

ParserRun does not store business information.

Business information belongs to the Trip entity.

---

## Entity Owner

Owner

Parser Service

Only the Parser Service may create ParserRun records.

ParserRun records are immutable.

---

## Creation

A ParserRun is created whenever a PDF is processed.

This includes:

- NEW imports
- UPDATE imports
- Manual reprocessing
- Parser retries

Every parser execution creates a new ParserRun.

---

## Relationships

One PdfDocument

↓

may have many

↓

ParserRuns

A ParserRun always belongs to exactly one PdfDocument.

ParserRuns are independent from Trips.

---

## Stored Information

ParserRun should store:

- Parser Version
- Started At
- Finished At
- Execution Duration
- Result
- Warning Count
- Error Count
- Error Code (optional)
- Error Message (optional)
- Metadata (optional)

---

## Metadata

ParserRun owns all **technical** parser diagnostics.

Examples

Detected Layout

Parser Confidence

Detected Sections

Warnings

Execution Statistics

Debug Information

Parser-specific metadata

Because every parser execution creates a new ParserRun, this metadata is never overwritten.

The complete diagnostic history of a PdfDocument therefore remains available across parser versions, which makes parser comparison possible.

Metadata is intended only for debugging, diagnostics and parser comparison.

It must **never** be used for business logic.

Raw extracted values belonging to one specific Trip are not stored here.

Those belong to the Trip's Parser Metadata.

---

## Parser Result

Supported results:

SUCCESS

WARNING

FAILED

PARTIAL_SUCCESS

These results simplify debugging and monitoring.

---

## Business Constraints

ParserRuns are append-only.

ParserRuns should never be modified.

ParserRuns should never be deleted.

Manual reprocessing always creates a new ParserRun.

---

## Future Considerations

The ParserRun entity should support future extensions such as:

- parser confidence score
- parser performance metrics
- OCR statistics
- extracted layout information
- parser comparison reports

---

# 4.7 Driver

## Purpose

The Driver entity represents a company driver that can be assigned to transport Trips.

Drivers are managed manually by the Administrator.

The Driver entity stores planning-related information only.

Authentication is managed separately through Auth0 and is not linked to Drivers.

---

## Responsibilities

The Driver entity is responsible for:

- driver identification
- trip assignments
- planning availability
- vacation management
- contact information (optional)

The Driver entity must never contain:

- authentication
- pricing
- maintenance information
- parser information

---

## Entity Owner

Owner

Backend Service

The Administrator manages Drivers through the Settings page.

Drivers cannot modify their own information.

---

## Creation

Drivers are created manually.

The system never creates Drivers automatically.

A Driver should exist before Trips can be assigned.

---

## Relationships

One Driver

↓

may perform

↓

Many Trips

(derived through VehicleAssignment, or through a direct Trip override)

One Driver

↓

may have

↓

Many Vacation periods

One Driver

↓

may have

↓

Many VehicleAssignment periods over time

(only one active at a time)

---

## Assignment

A Driver may be assigned to many Trips.

A Trip can only have one Driver.

Driver assignment is always performed manually by the Administrator.

Changing the assigned Driver should create a TripHistory record.

---

## Vehicle Assignment

A Driver is linked to a Vehicle through the VehicleAssignment entity.

VehicleAssignment records are historized, using a Valid From and Valid To date.

This allows a Vehicle to be reassigned to a different Driver over time, while preserving which Driver was assigned during any historical period.

The current Driver of a Vehicle is the VehicleAssignment record with no Valid To date.

Historical Trips resolve their Driver using the VehicleAssignment that was active on the Trip's Planning Date, unless a Driver override is set directly on the Trip.

---

## Vacation

Drivers may have one or more Vacation periods.

During vacation:

- the Driver should remain visible
- the Driver should not be selectable for new planning
- historical Trips remain unchanged

Vacation management is handled through the Vacation entity.

---

## Active Status

Drivers should support an Active flag.

Inactive Drivers:

- cannot be assigned to new Trips
- remain linked to historical Trips
- remain available for reports

Drivers should never be deleted.

---

## Contact Information

The Driver entity may optionally contain:

- phone number
- email address
- emergency contact
- notes

These fields are optional.

---

## Stored Information

The Driver entity should contain:

- Name
- Licence Number (optional)
- Active Status
- Phone Number (optional)
- Email (optional)
- Emergency Contact (optional)
- Notes (optional)

The current and historical Vehicle assignments of a Driver are stored through VehicleAssignment, not directly on Driver.

---

## Licence Number

A Driver may have a driving licence number.

It is optional, because a Driver record may be created before the licence details are available.

When present, the Licence Number must be unique among **active** Drivers.

Uniqueness is scoped to active Drivers only, for the same reason as Vehicle and Trailer licence plates:

a deactivated Driver keeps its historical value, but the number becomes available again should it ever need to be reused.

The Licence Number is never used to identify a Driver inside the application.

The Driver identifier remains the only identity.

---

## Business Constraints

Driver names do not have to be unique.

A Licence Number, when present, must be unique among active Drivers.

Each Driver has exactly one Active Status.

Drivers are never physically deleted.

Historical Trips must always retain their original Driver.

---

## Future Considerations

The Driver entity should support future extensions such as:

- WhatsApp integration
- Driver mobile application
- Licence expiry dates and categories
- Driver documents
- GPS tracking
- Driver statistics
- Working hours
- Performance reports

---

# 4.8 Vehicle

## Purpose

The Vehicle entity represents a company truck that can be assigned to transport Trips.

Vehicles are managed manually by the Administrator through the Settings page.

A Vehicle is primarily used for planning and maintenance.

---

## Responsibilities

The Vehicle entity is responsible for:

- vehicle identification
- trip assignment
- maintenance tracking
- planning availability
- storing basic vehicle information

The Vehicle entity must never contain:

- pricing information
- parser information
- authentication
- planning history

---

## Entity Owner

Owner

Backend Service

Vehicles are created, updated and archived by the Administrator.

Vehicles are never created automatically.

---

## Creation

Vehicles are created manually.

Each vehicle should have a unique license plate.

A vehicle should exist before it can be assigned to Trips.

---

## Relationships

One Vehicle

↓

may be assigned to

↓

Many Trips

One Vehicle

↓

may have

↓

Many Maintenance records

One Vehicle

↓

may have

↓

Many VehicleAssignment periods over time

(only one active at a time, linking the Vehicle to one Driver)

---

## Assignment

A Vehicle may be assigned to many Trips.

A Trip may have exactly one Vehicle.

Vehicle assignment is performed manually by the Administrator.

Changing the assigned Vehicle should create a TripHistory record.

---

## Maintenance

Every Vehicle can have multiple Maintenance records.

Maintenance history should remain available permanently.

Maintenance does not prevent historical Trips from being viewed.

Future versions may prevent planning during scheduled maintenance.

---

## Active Status

Vehicles should support an Active flag.

Inactive Vehicles:

- cannot be assigned to new Trips
- remain linked to historical Trips
- remain available in reports

Vehicles should never be physically deleted.

---

## License Plate

The license plate uniquely identifies a Vehicle.

License plates should be unique among active Vehicles.

Changing a license plate should be rare and should preserve historical references.

---

## Display Color

Each Vehicle receives one unique planning color.

This color is used throughout the planning dashboard, including on Trips assigned to the Vehicle.

The color should remain stable over time.

Changing the color affects only the user interface and has no business impact.

---

## Stored Information

The Vehicle entity should contain:

- License Plate
- Display Color
- Description (optional)
- Brand (optional)
- Model (optional)
- Year (optional)
- Active Status
- Notes (optional)

Future technical information may be added without affecting existing functionality.

---

## Business Constraints

A Vehicle must have a unique license plate among active Vehicles.

A Vehicle may have many Trips.

A Vehicle may have many Maintenance records.

A Vehicle may have many VehicleAssignment periods, but only one active at a time.

A Vehicle cannot be assigned to two Trips with overlapping planned time intervals.

Inactive Vehicles cannot be assigned to new Trips.

Vehicles are never physically deleted.

---

## Future Considerations

The Vehicle entity should support future extensions such as:

- Fuel Type
- VIN Number
- Mileage
- Purchase Date
- Insurance Information
- Registration Expiry
- GPS Device
- Tachograph Information
- Fuel Consumption Statistics

---

# 4.9 Trailer

## Purpose

The Trailer entity represents a company trailer (Römork).

Trailers are managed separately from Vehicles.

Unlike Vehicles, Trailers are **not assigned to Trips**.

Their primary purpose is maintenance management and fleet administration.

---

## Responsibilities

The Trailer entity is responsible for:

- trailer identification
- maintenance tracking
- storing trailer information
- availability within the fleet

The Trailer entity must never contain:

- trip assignments
- driver assignments
- pricing information
- parser information

---

## Entity Owner

Owner

Backend Service

Trailers are created and managed manually by the Administrator.

The system never creates Trailers automatically.

---

## Creation

Trailers are added manually through the Settings page.

Each Trailer should have a unique license plate.

---

## Relationships

One Trailer

↓

may have

↓

Many Maintenance records

Trailers have no direct relationship with Trips.

---

## Active Status

Trailers support an Active flag.

Inactive Trailers:

- cannot receive new maintenance planning
- remain visible in historical maintenance records

Trailers should never be physically deleted.

---

## Maintenance

Maintenance is managed through the Maintenance entity.

A Trailer may have unlimited maintenance records.

Maintenance history should always remain available.

---

## Stored Information

The Trailer entity should contain:

- License Plate
- Description (optional)
- Brand (optional)
- Model (optional)
- Year (optional)
- Active Status
- Notes (optional)

---

## Business Constraints

A Trailer must have a unique license plate among active Trailers.

A Trailer may have many Maintenance records.

Trailers are never assigned to Trips.

Trailers are never physically deleted.

---

## Future Considerations

The Trailer entity should support future extensions such as:

- VIN Number
- Registration Information
- Insurance Expiry
- Inspection Dates
- Tire Information
- Axle Configuration
- GPS Tracking

---

# 4.10 Maintenance

## Purpose

The Maintenance entity represents a maintenance event for a Vehicle or Trailer.

Maintenance records allow the Administrator to track the complete maintenance history of the fleet.

Maintenance is independent from planning.

It only records maintenance activities.

---

## Responsibilities

The Maintenance entity is responsible for storing:

- maintenance history
- scheduled maintenance
- maintenance costs
- maintenance status
- maintenance notes

The Maintenance entity must never contain:

- trip information
- driver assignments
- pricing information
- parser information

---

## Entity Owner

Owner

Backend Service

Maintenance records are created and managed manually by the Administrator.

The system never creates Maintenance records automatically.

---

## Supported Assets

A Maintenance record always belongs to exactly one asset.

Supported asset types:

- Vehicle
- Trailer

A Maintenance record can never belong to both.

---

## Relationships

One Vehicle

↓

may have

↓

Many Maintenance records

One Trailer

↓

may have

↓

Many Maintenance records

Every Maintenance record belongs to exactly one asset.

---

## Maintenance Status

Supported statuses:

PLANNED

IN_PROGRESS

COMPLETED

CANCELLED

The status represents the current maintenance lifecycle.

---

## Scheduling

Maintenance may be scheduled in advance.

Future maintenance should remain visible.

Completed maintenance remains available for historical reference.

---

## Stored Information

A Maintenance record should contain:

- Asset Type
- Asset Reference
- Status
- Maintenance Date
- Description
- Cost (optional)
- Workshop (optional)
- Notes (optional)

---

## Maintenance History

Maintenance history should never be removed.

Historical maintenance allows:

- maintenance overview
- cost tracking
- repair history
- warranty tracking

---

## Business Constraints

Every Maintenance record belongs to exactly one asset.

Maintenance records are never reassigned to another asset.

Completed maintenance should never be deleted.

Historical maintenance must always remain available.

---

## Future Considerations

The Maintenance entity should support future extensions such as:

- invoice attachments
- maintenance reminders
- recurring maintenance
- mileage-based maintenance
- inspection reminders
- document uploads
- maintenance categories
- supplier management

---

# 4.11 Vacation

## Purpose

The Vacation entity represents a period during which a Driver is unavailable for planning.

Vacation records prevent Drivers from being assigned to new Trips during the specified period.

Vacation only affects future planning.

Historical Trips remain unchanged.

---

## Responsibilities

The Vacation entity is responsible for:

- storing driver availability
- blocking planning during vacation
- maintaining vacation history

The Vacation entity must never contain:

- trip information
- pricing
- maintenance
- parser information

---

## Entity Owner

Owner

Backend Service

Vacation periods are managed manually by the Administrator.

The system never creates Vacation records automatically.

---

## Relationships

One Driver

↓

may have

↓

Many Vacation periods

Every Vacation period belongs to exactly one Driver.

---

## Vacation Period

A Vacation consists of:

- Start Date
- End Date

The vacation period is inclusive.

The Driver is considered unavailable during the entire period.

---

## Planning Behaviour

When planning Trips:

- Drivers on vacation should not appear in the assignment dropdown.
- Existing Trip assignments remain unchanged.
- Historical Trips are never modified.

The Administrator may still override this restriction if explicitly allowed in future versions.

---

## Stored Information

A Vacation should contain:

- Driver
- Start Date
- End Date
- Reason (optional)
- Notes (optional)

---

## Business Constraints

Every Vacation belongs to exactly one Driver.

Vacation periods should not overlap for the same Driver.

Vacation records should never be physically deleted.

Historical vacation periods remain available for reporting.

---

## Future Considerations

The Vacation entity should support future extensions such as:

- Sick leave
- Public holidays
- Training
- Temporary unavailability
- Half-day absences
- Recurring vacations

---

# 4.12 CustomProperty

## Purpose

The CustomProperty entity represents configurable properties that can be assigned to Trips.

Custom Properties allow the Administrator to dynamically extend Trip behaviour without modifying the application.

Most Custom Properties influence pricing, but they may also be used for filtering, reporting or planning.

Examples:

- TAR
- Flat
- Over Sint-Niklaas

Future properties can be added without requiring code changes.

---

## Responsibilities

The CustomProperty entity is responsible for:

- storing configurable Trip properties
- defining optional pricing values
- allowing dynamic business configuration

The entity must never contain Trip-specific information.

---

## Entity Owner

Owner

Backend Service

Custom Properties are managed through the Settings page.

Only the Administrator may create, modify or deactivate Custom Properties.

---

## Relationships

One CustomProperty

↓

may belong to

↓

Many Trips

One Trip

↓

may contain

↓

Many CustomProperties

This is a many-to-many relationship, implemented through TripCustomProperty.

---

## Assignment

Custom Properties are assigned manually by the Administrator.

Multiple Custom Properties may be assigned to the same Trip.

Example

Trip

↓

TAR

↓

Flat

↓

Over Sint-Niklaas

---

## Pricing

A Custom Property determines **whether** a charge applies to a Trip.

How much that charge is depends on the kind of property.

### Fixed-price Custom Properties

A fixed-price Custom Property defines its own pricing value.

The Pricing Engine includes this value during price calculation.

The amount is the same for every Trip, independent of the route.

Examples

TAR

Flat

Over Sint-Niklaas

### Route-priced Custom Properties

A Custom Property may instead reference a PricingComponent.

When it does, the property no longer carries its own price.

It determines **only** whether the component applies to a Trip.

The amount comes from the RouteCost configuration for the Trip's route.

Examples

Toll

Tunnel

The Pricing Engine combines the two:

Trip

↓

TripCustomProperty

↓

RouteCost

↓

TripPricingItem

Changing a pricing value does not automatically recalculate historical Trips.

Historical Trips are only recalculated when requested by the Administrator.

---

## Pricing Component Reference

A Custom Property may optionally reference exactly one PricingComponent.

The reference determines how the property is priced and how the resulting
pricing line is classified.

No reference

↓

Fixed price

↓

Classified as the Custom Property component

Reference present

↓

Route price

↓

Classified as the referenced component

A route-priced property therefore appears in the pricing sequence at the
position of its referenced component, not at the position of Custom Properties.

The reference exists so the Pricing Engine never has to recognise a property by
name. Adding a further route-priced property is a configuration change, not a
code change.

---

## Active Status

Every Custom Property supports an Active flag.

Inactive properties:

- cannot be selected for new Trips
- remain visible on historical Trips
- remain available for reporting

---

## Stored Information

A CustomProperty should contain:

- Name
- Description (optional)
- Active Status
- Pricing Component reference (optional)
- Default Price (optional)
- Display Order
- Color (optional)

---

## Business Constraints

Property names should be unique among active properties.

Properties are never physically deleted.

Inactive properties remain linked to historical Trips.

A Trip may contain multiple Custom Properties.

A Custom Property that references a PricingComponent must not define a Default
Price. Its amount comes from the RouteCost configuration, and a value stored
here would never be used.

A PricingComponent may be referenced by at most one active Custom Property.
Otherwise a single component could be assigned to a Trip through two different
properties, and the Pricing Engine would produce two pricing lines for one
charge.

Both constraints apply to active properties. A deactivated property keeps
whatever it held, so historical Trips remain readable.

---

## Future Considerations

The CustomProperty entity should support future extensions such as:

- Categories
- Icons
- Conditional visibility
- Planning-only properties
- Reporting properties
- Customer-specific properties
- Validation rules

---

# 4.13 TripPricing

## Purpose

The TripPricing entity stores the calculated pricing result for a Trip.

It represents the outcome of a pricing calculation performed by the Pricing Engine.

TripPricing contains the pricing summary.

The detailed calculation breakdown is stored in TripPricingItem.

---

## Responsibilities

The TripPricing entity is responsible for:

- storing the calculated total
- storing calculation metadata
- referencing pricing details
- maintaining pricing history

The TripPricing entity must never:

- calculate prices
- contain pricing rules
- contain parser information
- contain planning information

---

## Entity Owner

Owner

Pricing Engine

The Pricing Engine creates and updates TripPricing records.

The Backend may request recalculation.

The Frontend is read-only.

---

## Relationships

One Trip

↓

has zero or one

↓

TripPricing

One TripPricing

↓

contains many

↓

TripPricingItems

---

## Creation

A TripPricing record is created when:

- a Trip reaches CLOSED status
- the Administrator requests a recalculation (Reprocess Pricing) on a CLOSED Trip

A Trip has no TripPricing before it reaches CLOSED status.

---

## Recalculation

The Administrator may request a pricing recalculation.

The Pricing Engine recalculates using:

- current pricing rules
- current fuel percentage
- current custom properties

Recalculation overwrites the existing TripPricing record using the current Settings.

The previous calculated result is not preserved.

Manual planning information is never modified.

---

## Stored Information

TripPricing should contain:

- Total Price
- Currency
- Calculation Timestamp
- Pricing Engine Version
- Pricing Rule Version
- Calculation Status
- Notes (optional)

The calculation breakdown belongs to TripPricingItem.

---

## Calculation Status

Supported statuses:

CALCULATED

FAILED

MANUAL_OVERRIDE

This status reflects the pricing lifecycle.

---

## Business Constraints

A Trip has zero or one TripPricing.

A TripPricing only exists once its Trip has reached CLOSED status.

TripPricing always belongs to one Trip.

TripPricing may contain many TripPricingItems.

Reprocessing pricing overwrites the existing TripPricing; no historical version is retained.

---

## Future Considerations

The TripPricing entity should support future extensions such as:

- multiple currencies
- VAT calculations
- customer discounts
- invoice references
- manual adjustments
- pricing history (versioned recalculation)
- approval workflow

---

# 4.14 TripPricingItem

## Purpose

The TripPricingItem entity represents a single pricing component of a TripPricing calculation.

Instead of storing pricing in multiple database columns, every pricing component is stored as an individual Pricing Item.

This makes the Pricing Engine completely extensible.

New pricing rules can be introduced without requiring database changes.

---

## Responsibilities

The TripPricingItem entity is responsible for storing:

- individual pricing components
- calculation order
- calculation result
- pricing metadata
- optional references to business entities

The entity does not perform calculations.

Calculations are performed exclusively by the Pricing Engine.

---

## Entity Owner

Owner

Pricing Engine

Only the Pricing Engine may create or update TripPricingItems.

The Administrator may manually override values in future versions if allowed.

---

## Relationships

One TripPricing

↓

contains

↓

Many TripPricingItems

Every TripPricingItem belongs to exactly one TripPricing.

Every TripPricingItem references exactly one PricingComponent.

A TripPricingItem may optionally additionally reference:

- CustomProperty
- PricingRule (future)

---

## Pricing Type

Each TripPricingItem is classified through its referenced PricingComponent.

There is no independent Type field on TripPricingItem.

PricingComponent is the single source of truth for what kind of pricing item a TripPricingItem represents.

Additional pricing types may be introduced by adding new PricingComponent records, without changing the database structure.

---

## Stored Information

A TripPricingItem should contain:

- PricingComponent reference
- Description
- Amount
- Currency
- Calculation Order
- Quantity (optional)
- Unit Price (optional)
- Reference Entity (optional)
- Notes (optional)

---

## Calculation Order

Pricing items should preserve the order in which they were calculated.

Example

1 Base Tariff

2 Fuel

3 Waiting Time

4 Custom Properties

5 Manual Adjustment

This improves transparency and debugging.

---

## Reference Entity

A PricingItem may optionally reference another business entity in addition to its PricingComponent, to explain exactly why it exists.

Example

PricingComponent: CUSTOM_PROPERTY

↓

Reference Entity: TAR

or

PricingComponent: CUSTOM_PROPERTY

↓

Reference Entity: Flat

---

## Manual Adjustments

Future versions may allow manual pricing adjustments.

These should be stored as independent PricingItems.

Example

PricingComponent

MANUAL_ADJUSTMENT

Description

Extra Ferry Cost

Amount

€45

This preserves the complete pricing history.

---

## Business Constraints

Every TripPricingItem belongs to exactly one TripPricing.

TripPricingItems are ordered.

Amounts may be positive or negative.

PricingItems are never shared between Trips.

Historical PricingItems should never be removed.

---

## Future Considerations

TripPricingItem should support future extensions such as:

- VAT
- Customer Discounts
- Country Surcharges
- Weekend Surcharges
- Night Surcharges
- CO₂ Charges
- Toll Calculations
- Automatic Route Pricing
- Currency Conversion

---

# 4.15 CalendarEvent

## Purpose

The CalendarEvent entity represents an event in the Administrator's personal planning calendar.

Calendar events are completely independent from transport Trips.

The calendar is intended for internal planning, reminders and appointments.

Calendar events never affect transport planning.

---

## Responsibilities

The CalendarEvent entity is responsible for storing:

- appointments
- reminders
- meetings
- personal planning
- internal events

The entity must never contain Trip information.

---

## Entity Owner

Owner

Backend Service

Calendar Events are created, modified and deleted manually by the Administrator.

---

## Relationships

CalendarEvent has no direct relationship with Trips.

Calendar Events are standalone records.

Future versions may optionally reference a Trip.

---

## Event Types

Suggested event types:

MEETING

REMINDER

PERSONAL

MAINTENANCE

OTHER

Additional event types may be introduced in future versions.

---

## Scheduling

Every Calendar Event contains:

- Start Date
- Start Time
- End Date (optional)
- End Time (optional)

Events may span multiple days.

---

## Stored Information

A CalendarEvent should contain:

- Title
- Description (optional)
- Event Type
- Start Date
- Start Time
- End Date (optional)
- End Time (optional)
- Color (optional)

---

## Business Constraints

Calendar Events are independent from Trips.

Deleting a Calendar Event never affects business data.

Calendar Events may overlap.

---

## Future Considerations

The CalendarEvent entity should support future extensions such as:

- recurring events
- notifications
- reminders
- attachments
- Trip references
- Outlook synchronization
- Google Calendar synchronization

---

# 4.16 Note

## Purpose

The Note entity represents a free-form note created by the Administrator.

Notes are intended for personal use and internal administration.

They are independent from Trips and Calendar Events.

---

## Responsibilities

The Note entity is responsible for storing:

- free-form text
- reminders
- internal information

Notes do not affect any business logic.

---

## Entity Owner

Owner

Backend Service

Notes are created, modified and deleted manually by the Administrator.

---

## Relationships

Notes are standalone entities.

They currently have no relationship with Trips or other business entities.

Future versions may optionally allow Notes to reference:

- Trips
- Drivers
- Vehicles
- Maintenance

---

## Stored Information

A Note should contain:

- Title
- Content
- Color (optional)
- Created At
- Updated At

---

## Business Constraints

Notes are independent.

Deleting a Note has no impact on other entities.

Notes may contain unlimited text.

---

## Future Considerations

The Note entity should support future extensions such as:

- attachments
- markdown formatting
- reminders
- pinned notes
- linked business entities

---

# 4.17 Setting

## Purpose

The Setting entity stores all configurable application settings.

The system should be fully configurable without requiring code changes.

Settings are organized into logical categories.

New settings should be introduced by inserting new records instead of modifying the database schema.

---

## Responsibilities

The Setting entity is responsible for storing:

- application configuration
- planning configuration
- pricing configuration
- parser configuration
- import configuration
- export configuration
- feature toggles

Settings are global for the application.

---

## Entity Owner

Owner

Backend Service

Settings are managed manually through the Administrator Settings page.

The Pricing Engine, Import Service, Parser Service and Backend read settings when needed.

---

## Relationships

Settings are standalone entities.

They are referenced by application services but are not directly linked to Trips.

---

## Categories

Every Setting belongs to exactly one category.

Suggested categories include:

GENERAL

PLANNING

PRICING

IMPORT

EXPORT

PARSER

NOTIFICATION

WHATSAPP

Additional categories may be added without changing the database structure.

---

## Value Types

Every Setting has a value type.

Supported types:

STRING

INTEGER

DECIMAL

BOOLEAN

DATE

JSON

This allows the application to validate values correctly.

---

## Stored Information

A Setting should contain:

- Category
- Key
- Value
- Value Type
- Description
- Default Value (optional)
- Active Status

---

## Examples

Examples of Settings include:

Fuel Percentage

Waiting Time Hourly Price

Default Planning View

IMAP Folder

Export Company Name

Parser Confidence Threshold

WhatsApp Enabled

Night Mode Default

Supported Languages

---

## Business Constraints

Every Setting key must be unique within its category.

Inactive Settings are ignored by the application.

Settings should never be physically deleted.

Changing a Setting should not automatically modify historical business data.

---

## Future Considerations

The Setting entity should support future extensions such as:

- encrypted values
- validation rules
- environment overrides
- tenant-specific settings
- version history
- audit logging

---

---

# 4.18 RoutePricing

## Purpose

The RoutePricing entity defines the configured base transport price for a specific route.

It is used when the active Pricing Strategy is configured as **Route-Based Pricing**.

The entity allows the Administrator to maintain transport prices without modifying application code.

Every route price is configurable through the application.

---

## Responsibilities

The RoutePricing entity is responsible for:

- storing base prices for routes
- supporting route-based pricing
- allowing pricing maintenance through Settings
- providing pricing information to the Pricing Engine

The entity must never contain calculated pricing.

---

## Entity Owner

Owner

Backend Service

Route Pricing records are created and maintained by the Administrator.

The Pricing Engine only reads Route Pricing.

---

## Relationships

One RoutePricing may be used by many Trips.

Trips do not reference RoutePricing directly.

The Pricing Engine selects the correct RoutePricing during calculation.

---

## Route Definition

A RoutePricing represents one transport route.

A route is typically defined using:

- Departure Location
- Destination Location

Future versions may additionally support:

- Customer
- Terminal
- Country
- Region
- Container Type

---

## Stored Information

A RoutePricing should contain:

- Route Name
- Departure
- Destination
- Base Price
- Active Status
- Notes (optional)

---

## Business Constraints

Routes should be unique among active RoutePricing records.

Only active RoutePricing records may be used.

Historical Trip pricing must never change automatically after RoutePricing modifications.

---

## Future Considerations

RoutePricing should support future extensions such as:

- Customer-specific prices
- Seasonal pricing
- Effective dates
- Distance overrides
- Container-type pricing
- Weekend pricing

---

---

# 4.19 PricingComponent

## Purpose

The PricingComponent entity defines the available pricing components used by the Pricing Engine.

Pricing Components describe *what* can contribute to the total Trip price.

The Pricing Engine should never rely on hardcoded pricing component names.

Instead, it reads Pricing Components from the database.

---

## Responsibilities

The PricingComponent entity is responsible for:

- defining available pricing components
- controlling display order
- providing reusable pricing definitions
- supporting reporting and exports

PricingComponent does not store calculated values.

---

## Entity Owner

Owner

Backend Service

Pricing Components are managed by the Administrator.

The Pricing Engine uses them during calculation.

---

## Relationships

One PricingComponent may be referenced by many TripPricingItems.

Every TripPricingItem references exactly one PricingComponent.

---

## Examples

Examples include:

- Base Price
- Fuel Surcharge
- Combination
- Waiting Time
- Toll
- Tunnel
- Custom Property
- Manual Adjustment

Future pricing components may be added without modifying application code.

---

## Stored Information

A PricingComponent should contain:

- Code
- Name
- Description
- Display Order
- Active Status

---

## Business Constraints

Pricing Component codes should be unique among active Pricing Components.

Inactive Pricing Components cannot be used for new calculations.

Historical pricing remains unchanged.

---

## Future Considerations

PricingComponent should support future extensions such as:

- Categories
- Icons
- Reporting Groups
- Export Labels
- Localization

---

# 4.20 VehicleAssignment

## Purpose

The VehicleAssignment entity represents the historized relationship between a Driver and a Vehicle.

It records which Driver operates which Vehicle (license plate) over time.

VehicleAssignment exists so that the Driver of a historical Trip can always be resolved correctly, even after a Vehicle is later reassigned to a different Driver.

---

## Responsibilities

The VehicleAssignment entity is responsible for:

- linking one Driver to one Vehicle for a specific period
- preserving historical Driver/Vehicle pairings
- providing the default Driver for a Trip through its assigned Vehicle

The VehicleAssignment entity must never contain:

- trip information
- pricing information
- parser information

---

## Entity Owner

Owner

Backend Service

VehicleAssignment records are created and maintained manually by the Administrator.

The system never creates VehicleAssignment records automatically.

---

## Creation

A VehicleAssignment is created when the Administrator links a Driver to a Vehicle.

The assignment starts on a Valid From date.

The assignment remains active until a Valid To date is set, typically when the Vehicle is reassigned to another Driver.

---

## Relationships

One Vehicle

↓

may have

↓

Many VehicleAssignment records over time

One Driver

↓

may have

↓

Many VehicleAssignment records over time

Only one VehicleAssignment per Vehicle may be active (no Valid To date) at any point in time.

---

## Resolving a Trip's Driver

The Driver of a Trip is resolved by finding the VehicleAssignment for the Trip's assigned Vehicle where the Trip's Planning Date falls within the Valid From and Valid To period.

If the Trip defines a direct Driver override, the override takes precedence instead.

---

## Stored Information

A VehicleAssignment should contain:

- Vehicle
- Driver
- Valid From
- Valid To (optional, empty while active)
- Notes (optional)

---

## Business Constraints

Every VehicleAssignment belongs to exactly one Vehicle and exactly one Driver.

VehicleAssignment periods for the same Vehicle must not overlap.

VehicleAssignment records are never physically deleted.

Ending an assignment (setting Valid To) never changes the Driver already resolved for historical Trips.

---

## Future Considerations

The VehicleAssignment entity should support future extensions such as:

- multiple simultaneous drivers per Vehicle (team driving)
- assignment reason
- assignment approval workflow

---

# 4.21 TripCustomProperty

## Purpose

The TripCustomProperty entity represents the assignment of one CustomProperty to one Trip.

It implements the many-to-many relationship between Trip and CustomProperty.

---

## Responsibilities

The TripCustomProperty entity is responsible for:

- linking a Trip to a CustomProperty
- allowing a Trip to carry multiple Custom Properties
- allowing a CustomProperty to be reused across many Trips

The TripCustomProperty entity must never contain:

- pricing calculations
- parser information
- planning information

---

## Entity Owner

Owner

Backend Service

Custom Property assignments are managed manually by the Administrator through the Trip.

The Parser Service never creates TripCustomProperty records directly.

---

## Creation

A TripCustomProperty record is created when the Administrator assigns a Custom Property to a Trip.

A TripCustomProperty record is removed when the Administrator removes a Custom Property from a Trip.

---

## Relationships

One Trip

↓

may have

↓

Many TripCustomProperty records

One CustomProperty

↓

may have

↓

Many TripCustomProperty records

Every TripCustomProperty belongs to exactly one Trip and exactly one CustomProperty.

---

## Pricing

The Pricing Engine reads the Trip's TripCustomProperty records to determine which Custom Properties to include during calculation.

The pricing value used at calculation time is read from the referenced CustomProperty's current configuration.

Once calculated, the resulting amount is stored independently inside TripPricingItem and no longer depends on TripCustomProperty or CustomProperty.

---

## Stored Information

A TripCustomProperty should contain:

- Trip
- CustomProperty
- Added Timestamp

---

## Business Constraints

Every TripCustomProperty belongs to exactly one Trip and exactly one CustomProperty.

The same CustomProperty should not be assigned twice to the same Trip.

Adding or removing a TripCustomProperty should create a TripHistory record.

---

## Future Considerations

The TripCustomProperty entity should support future extensions such as:

- a Trip-specific price override
- assignment notes

---

# 5. Entity Relationships

This chapter defines the relationships between all business entities.

It serves as the foundation for the PostgreSQL schema, Prisma models and Backend domain model.

Every relationship should be implemented exactly as defined here.

---

# Trip Relationships

## Trip → TripGroup

Relationship

Many-to-One

A Trip may belong to zero or one TripGroup.

A TripGroup contains one or more Trips.

Deleting a TripGroup never deletes Trips.

Removing a Trip from a group only removes the relationship.

---

## Trip → Driver

Relationship

Derived, with optional override

A Trip's Driver is resolved from the active VehicleAssignment of its assigned Vehicle, on the Trip's Planning Date.

A Trip may optionally define a direct Driver override, which takes precedence for that Trip only.

Changing the Driver override should create a TripHistory record.

---

## Trip → Vehicle

Relationship

Many-to-One

A Trip may have zero or one assigned Vehicle.

A Vehicle may be assigned to many Trips, as long as their planned time intervals do not overlap.

Historical assignments should never change.

---

## Trip → PdfDocument

Relationship

Many-to-One

Every Trip originates from exactly one PdfDocument.

A PdfDocument may generate one or multiple Trips.

Trips may never exist without a PdfDocument.

---

## Trip → TripPricing

Relationship

One-to-Zero-or-One

A Trip has at most one active TripPricing, which only exists once the Trip reaches CLOSED status.

TripPricing cannot exist without a Trip.

---

## Trip → TripHistory

Relationship

One-to-Many

A Trip may have many TripHistory records.

History records are immutable.

---

## Trip → CustomProperty

Relationship

Many-to-Many

Implemented through:

TripCustomProperty

Trips may contain multiple Custom Properties.

Custom Properties may belong to multiple Trips.

---

# Driver Relationships

## Driver → Vacation

Relationship

One-to-Many

Drivers may have multiple Vacation periods.

Vacation records never affect historical Trips.

---

## Driver → Vehicle (through VehicleAssignment)

Relationship

Many-to-Many, historized

A Driver may be linked to many Vehicles over time, through VehicleAssignment.

A Vehicle may be linked to many Drivers over time, through VehicleAssignment.

Only one VehicleAssignment per Vehicle may be active at any point in time.

Historical Trips resolve their Driver using the VehicleAssignment valid at the Trip's Planning Date.

---

# Vehicle Relationships

## Vehicle → Maintenance

Relationship

One-to-Many

Vehicles may have multiple Maintenance records.

Maintenance records remain permanently available.

---

## Vehicle → VehicleAssignment

Relationship

One-to-Many, historized

A Vehicle may have multiple VehicleAssignment records over time.

Only one VehicleAssignment per Vehicle may be active (no Valid To date) at any point in time.

---

# Trailer Relationships

## Trailer → Maintenance

Relationship

One-to-Many

Trailers may have multiple Maintenance records.

Maintenance records are never shared.

---

# PdfDocument Relationships

## PdfDocument → ImportedEmail

Relationship

Many-to-One (optional)

A PdfDocument may optionally belong to one ImportedEmail.

When present, one ImportedEmail contains exactly one PdfDocument.

A PdfDocument without an ImportedEmail originates from a manual upload or another supported import source.

---

## PdfDocument → ParserRun

Relationship

One-to-Many

Each parser execution creates a ParserRun.

A PdfDocument may therefore have multiple ParserRuns.

---

# TripPricing Relationships

## TripPricing → TripPricingItem

Relationship

One-to-Many

A TripPricing consists of multiple pricing items.

Pricing items together determine the total Trip price.

---

# CustomProperty Relationships

## CustomProperty → Trip

Relationship

Many-to-Many

Implemented through:

TripCustomProperty

Custom Properties are reusable.

---

# Maintenance Relationships

Maintenance belongs to exactly one asset.

Supported asset types:

Vehicle

Trailer

A Maintenance record can never belong to both.

---

# Calendar Relationships

CalendarEvent is independent.

Calendar Events currently have no mandatory relationships.

Future versions may reference Trips.

---

# Note Relationships

Notes are independent.

Future versions may optionally reference business entities.

---

# Setting Relationships

Settings are global.

They are read by application services.

Settings never belong directly to Trips.

---

# Referential Integrity

The following rules apply to all relationships.

Trips may never exist without:

- PdfDocument

PdfDocument may optionally exist without an ImportedEmail.

TripPricing may never exist without a Trip.

TripPricing may only exist once the Trip has reached CLOSED status.

TripPricingItems may never exist without TripPricing.

Vacation may never exist without Driver.

VehicleAssignment may never exist without a Vehicle and a Driver.

Maintenance may never exist without an Asset.

ParserRun may never exist without PdfDocument.

TripHistory may never exist without Trip.

TripCustomProperty may never exist without a Trip and a CustomProperty.

CustomProperty may exist without being assigned.

Settings are always independent.

---

# Deletion Strategy

Business entities should almost never be physically deleted.

Inactive records should remain available for historical reporting.

Historical relationships should remain intact.

Physical deletion should only occur for temporary system data if explicitly allowed.

---

# Future Relationships

The model should remain compatible with future integrations such as:

- WhatsApp
- OCR
- GPS Tracking
- Customer Portal
- Driver Mobile App
- Route Optimization
- Invoice Generation
- Accounting Integration

---

# 6. Database Constraints

This chapter defines all business constraints that must be enforced by the database and backend services.

These constraints ensure data integrity and prevent invalid business states.

Business constraints should be enforced as early as possible.

Whenever possible, constraints should be implemented at database level.

More complex rules should be implemented by the Backend.

---

# Trip Constraints

A Trip:

- must always belong to exactly one PdfDocument.
- may belong to a PdfDocument that has zero or one ImportedEmail.
- must always have one Status.
- must always have one Planning Date.
- may belong to zero or one TripGroup.
- has a Driver derived from its Vehicle's active VehicleAssignment, unless overridden directly on the Trip.
- may have zero or one Vehicle.
- may have zero or one TripPricing, which only exists once the Trip is CLOSED.
- may have zero or one Container Number.
- may have many History records.
- may have many Custom Properties.

Trips are never physically deleted.

DELETED Trips remain available for historical reporting and may be restored.

---

# Combination Constraints

A Combination consists of exactly two Trips.

Both Trips belong to the same TripGroup.

Both Trips originate from the same PdfDocument.

Each Trip keeps its OWN Booking Number.

The real transport orders give the two legs different numbers — for example
DUBANR2598395 for the Delivery and ANRBEL2603249 for the Collection — so the
TripGroup is what links them, never a shared Booking Number.

Booking Number uniqueness therefore applies to each Trip independently, with no
exception for a Combination.

Container Numbers may differ.

Trips inside a Combination remain completely independent.

The following fields may differ:

- Planning Date
- Driver
- Vehicle
- Status
- Waiting Time
- Pricing
- Completion Time

Removing a Trip from a Combination never deletes the other Trip.

---

# Driver Constraints

Drivers:

- are created manually.
- are never created automatically.
- are never physically deleted.

Inactive Drivers:

- cannot receive new Trips.
- remain linked to historical Trips.

Drivers may have multiple Vacation periods.

Vacation periods may not overlap.

A Driver may have multiple VehicleAssignment periods over time.

VehicleAssignment periods for the same Vehicle may not overlap.

---

# Vehicle Constraints

Vehicles:

- are created manually.
- are never physically deleted.
- must have a unique License Plate among active Vehicles.

Inactive Vehicles:

- cannot receive new Trips.

Historical Trips always preserve the original Vehicle.

A Vehicle cannot be assigned to two Trips with overlapping planned time intervals.

---

# Trailer Constraints

Trailers:

- are created manually.
- are never assigned to Trips.
- are only used for Maintenance.

License Plates must be unique among active Trailers.

---

# Maintenance Constraints

Every Maintenance record belongs to exactly one asset.

Supported assets:

- Vehicle
- Trailer

Maintenance records are immutable after completion.

Maintenance history is never removed.

---

# Pricing Constraints

A Trip has zero or one TripPricing.

A TripPricing only exists once the Trip reaches CLOSED status.

TripPricing contains one or more TripPricingItems.

The Total Price equals the sum of all active PricingItems.

Reprocessing pricing overwrites the existing TripPricing using current Settings.

Reprocessing pricing does not preserve the previous calculated result.

---

# Parser Constraints

Every Parser execution creates one ParserRun.

ParserRuns are immutable.

ParserRuns are never deleted.

ParserRuns never modify manual Trip fields.

---

# Manual Override Constraints

The following fields always take priority over parser updates:

- Planning Date
- Driver Override
- Vehicle
- Waiting Time
- Distance
- Container Number
- Custom Properties
- Internal Notes

Parser updates may only modify parser-controlled fields.

Parser Metadata is parser-controlled and is replaced on every reprocessing.

---

# PDF Constraints

Every PdfDocument:

- may belong to zero or one ImportedEmail.
- may generate one or more Trips.

The original PDF is never modified.

The original PDF is never replaced.

---

# Imported Email Constraints

Only emails with the following subject prefixes are processed:

- NEW:
- UPDATE:
- CANCEL:

Every processed email must contain exactly one PDF.

Duplicate emails must not create duplicate Trips.

Message-ID must be unique.

---

# Soft Delete Constraints

The following entities should support soft delete:

- Trip
- Driver
- Vehicle
- Trailer
- CustomProperty
- RoutePricing
- PricingComponent

Soft deleted entities:

- remain in the database
- remain visible in historical data
- cannot be selected for new operations

Uniqueness constraints on these entities (License Plate, Property Name, Route, Component Code) apply only among active records, allowing the same value to be reused after deactivation.

---

# Audit Constraints

The following actions must create a TripHistory record:

- Driver changed
- Vehicle changed
- Planning Date changed
- Status changed
- Waiting Time changed
- Container Number entered
- Container Number modified
- Custom Property added
- Custom Property removed
- Trip reopened
- Trip cancelled
- Trip restored

---

# Future Compatibility

The database must remain compatible with future features such as:

- Multiple Companies
- Multiple Customers
- GPS Tracking
- WhatsApp Integration
- OCR
- Driver Mobile Application
- Route Optimization
- Invoice Generation
- Accounting Integration


---

# 4.22 RouteCost

## Purpose

The RouteCost entity defines the monetary amount of a route-dependent Pricing
Component for one transport route.

Some charges are not fixed. Their amount depends on the route a Trip takes.

Toll and Tunnel costs are the first examples: whether they apply is a property
of the Trip, but how much they cost is a property of the route.

RouteCost holds that amount.

---

## Responsibilities

The RouteCost entity is responsible for:

- storing route-dependent amounts per Pricing Component
- allowing route costs to be maintained without code changes
- providing amounts to the Pricing Engine

The entity must never contain:

- calculated pricing
- Trip information
- applicability rules

Whether a component applies to a Trip is decided by TripCustomProperty, never
by RouteCost.

---

## Entity Owner

Owner

Backend Service

RouteCost records are created and maintained by the Administrator.

The Pricing Engine only reads RouteCost.

---

## Relationship with RoutePricing

RouteCost is **independent** of RoutePricing.

RoutePricing supplies the base transport price and is used only when the active
Pricing Strategy is Route-Based Pricing.

A toll is incurred whichever strategy produced the base price. If RouteCost
belonged to RoutePricing, switching the Pricing Strategy would silently remove
every toll and tunnel charge.

RouteCost therefore identifies its route by departure and destination in its own
right, exactly as RoutePricing does, without referencing it.

A route may have a RouteCost without having a RoutePricing, and the reverse.

---

## Route Definition

A RouteCost applies to one route, defined as:

- Departure Location
- Destination Location

The departure is the Trip's Terminal and the destination is the Trip's
Destination City, resolved the same way for every Pricing Strategy.

Future versions may extend the route definition in the same directions as
RoutePricing.

---

## Relationships

One RouteCost

↓

belongs to

↓

Exactly one PricingComponent

One PricingComponent

↓

may have

↓

Many RouteCosts, one per route

Trips do not reference RouteCost directly.

The Pricing Engine selects the correct RouteCost during calculation.

---

## Stored Information

A RouteCost should contain:

- Departure
- Destination
- Pricing Component
- Amount
- Active Status
- Notes (optional)

---

## Missing Configuration

A Trip may have a route-priced Custom Property assigned while no RouteCost is
configured for its route.

This is missing configuration, not a charge of zero.

The Pricing Engine must fail the calculation with a domain exception. It must
never skip the line silently and never price it as zero: the Administrator
explicitly stated the charge applies, and producing a Trip price without it
would understate the total with no visible cause.

The same applies when a Trip has no resolvable route at all.

---

## Business Constraints

A route is unique per Pricing Component among active RouteCost records.

Amounts are never negative, because negative pricing is not supported.

Only active RouteCost records may be used for new calculations.

Historical Trip pricing must never change automatically after a RouteCost is
modified.

RouteCost records are never physically deleted.

---

## Future Considerations

The RouteCost entity should support future extensions such as:

- Effective dates
- Customer-specific route costs
- Container-type dependent costs
- Vehicle-type dependent costs
- Additional route-dependent components
