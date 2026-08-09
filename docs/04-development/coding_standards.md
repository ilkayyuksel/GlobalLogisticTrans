# Coding Standards

## Purpose

This document defines the coding standards used throughout the entire Transport Management System.

These rules apply to every microservice.

The goal is to create code that remains readable, maintainable and scalable.

---

# General Philosophy

Always write code for humans first.

Readable code is always preferred over clever code.

Another developer should understand the code without additional explanation.

---

# Simplicity

Always choose the simplest solution that correctly solves the problem.

Avoid unnecessary abstractions.

Avoid unnecessary design patterns.

Avoid premature optimization.

---

# SOLID

Follow SOLID principles whenever appropriate.

Single Responsibility is mandatory.

---

# DRY

Avoid duplicated code.

If logic is reused more than once,

consider extracting it.

---

# KISS

Keep the implementation simple.

Do not introduce complexity without a clear benefit.

---

# File Size

Preferred limits

React Component

< 200 lines

Service

< 300 lines

Controller

< 150 lines

Utility

< 150 lines

Parser Extractor

< 150 lines

Split files before they become difficult to understand.

---

# Function Size

Functions should perform one responsibility.

Target

10 - 40 lines.

Avoid extremely long functions.

Extract helper functions when needed.

---

# Naming

Use descriptive names.

Bad

data

list

temp

Good

tripRepository

vehicleAssignment

parsedContainer

pricingCalculator

Avoid abbreviations.

---

# Comments

Do not explain WHAT.

Explain WHY.

Bad

// increment counter

Good

// Prevent duplicate email processing after IMAP reconnect

---

# Types

Always use TypeScript types.

Avoid any.

Prefer interfaces where appropriate.

Strong typing is mandatory.

---

# Constants

Avoid magic numbers.

Extract constants.

Bad

if(speed > 65)

Good

if(speed > MAX_ALLOWED_SPEED)

---

# Error Handling

Never swallow exceptions.

Never ignore errors.

Always return meaningful errors.

Unexpected errors must be logged.

---

# Logging

Logging should help debugging.

Log:

Authentication

Parser

IMAP

Imports

Exports

Database failures

External APIs

Avoid excessive logging.

Never log:

Passwords

Secrets

Tokens

Sensitive personal information

---

# Validation

Validate all external input.

Never trust:

HTTP Requests

PDF data

Environment variables

User input

Third-party APIs

---

# Environment Variables

Never hardcode:

URLs

Passwords

API Keys

Tokens

Database credentials

Always use environment variables.

---

# Reusability

Before creating:

Component

Service

Repository

Utility

Hook

Validator

Search whether one already exists.

Reuse before creating.

---

# Testing

Business logic should be testable.

Avoid hidden dependencies.

Prefer dependency injection.

---

# Imports

Keep imports organized.

Order:

External packages

Shared packages

Internal modules

Relative imports

Avoid circular imports.

---

# Architecture

Respect module boundaries.

Never bypass layers.

Controllers never access databases directly.

Parser never performs business logic.

Frontend never performs pricing calculations.

---

# Performance

Optimize only after measuring.

Readable code comes first.

---

# Refactoring

Whenever duplicated or overly complex code is encountered,

propose a refactor.

Do not continue building on poor architecture.

---

# Hallucination Prevention

Never invent:

API endpoints

Framework methods

Library features

Database fields

When uncertain,

state the uncertainty.

Ask for clarification.

Never guess.

---

# Documentation

Whenever implementation changes:

Update documentation.

Documentation is part of the implementation.

---

# Final Rule

Write code that you would be proud to maintain five years from now.