# Testing Strategy

## Purpose

This document defines the testing strategy for the Transport Management System.

Testing ensures that new features and bug fixes do not break existing functionality.

Every microservice should include automated tests where appropriate.

---

# Testing Philosophy

Every bug that is fixed should result in a new automated test.

This prevents the same issue from occurring again.

Regression testing is mandatory.

---

# Types of Tests

The project uses multiple testing levels.

- Unit Tests
- Integration Tests
- End-to-End Tests
- Regression Tests
- Manual Acceptance Tests

---

# Unit Tests

Unit tests verify small isolated pieces of logic.

Examples:

Price calculations

Address normalization

Booking extraction

Date parsing

Container parsing

Waiting time calculation

Custom property calculation

Unit tests should not access the database.

---

# Integration Tests

Integration tests verify communication between components.

Examples:

Backend → Database

Backend → Pricing Engine

IMAP → Parser

Parser → Backend

Excel Export

Authentication

---

# End-to-End Tests

End-to-End tests simulate complete business workflows.

Example:

Receive Email

↓

Download PDF

↓

Parse PDF

↓

Create Trips

↓

Calculate Pricing

↓

Show Dashboard

↓

Export Excel

The complete flow should succeed.

---

# Regression Tests

Regression testing is mandatory.

Whenever a parser bug is fixed,

the PDF that caused the bug should be added to the regression test suite.

Future parser changes must never break existing supported layouts.

---

# Parser Tests

Every supported parser layout should have dedicated tests.

Current layouts:

Single Page

Single Two Page

Combination

Every layout should contain multiple real-world examples.

---

# Pricing Tests

Every pricing rule should be tested independently.

Examples:

Fuel

Waiting Time

Combination

Custom Properties

Manual Costs

Percentage Changes

Future pricing rules should include new tests.

---

# Import Tests

Verify:

NEW

UPDATE

CANCEL

Duplicate Email

Missing Attachment

Corrupt PDF

---

# Planning Tests

Verify:

Move Trip

Assign Driver

Assign Vehicle

Combination

Trip Group

Finished

Cancelled

Deleted

Container entered manually

---

# Export Tests

Verify:

Daily Export

Weekly Export

Monthly Export

Excel formatting

Calculated totals

Combination trips

Cancelled trips

Finished trips

---

# Database Tests

Verify:

Constraints

Relationships

Cascade behaviour

Transactions

Indexes

---

# UI Tests

Verify:

Dashboard

Planning

Settings

Maintenance

Agenda

Dark Mode

Language Switching

Tablet Layout

---

# Performance Tests

Measure:

Parser Speed

Import Speed

Pricing Speed

Excel Export Speed

Dashboard Loading

Database Queries

---

# Manual Acceptance Tests

Before every release:

Import sample PDFs

Verify planning

Verify pricing

Verify exports

Verify maintenance

Verify settings

Verify language switching

Verify dark mode

---

# Test Data

Real customer data should never be committed.

Use anonymized PDFs whenever possible.

Sensitive information should be removed.

---

# Responsibilities

Every developer is responsible for maintaining tests.

No feature is complete until its corresponding tests have been added.

Testing is part of development, not an optional step.