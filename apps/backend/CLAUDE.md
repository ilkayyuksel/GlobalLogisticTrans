# Backend Development Guidelines

## Purpose

This document defines the development standards for the Backend service.

The Backend is the central source of truth for all business logic.

All other services (Parser, Pricing Engine, IMAP, Frontend) communicate through the Backend.

The Backend is responsible for:

- Business logic
- Validation
- Database access
- Authorization
- Audit logging
- API contracts
- Transactions

The Backend must never become a monolith with tightly coupled code.

---

# General Principles

- Write clean, readable and maintainable code.
- Prefer clarity over cleverness.
- Keep files small and focused.
- Reuse existing components whenever possible.
- Avoid duplicate logic.
- Follow SOLID principles.
- Follow Clean Architecture where practical.
- Never overengineer solutions.

If a simpler solution exists without sacrificing maintainability, choose the simpler solution.

---

# Architecture

Always follow this flow.

Controller

↓

Service

↓

Repository

↓

Prisma

Controllers must never access Prisma directly.

Repositories must never contain business logic.

Services contain all business logic.

---

# Controllers

Controllers should only:

- receive requests
- validate input
- call services
- return responses

Controllers must never:

- execute business logic
- access Prisma
- perform calculations
- call external services directly

Controllers should remain very small.

---

# Services

Services are responsible for:

- business rules
- orchestration
- transactions
- validation that depends on business rules

Services may call multiple repositories.

Services may call other services only when appropriate.

Avoid circular dependencies.

---

# Repositories

Repositories are responsible only for database access.

Repositories must:

- use Prisma
- hide database implementation details
- never contain business logic

Repositories should only perform CRUD and query operations.

---

# DTOs

Every request must use DTOs.

Every response should use DTOs where appropriate.

Never expose Prisma models directly.

---

# Validation

Use class-validator.

Validate all incoming requests.

Business validation belongs inside Services.

Input validation belongs inside DTOs.

---

# Logging

Use structured logging.

Log important events.

Examples:

- entity created
- entity updated
- entity deleted
- import started
- import finished
- pricing calculated
- unexpected errors

Do not log sensitive information.

---

# Error Handling

Throw domain-specific exceptions.

Never return raw Prisma errors.

Never expose internal stack traces.

Return consistent API responses.

---

# Transactions

Use Prisma transactions whenever multiple database changes must succeed together.

Never perform partial updates for business operations that should be atomic.

---

# Dependency Injection

Always use NestJS Dependency Injection.

Never instantiate repositories or services manually.

---

# Prisma

All database access must go through repositories.

Never use Prisma directly inside:

- Controllers
- Guards
- Interceptors
- Validators

---

# API Design

Use REST.

Use nouns for endpoints.

Examples:

GET /drivers

GET /vehicles

POST /trips

PATCH /settings/{key}

Avoid verbs inside URLs.

---

# Pagination

Every list endpoint should support pagination.

Future endpoints should support:

- page
- pageSize
- sorting
- filtering

---

# Response Format

Always use the global response envelope.

Do not return inconsistent JSON structures.

---

# Swagger

Every endpoint must contain:

- summary
- description
- response types
- validation documentation

Swagger should remain fully synchronized with the API.

---

# Security

Never trust client input.

Always validate.

Never expose internal identifiers unless required.

Escape user input where appropriate.

Prepare the codebase for future authentication and authorization.

---

# Configuration

Never hardcode configuration values.

Use ConfigService.

Configuration belongs in environment variables or Settings.

---

# Business Rules

Never duplicate business rules inside controllers or repositories.

Business rules must remain centralized inside Services.

If a business rule already exists, reuse it.

---

# Testing

Every new module should include:

- unit tests for services
- repository tests where appropriate
- endpoint tests for controllers

Critical business logic must always be tested.

---

# Database

The database model is the single source of truth.

Never modify entities without updating:

- database_model.md
- database_schema.md

If a database change is required:

Stop.

Explain why.

Wait for approval before changing the schema.

---

# Documentation

Keep documentation synchronized.

Whenever the Backend architecture changes, update the relevant documentation.

Never let documentation become outdated.

---

# Performance

Avoid unnecessary database queries.

Prefer eager loading only when required.

Avoid N+1 query problems.

Keep transactions short.

---

# Future Compatibility

Design modules so they can evolve independently.

Avoid tight coupling.

Prefer composition over duplication.

Build reusable components.

---

# Before Writing Code

Before implementing a new feature:

1. Read the relevant documentation.
2. Verify the database model.
3. Verify the business rules.
4. Explain the implementation plan.
5. Only then begin implementation.

Never make assumptions when documentation is unclear.

Ask questions instead.

---

# Final Rule

The Backend is the core of the application.

Every implementation should prioritize:

- correctness
- maintainability
- consistency
- simplicity

over speed of implementation.