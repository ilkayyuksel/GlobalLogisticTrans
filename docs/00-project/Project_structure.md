# Project Structure

## Purpose

This document defines the folder structure of the Transport Management System.

Every file should have one logical location.

Do not create new folders unless they clearly improve the architecture.

The goal is to keep the project organized, scalable and easy to navigate.

---

# Repository Structure

```
transport-management-system/

apps/
packages/
database/
docker/
docs/
scripts/
storage/

README.md
CLAUDE.md
docker-compose.yml
.env.example
```

---

# apps/

Contains all independently deployable applications.

Each application should have its own responsibilities.

Applications should remain loosely coupled.

```
apps/

frontend/

backend/

parser/

imap/
```

---

# frontend/

Contains the entire web application.

Example structure

```
frontend/

app/

components/

features/

hooks/

lib/

services/

types/

styles/

public/

tests/
```

---

# frontend/app/

Contains pages.

Pages should only compose components.

Business logic does not belong here.

---

# frontend/components/

Contains reusable UI components.

Examples

```
Button

Input

Modal

Table

Card

Sidebar

Header

Badge
```

Components should remain generic.

---

# frontend/features/

Contains feature-specific components.

Example

```
features/

trips/

maintenance/

calendar/

dashboard/

settings/
```

Each feature contains only code related to that feature.

---

# frontend/hooks/

Contains reusable React hooks.

Examples

```
useTrips()

useTheme()

useLanguage()

useExport()

useCalendar()
```

Avoid duplicate hooks.

---

# frontend/services/

Contains frontend API clients.

Never call fetch() directly inside pages.

Always use services.

Example

```
TripService

VehicleService

MaintenanceService

ExportService
```

---

# frontend/lib/

Contains utilities.

Examples

```
date.ts

currency.ts

validation.ts

constants.ts
```

Utilities should never contain business logic.

---

# backend/

Contains all business logic.

Suggested structure

```
backend/

src/

modules/

common/

config/

prisma/

tests/
```

---

# backend/modules/

Each module owns one business domain.

Example

```
Trips

Vehicles

Drivers

Maintenance

Calendar

Notes

Pricing

Authentication

Settings
```

Each module contains

```
controller

service

repository

dto

entities

validators

tests
```

---

# backend/common/

Contains shared backend functionality.

Examples

```
Exceptions

Guards

Decorators

Filters

Interceptors

Middleware

Logger

Utils
```

---

# parser/

Contains PDF parsing.

Suggested structure

```
parser/

layouts/

extractors/

validators/

models/

tests/
```

---

# parser/layouts/

One parser per supported layout.

Example

```
Eucon

MSC

Combination

FutureParser
```

Never create one huge parser file.

---

# parser/extractors/

Each extractor extracts one responsibility.

Examples

```
ContainerExtractor

BookingExtractor

TerminalExtractor

AddressExtractor

DateExtractor
```

Small focused extractors.

---

# parser/models/

Contains parser models.

Example

```
ParsedTrip

ParsedAddress

ParsedContainer
```

---

# parser/tests/

Contains parser regression tests.

Every new PDF layout should receive tests.

---

# imap/

Contains email automation.

Suggested structure

```
imap/

services/

clients/

validators/

jobs/

tests/
```

---

# imap/services/

Examples

```
EmailService

AttachmentService

DuplicateDetectionService
```

---

# packages/

Contains shared packages.

Never duplicate shared logic.

---

# packages/types/

Shared TypeScript types.

Examples

```
Trip

Vehicle

Driver

Pricing

Maintenance
```

Both frontend and backend should use the same types whenever possible.

---

# packages/shared/

Contains shared utilities.

Examples

```
Constants

Enums

Helpers

Validation
```

---

# packages/ui/

Future reusable UI library.

Contains shared components if needed.

---

# packages/config/

Shared configuration.

Examples

```
ESLint

Prettier

TypeScript

Tailwind
```

---

# database/

Contains database resources.

Examples

```
ERD

SQL

Seeds

Backups

Scripts
```

---

# docker/

Contains Docker configuration.

Example

```
frontend

backend

parser

imap

postgres

nginx
```

---

# docs/

Contains project documentation.

Examples

```
README

Business Rules

Architecture Rules

UI Guidelines

Design Tokens

Component Guidelines

Database

API

Parser Rules

Pricing Rules

Roadmap

Decision Log
```

Documentation should always remain up-to-date.

---

# scripts/

Automation scripts.

Examples

```
Backup

Import

Reset

Development
```

---

# storage/

Application storage.

```
storage/

pdf/

exports/

documents/

temp/

logs/
```

These folders are not committed to Git.

---

# File Naming

React Components

PascalCase

```
TripTable.tsx
```

Hooks

camelCase

```
useTrips.ts
```

Utilities

camelCase

```
formatDate.ts
```

Types

PascalCase

```
Trip.ts
```

Tests

```
TripTable.test.tsx
```

---

# Import Order

Always import in this order

1 External Libraries

2 Shared Packages

3 Services

4 Hooks

5 Components

6 Utilities

7 Types

8 Relative Imports

Keep imports organized.

---

# File Size

Preferred maximum

React Components

200 lines

Pages

250 lines

Services

300 lines

Repositories

250 lines

Utilities

150 lines

Parser Extractors

150 lines

Split files before they become difficult to navigate.

---

# Folder Rules

One responsibility per folder.

Avoid dumping unrelated files together.

Prefer deeper organization over huge folders.

---

# Reusability

Before creating:

Component

Service

Hook

Utility

Validator

DTO

Repository

Always search whether one already exists.

Avoid duplicate implementations.

---

# Documentation

Whenever a new module is introduced

Update:

Architecture

Database

API

Business Rules

Feature List

if applicable.

Documentation is considered part of the implementation.

---

# Final Principle

The repository should remain understandable to a new developer within 30 minutes.

If a new developer cannot quickly understand where code belongs,

the structure should be improved.

Organization is a feature.