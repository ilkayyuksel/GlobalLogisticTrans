# Import Rules

## Purpose

This document describes how transport orders enter the Transport Management System.

The import process is fully automated and starts from incoming emails.

The goal is to transform every valid transport order PDF into one or more trips inside the system.

---

# Supported Sources

Currently supported:

- IMAP Email

Future sources may include:

- WhatsApp
- Manual PDF Upload
- Drag & Drop
- REST API
- EDI

The import process should remain extensible.

---

# Import Flow

Every import follows the same workflow.

Email

↓

IMAP Service

↓

Attachment Validation

↓

PDF Parser

↓

Parsed Trips

↓

Backend Validation

↓

Database

↓

Pricing Engine

↓

Dashboard

---

# Email Rules

The IMAP service continuously monitors one mailbox.

Configuration is provided through environment variables.

Only unread emails are processed.

---

# Supported Subjects

An email is only processed when the subject starts with one of the following prefixes.

NEW:

Creates one or more new trips.

UPDATE:

Updates one or more existing trips.

CANCEL:

Cancels one or more existing trips.

Subjects are case insensitive.

Examples:

NEW: Trucking Order

UPDATE: Booking Changed

CANCEL: Booking Cancelled

---

# Attachments

Every supported email should contain exactly one PDF attachment.

The attachment must be downloaded.

Other attachments are ignored.

If no PDF exists,

the email should be marked as failed.

---

# Duplicate Detection

The same email should never be processed twice.

The system must detect duplicates.

Possible identifiers:

- Message-ID
- IMAP UID
- Attachment hash

Duplicate imports must be skipped.

---

# PDF Validation

Before parsing,

the system validates:

- File exists
- PDF format
- File is readable
- File is not corrupted

Invalid PDFs are rejected.

---

# Parsing

The parser converts the PDF into one or more Parsed Trips.

The parser performs no database operations.

The parser performs no pricing calculations.

The parser performs no planning.

Its only responsibility is extracting structured data.

---

# Parsed Trip Validation

After parsing,

the backend validates:

Required fields

Recognized layout

Supported document type

Known booking number

Data consistency

Invalid trips are rejected.

---

# Import Types

## NEW

Creates completely new trips.

The system stores:

Trip

PDF

Import History

Pricing

---

## UPDATE

Updates an existing trip.

The original trip should remain in history.

Only allowed fields are updated.

The update should trigger a new pricing calculation.

---

## CANCEL

The trip is never deleted.

Instead,

Status = CANCELLED

The trip remains visible in history.

Cancelled trips should not appear in active planning by default.

---

# Combination Trips

One PDF may contain multiple trips.

The parser should return multiple Parsed Trips.

The backend should:

Create all trips.

Assign them the same Trip Group.

Keep every trip independent.

Every trip can later:

Move to another day.

Receive another vehicle.

Receive another driver.

Be completed independently.

Be cancelled independently.

Removing the group should never merge the trips.

---

# PDF Storage

Every processed PDF should be stored.

The PDF is linked to all trips originating from that PDF.

Users should always be able to:

View the PDF.

Download the PDF.

Reprocess the PDF.

---

# Reprocessing

Admin can manually reprocess a PDF.

Reprocessing should:

Reuse the stored PDF.

Reuse the current parser.

Reuse current pricing rules.

Generate new pricing.

Parser updates should therefore automatically improve old imports.

---

# Failed Imports

Imports may fail because of:

Invalid PDF

Unsupported layout

Missing required data

Unexpected parser error

Database error

Every failure should be logged.

No partial data should remain.

---

# Import History

Every import should create an Import History record.

Suggested information:

Import Time

Email Subject

Sender

Message ID

Status

PDF

Parser Version

Result

This enables future debugging.

---

# Idempotency

Processing the same email multiple times must never create duplicate trips.

The import process should always be idempotent.

---

# Future Compatibility

The import process should support additional sources without modifying business logic.

Only the import adapter should change.

Parser, Backend and Pricing Engine should remain unchanged.

---

# Responsibilities

IMAP

Receive emails.

Download attachments.

Parser

Extract structured information.

Backend

Validate data.

Persist data.

Manage trip lifecycle.

Pricing Engine

Calculate all pricing.

Frontend

Display results.

Never perform import logic.