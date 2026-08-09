# System Configuration

## Purpose

This document defines global system configuration that affects business behaviour.

Unlike environment variables, these settings are part of the application configuration and are stored in the database.

Administrators may change these settings through the Settings page.

Configuration should be centralized.

No business logic should contain hardcoded configuration values.

---

# General Principles

Configuration should be:

Centralized

Versioned

Validated

Auditable

Reusable

Configuration changes should never require code changes.

---

# General Settings

Application Name

Default Language

Supported Languages

Timezone

Currency

Week Start Day

Date Format

Time Format

---

# Supported Languages

Currently supported:

Dutch (nl)

Turkish (tr)

English may be added later.

All frontend text should use translations.

Hardcoded UI text is not allowed.

---

# Appearance

Supported themes:

Light

Dark

System (future)

The selected theme should persist between sessions.

---

# Planning

Planning configuration includes:

Default Planning View

Working Days

Weekend Visibility

Planning Colors

Trip Status Colors

Driver Colors

---

# Vehicles

Vehicles are managed through Settings.

Each vehicle contains:

License Plate

Description

Active Status

Default Driver (optional)

Notes

Only active vehicles can be assigned.

---

# Drivers

Drivers are managed through Settings.

Each driver contains:

Name

Phone (optional)

Color

Active Status

Vacation

Notes

Drivers on vacation cannot be assigned.

---

# Custom Properties

Administrators can create custom properties.

Examples:

Over Sint-Niklaas

Flat

TAR

Each property may contain:

Name

Description

Default Price

Enabled

Color (optional)

Order

The Pricing Engine uses these values.

---

# Fuel

Fuel configuration includes:

Fuel Percentage

Effective Date

Notes

Changing the fuel percentage should not automatically recalculate historical trips.

The Administrator decides when recalculation occurs.

---

# Excel Export

Configuration includes:

Company Name

Default Export Columns

Default Filename

Worksheet Name

Decimal Precision

Date Format

---

# PDF Storage

Configuration includes:

Storage Path

Retention Period

Maximum File Size

Allowed File Types

---

# Import

Configuration includes:

Allowed Senders

Supported Subject Prefixes

Maximum Attachment Size

Retry Attempts

Duplicate Detection Strategy

---

# Parser

Configuration includes:

Parser Version

Supported Layouts

Debug Mode

Fallback Behaviour

---

# Pricing

Configuration includes:

Pricing Version

Default Currency

Automatic Recalculation

Manual Override Policy

Future pricing settings should be added here.

---

# Authentication

Configuration includes:

Authentication Provider

Session Timeout

Password Policy (future)

User Roles (future)

---

# Audit

Configuration changes should be logged.

The system should store:

Who changed the configuration

Old Value

New Value

Timestamp

Reason (optional)

Configuration changes should be traceable.

---

# Responsibilities

Configuration defines business behaviour.

Environment variables define runtime behaviour.

These two concepts should never be mixed.