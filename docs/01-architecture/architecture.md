# System Architecture

# Overview

The Transport Management System (TMS) is designed as a modular, service-oriented application.

Every major responsibility is isolated into its own service.

Each service owns a single responsibility and communicates with other services through clearly defined interfaces.

The objective is to keep the application maintainable, testable and scalable as new features are introduced.

---

# High Level Architecture

                    ┌──────────────┐
                    │     IMAP     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    Parser    │
                    └──────┬───────┘
                           │ ParsedTrip
                           ▼
                    ┌──────────────┐
                    │   Backend    │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    PostgreSQL      Pricing Engine     Auth0
          ▲                │
          └────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Frontend    │
                    └──────────────┘

---

# Core Principles

The architecture follows these principles:

- Single Responsibility
- Separation of Concerns
- Loose Coupling
- High Cohesion
- Clean Architecture
- Explicit Boundaries
- Reusability
- Scalability
- Testability

Every module should remain independently understandable.

---

# Frontend

## Purpose

The frontend provides the user interface.

Its responsibility is limited to:

- displaying information
- collecting user input
- communicating with the backend
- rendering dashboards
- rendering planning views
- rendering forms
- displaying reports

The frontend should never implement business rules.

The frontend never accesses the database directly.

The frontend never communicates directly with infrastructure services.

All communication goes through the backend.

---

# Backend

## Purpose

The backend is the heart of the application.

It owns:

- business rules
- workflow orchestration
- validation
- permissions
- calculations
- planning logic
- exports
- integrations

The backend is the only component that decides how the system behaves.

Every external service communicates through the backend.

---

# PDF Parser

## Purpose

The parser converts transport order PDFs into structured data.

Responsibilities:

- detect PDF layout
- extract fields
- validate extracted values
- return structured JSON

The parser never:

- writes to the database
- creates trips
- updates trips
- performs calculations
- makes business decisions

It simply extracts information.

---

# Pricing Engine

The Pricing Engine is an independent microservice.

Responsibilities:

- Calculate trip prices
- Execute pricing rules
- Apply fuel calculations
- Apply waiting time calculations
- Apply custom properties
- Calculate totals
- Return a complete pricing breakdown

The Pricing Engine never:

- stores trips
- modifies trips
- parses PDFs
- communicates with IMAP
- renders UI

---

# Email Service

## Purpose

The email service monitors the configured mailbox.

Responsibilities:

- connect to IMAP
- monitor incoming emails
- validate sender
- validate subject
- download attachments
- detect duplicates
- send PDFs to the parser

The email service never:

- parses PDFs
- creates trips
- modifies business data

Its only responsibility is orchestration.

---

# Authentication

Authentication is handled by an external identity provider.

The application itself does not manage passwords.

Responsibilities:

- user authentication
- identity verification
- access tokens

Authorization decisions remain inside the backend.

---

# Database

The database is the system of record.

It stores:

- trips
- trip groups
- planning
- vehicles
- trailers
- drivers
- maintenance
- settings
- pricing data
- exports
- documents
- audit history

No service except the backend owns business data.

---

# File Storage

Transport documents are stored separately from structured data.

Examples:

- PDFs
- exports
- generated files
- uploaded documents

The database only stores references to these files.

---

# Communication Flow

The system follows a predictable workflow.

Email arrives

↓

Email Service

↓

PDF Parser

↓

Structured JSON

↓

Backend

↓

Business Rules

↓

Database

↓

Frontend

At every step the responsibility is clearly separated.

---

# Business Logic Flow

Business logic always starts inside the backend.

Example:

Administrator edits trip

↓

Backend validates request

↓

Business rules executed

↓

Database updated

↓

Audit created

↓

Response returned

No business logic may bypass the backend.

---

# Module Independence

Every module should remain independently replaceable.

For example:

The parser may be rewritten without changing the frontend.

Authentication may change without changing planning.

The frontend may change without changing the parser.

This reduces coupling.

---

# Scalability

The architecture should support future modules without major redesign.

Potential future modules include:

- Mobile application
- Driver portal
- Customer portal
- Route optimization
- GPS integration
- Fuel administration
- Invoice generation
- AI document classification
- OCR
- Notification service
- Reporting engine

Adding these modules should not require changing the existing architecture.

---

# Integration Strategy

External systems should remain isolated.

Examples:

- Email
- WhatsApp
- ERP
- Accounting software
- GPS providers

These integrations communicate with the backend through dedicated integration layers.

Business rules remain inside the backend.

---

# Error Handling

Failures should remain isolated.

A parser failure must not stop the email service.

A frontend failure must not affect the database.

An export failure must not affect planning.

Modules should fail independently whenever possible.

---

# Logging

Every service should generate useful logs.

Logs should allow reconstructing the complete processing flow.

Examples:

Email received

↓

PDF downloaded

↓

Parser executed

↓

Trip created

↓

Pricing calculated

↓

Export generated

This greatly simplifies debugging.

---

# Audit Trail

Important business actions should be traceable.

Examples:

Trip created

Trip updated

Planning changed

Driver assigned

Pricing recalculated

Trip cancelled

Manual overrides

Historical information should never be lost.

---

# Configuration

Configuration belongs outside the application.

Examples:

- mailbox
- storage locations
- authentication
- API endpoints
- pricing configuration
- environment settings

Configuration should never be hardcoded.

---

# Security

The system follows the principle of least privilege.

Each component should only access the resources it requires.

Sensitive information should never be exposed.

All external input should be validated.

---

# Maintainability

The project is expected to grow continuously.

Architecture decisions should prioritize long-term maintainability over short-term implementation speed.

Avoid technical debt.

Refactor when necessary.

Keep modules focused.

Prefer extending the architecture over rewriting it.

---

# Guiding Principle

Every implementation should answer the following questions:

Can this be reused?

Can this be tested?

Can this be understood in six months?

Can another developer work on it without additional explanation?

Can this scale as the project grows?

If the answer is "no", reconsider the design before implementation.