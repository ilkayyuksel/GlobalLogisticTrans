# Backend Guidelines

## Purpose

The backend is the heart of the application.

All business logic belongs here.

The backend is responsible for making decisions.

---

# Technology

- NestJS
- TypeScript
- Prisma
- PostgreSQL

---

# Architecture

Always follow:

Controller

↓

Service

↓

Repository

↓

Database

Never bypass layers.

---

# Controllers

Controllers should:

- Validate requests
- Call services
- Return responses

Controllers should NOT:

- Access Prisma directly
- Implement business logic

---

# Services

Services contain business logic.

Services should remain focused.

One service = one responsibility.

---

# Repository

Repositories only access the database.

Repositories do not contain business logic.

---

# DTOs

Always validate incoming requests.

Use DTOs.

Never expose internal entities directly.

---

# Transactions

Whenever multiple database updates belong together:

Use transactions.

---

# Logging

Use structured logging.

Log:

- authentication
- imports
- parser results
- failures
- external API calls
- background jobs

Do not spam logs.

---

# Errors

Return structured errors.

Never swallow exceptions.

Never ignore failures.

---

# Performance

Avoid unnecessary queries.

Prevent N+1 problems.

Reuse services.

---

# Security

Validate authentication.

Validate authorization.

Never trust incoming data.

---

# Database

Never hardcode IDs.

Avoid duplicated data.

Keep migrations clean.

---

# Testing

Business logic should be testable.

Prefer dependency injection.

---

# Goal

The backend should remain the single source of truth.