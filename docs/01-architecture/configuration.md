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

Identity belongs to **Auth0**. TRAXO stores no user, no session, no password and
no role: the database holds business data only, and there is deliberately no
users, sessions or roles table anywhere in the schema.

## How it fits together

    browser
      -> Next.js  : Auth0 Universal Login, session in an encrypted cookie
      -> NestJS   : verifies the Auth0 access token on every request
      -> Postgres : business data, never credentials

The frontend never handles a credential. `/auth` is a branded entry page whose
only action is a link to Auth0 Universal Login; the email and password are
entered on Auth0's own domain. There is no registration and no password-reset
screen, because V1 has exactly one administrator, created in the Auth0
dashboard.

## What protects what

**Frontend** — `src/middleware.ts` runs before every request that is not a
static asset. Without a session the visitor is sent to `/auth`, with the page
they wanted carried in `returnTo`. This decides what a browser is SHOWN.

**Backend** — a global `AccessTokenGuard` (`src/auth/`) verifies the token's
signature against the tenant's JWKS, and its issuer, audience and expiry. This
is what guards the DATA, and it would refuse an unauthenticated request whatever
the frontend did. Exactly two routes are `@Public()`: the health probe and the
OpenAPI document.

The single administrator is enforced, if at all, by `AUTH0_ALLOWED_SUBJECTS` —
an allowlist of Auth0 subjects or email addresses. Empty means "any user this
tenant authenticates", which is correct while the tenant holds one user. It is
not a role system, and V1 has none.

## Settings

Names only; values live in `.env`, which is not committed. See `.env.example`
for the full annotated list.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `AUTH0_DOMAIN` | both | The tenant. The backend derives issuer and JWKS from it. |
| `AUTH0_CLIENT_ID` | frontend | The Regular Web Application. |
| `AUTH0_CLIENT_SECRET` | frontend | Server-side only. Never `NEXT_PUBLIC_*`. |
| `AUTH0_SECRET` | frontend | Encrypts the session cookie. |
| `APP_BASE_URL` | frontend | Where the app is reached; builds callback and logout URLs. Called `AUTH0_BASE_URL` before SDK v4. |
| `AUTH0_AUDIENCE` | both | The API identifier. Without it Auth0 issues an opaque token the backend cannot verify. |
| `ENABLE_AUTH` | backend | Defaults to true. False disables ALL API protection and is a local development state only. |
| `AUTH0_ALLOWED_SUBJECTS` | backend | Optional allowlist of subjects or emails. Identifiers, never credentials. |

A password never appears in any of them.

## Auth0 application settings

For a deployment at `https://<TRAXO-DOMAIN>`:

- Allowed Callback URLs: `https://<TRAXO-DOMAIN>/auth/callback`
- Allowed Logout URLs: `https://<TRAXO-DOMAIN>/auth`
- Allowed Web Origins: `https://<TRAXO-DOMAIN>`

Locally the same three with `http://localhost:3100`. An Auth0 **API** must also
exist, whose identifier is `AUTH0_AUDIENCE`.

## Session timeout

Auth0's, not ours. It is configured in the tenant, and the SDK refreshes the
session while the operator is working. TRAXO stores nothing to expire.

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