# Environment Configuration

## Purpose

This document defines all environment variables used throughout the Transport Management System.

Environment variables allow the application to be configured without modifying source code.

Sensitive information must never be committed to Git.

---

# General Principles

All configuration must be provided through environment variables.

Never hardcode:

- Passwords
- API Keys
- Secrets
- Database URLs
- JWT Secrets
- IMAP credentials

Every environment variable should be documented.

---

# Environment Files

Every application has its own environment file.

Example

apps/frontend/.env

apps/backend/.env

apps/parser/.env

apps/imap/.env

apps/pricing-engine/.env

Environment files are never committed.

Instead,

each service provides:

.env.example

---

# Shared Variables

These variables may be shared across multiple services.

NODE_ENV

Application environment.

Possible values:

development

test

production

---

LOG_LEVEL

Controls logging verbosity.

Possible values:

TRACE

DEBUG

INFO

WARN

ERROR

FATAL

---

APP_NAME

Application identifier.

---

APP_VERSION

Current application version.

---

TIMEZONE

Application timezone.

Example

Europe/Brussels

---

LANGUAGE_DEFAULT

Default application language.

Example

nl

---

# Database

Used by Backend.

DATABASE_HOST

DATABASE_PORT

DATABASE_NAME

DATABASE_USER

DATABASE_PASSWORD

DATABASE_URL

Only one connection method should be configured.

Prefer DATABASE_URL.

---

# IMAP

Used only by the IMAP service.

IMAP_HOST

IMAP_PORT

IMAP_USERNAME

IMAP_PASSWORD

IMAP_TLS

IMAP_FOLDER

Examples

INBOX

Processed

Archive

---

# Email Processing

MAIL_SUBJECT_NEW

Default

NEW:

MAIL_SUBJECT_UPDATE

Default

UPDATE:

MAIL_SUBJECT_CANCEL

Default

CANCEL:

Sender filtering may be configured.

---

# Parser

Used by Parser Service.

PARSER_DEBUG

Enable parser debugging.

PARSER_SAVE_RAW_TEXT

Store extracted text for debugging.

PARSER_LOG_LAYOUT

Log detected layout.

PARSER_TIMEOUT

Maximum parser execution time.

---

# Pricing Engine

Used only by Pricing Engine.

PRICING_ENGINE_VERSION

Current pricing engine version.

DEFAULT_FUEL_PERCENTAGE

Fallback fuel percentage.

PRICING_DEBUG

Enable calculation debugging.

---

# Backend

BACKEND_PORT

JWT_SECRET

CORS_ALLOWED_ORIGINS

API_PREFIX

DEFAULT_LANGUAGE

---

# Frontend

VITE_API_URL

Default backend URL.

VITE_APP_NAME

Displayed application name.

VITE_DEFAULT_LANGUAGE

Initial language.

---

# Authentication

Used by Backend.

AUTH_PROVIDER

Possible values:

AUTH0

LOCAL

AUTH0_DOMAIN

AUTH0_CLIENT_ID

AUTH0_CLIENT_SECRET

AUTH0_AUDIENCE

---

# File Storage

UPLOAD_DIRECTORY

Temporary upload location.

PDF_STORAGE_DIRECTORY

Location where processed PDFs are stored.

EXPORT_DIRECTORY

Location where generated Excel files are stored.

Directories should be configurable.

---

# Excel Export

EXCEL_TEMPLATE_DIRECTORY

Optional directory containing Excel templates.

---

# Feature Flags

Features may be enabled or disabled.

Examples

ENABLE_IMAP

ENABLE_PRICING_ENGINE

ENABLE_EXPORT

ENABLE_DARK_MODE

ENABLE_DEBUG_PANEL

Feature flags allow gradual rollout.

---

# Docker

Environment variables should be injected through Docker Compose.

Avoid duplicating configuration.

Docker should remain the single source of runtime configuration.

---

# Validation

Every service must validate its required environment variables during startup.

Missing required configuration should prevent the service from starting.

Validation errors should clearly describe:

Missing variable

Invalid value

Expected format

---

# Security

Never expose environment variables to the frontend unless explicitly intended.

Only variables prefixed for frontend usage should be accessible in the browser.

Secrets should only exist on the server.

---

# Future Configuration

New services should introduce their own environment variables.

Avoid reusing variables with different meanings.

Environment variables should remain backwards compatible whenever possible.

---

# Responsibilities

Each microservice is responsible for:

Loading

Validating

Using

its own environment variables.

No microservice should depend on another service's environment configuration.