# Error Codes

## Purpose

This document defines standardized error codes used throughout the Transport Management System.

Every microservice should use these codes when returning errors or writing logs.

The goal is to:

- simplify debugging
- simplify support
- make logs searchable
- keep error messages consistent

---

# General Format

Every error code follows:

SERVICE_CATEGORY_NUMBER

Example

PARSER_001

BACKEND_014

PRICING_007

IMAP_003

DATABASE_001

AUTH_002

EXPORT_004

---

# Parser Errors

## PARSER_001

Unsupported PDF Layout

The parser could not identify the document layout.

---

## PARSER_002

Missing Booking Number

Booking Number could not be extracted.

---

## PARSER_003

Invalid Date

The planning date could not be parsed.

---

## PARSER_004

Invalid Time

The planning time could not be parsed.

---

## PARSER_005

Container Type Missing

No valid container type was found.

---

## PARSER_006

Address Extraction Failed

The address section could not be interpreted.

---

## PARSER_007

Terminal Extraction Failed

Terminal could not be extracted.

---

## PARSER_008

Unexpected Parser Exception

Unexpected parser error.

---

## PARSER_009

Invalid PDF

The PDF could not be read.

---

## PARSER_010

Multiple Matching Sections

The parser detected multiple possible sections.

Manual review required.

---

# IMAP Errors

## IMAP_001

Connection Failed

---

## IMAP_002

Authentication Failed

---

## IMAP_003

Duplicate Email

Email already processed.

---

## IMAP_004

No PDF Attachment

---

## IMAP_005

Attachment Download Failed

---

## IMAP_006

Mailbox Access Failed

---

# Backend Errors

## BACKEND_001

Trip Not Found

---

## BACKEND_002

Booking Already Exists

---

## BACKEND_003

Trip Group Missing

---

## BACKEND_004

Invalid Trip Status

---

## BACKEND_005

Vehicle Not Found

---

## BACKEND_006

Driver Not Found

---

## BACKEND_007

Trip Update Failed

---

## BACKEND_008

Trip Cancellation Failed

---

## BACKEND_009

Database Transaction Failed

---

# Pricing Errors

## PRICING_001

Pricing Rule Missing

---

## PRICING_002

Fuel Percentage Missing

---

## PRICING_003

Waiting Time Invalid

---

## PRICING_004

Calculation Failed

---

## PRICING_005

Unknown Custom Property

---

## PRICING_006

Combination Rule Failed

---

## PRICING_007

Pricing Configuration Invalid

---

# Export Errors

## EXPORT_001

Excel Generation Failed

---

## EXPORT_002

No Trips Selected

---

## EXPORT_003

Export Template Missing

---

## EXPORT_004

File Write Failed

---

# Database Errors

## DATABASE_001

Connection Failed

---

## DATABASE_002

Migration Failed

---

## DATABASE_003

Constraint Violation

---

## DATABASE_004

Query Timeout

---

## DATABASE_005

Transaction Failed

---

# Authentication Errors

## AUTH_001

Unauthorized

---

## AUTH_002

Token Expired

---

## AUTH_003

Permission Denied

---

## AUTH_004

Session Invalid

---

# Frontend Errors

## UI_001

Unexpected Application Error

---

## UI_002

API Request Failed

---

## UI_003

File Upload Failed

---

## UI_004

Download Failed

---

# Future Errors

Whenever a new module is added,

create a dedicated section.

Never reuse an existing error code for another purpose.

Error codes are immutable once released.