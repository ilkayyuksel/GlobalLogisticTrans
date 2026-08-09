# Logging Guidelines

## Purpose

This document defines the logging strategy used throughout the Transport Management System.

Logging should make debugging simple while keeping logs readable and meaningful.

Every microservice follows the same logging conventions.

---

# Objectives

Logging should answer:

- What happened?
- When did it happen?
- Why did it happen?
- Which entity was affected?
- Did it succeed?

Logs should help developers reproduce issues quickly.

---

# Logging Principles

Log meaningful events.

Do not log everything.

Too much logging becomes noise.

Every log should provide value.

---

# Log Levels

## TRACE

Very detailed diagnostic information.

Used only during development.

Disabled in production.

---

## DEBUG

Useful technical information.

Examples:

Parser layout selected.

Pricing rule executed.

Database query duration.

Should normally be disabled in production.

---

## INFO

Normal application events.

Examples:

Trip imported.

Trip updated.

Pricing calculated.

Vehicle assigned.

Driver assigned.

PDF parsed successfully.

---

## WARN

Unexpected situations that do not stop execution.

Examples:

Container number missing.

Unknown optional field.

PDF missing remarks section.

Retry performed.

---

## ERROR

An operation failed.

Examples:

Database unavailable.

Parser failed.

Invalid PDF.

Pricing calculation failed.

Excel export failed.

---

## FATAL

Application cannot continue.

Examples:

Database connection impossible.

Configuration invalid.

Application startup failed.

---

# Required Context

Every log entry should contain enough context.

Examples:

Timestamp

Microservice

Operation

Entity Type

Entity ID

Duration (when applicable)

Example

[INFO]

Parser

Booking ANRBEL2768902 parsed successfully

---

# Correlation ID

Every import should receive a Correlation ID.

The same Correlation ID should be reused across:

IMAP

↓

Parser

↓

Backend

↓

Pricing

↓

Database

This allows tracing one import through the entire system.

---

# IMAP Logging

Log:

Connection established

Mailbox opened

Email detected

Email downloaded

Attachment downloaded

Email processed

Duplicate email skipped

Import failed

Do not log:

Passwords

Tokens

IMAP credentials

---

# Parser Logging

Log:

Detected layout

Parser selected

Booking extracted

Trip count

Combination detected

Container missing

Unsupported layout

Parsing duration

Never log the full PDF contents.

---

# Backend Logging

Log:

Trip created

Trip updated

Trip cancelled

Trip moved

Driver assigned

Vehicle assigned

Pricing requested

Excel exported

Settings changed

---

# Pricing Engine Logging

Log:

Calculation started

Calculation completed

Calculation duration

Rules executed

Warnings

Calculation failed

Do not log internal formulas every time unless DEBUG is enabled.

---

# Frontend Logging

Only log:

Unexpected UI errors

Unhandled exceptions

API failures

Do not log user interactions unless required.

---

# Database Logging

Log:

Connection established

Migration started

Migration completed

Slow queries

Connection failures

Never log SQL credentials.

---

# Performance Logging

Operations taking longer than expected should be logged.

Examples:

PDF parsing

Excel generation

Database queries

Pricing calculation

Email processing

---

# Security

Never log:

Passwords

JWT Tokens

API Keys

Environment variables

Database credentials

Sensitive personal information

---

# Structured Logging

Always use structured logging.

Avoid concatenated strings.

Good

Service

Operation

Trip ID

Booking Number

Duration

Status

Bad

"Trip imported successfully"

---

# Exception Logging

Every unexpected exception should include:

Operation

Service

Exception

Stack Trace (development)

Correlation ID

---

# Retention

Production logs should remain available for troubleshooting.

Development logs may be more verbose.

Retention strategy will be defined during deployment.

---

# Responsibilities

Every microservice is responsible for its own logging.

Logs should never contain business logic.

Logging should never modify application behaviour.
