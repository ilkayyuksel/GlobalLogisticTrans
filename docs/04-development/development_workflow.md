# Development Workflow

## Purpose

This document defines the development workflow for the Transport Management System.

Every new feature should follow this workflow.

Do not skip steps.

---

# General Principle

Think before coding.

Understand before implementing.

Design before building.

---

# Step 1

Understand the request.

Identify:

Business goal

Affected modules

Dependencies

Potential risks

---

# Step 2

Read documentation.

Always check:

Business Rules

Feature List

Architecture Rules

Database

Relevant module documentation

Never implement features based on assumptions.

---

# Step 3

Review existing code.

Before creating:

Components

Services

Utilities

Repositories

Hooks

Validators

Search whether one already exists.

Prefer extending existing code.

---

# Step 4

Plan the implementation.

Identify:

Required backend changes

Required frontend changes

Database impact

API impact

Testing impact

Documentation impact

---

# Step 5

Implement backend first.

Business logic belongs in the backend.

Complete backend functionality before creating UI.

---

# Step 6

Implement frontend.

The frontend consumes backend functionality.

Avoid implementing temporary logic inside the UI.

---

# Step 7

Testing

Verify:

Happy path

Validation

Error handling

Edge cases

Regression

---

# Step 8

Documentation

Whenever functionality changes,

update:

Business Rules

Feature List

Database

API

Architecture

Parser Rules

Pricing Rules

when applicable.

---

# Step 9

Refactor

After implementation,

look for:

Duplicate code

Large files

Large functions

Poor naming

Missing abstractions

Improve before considering the feature complete.

---

# Step 10

Final Review

Ask yourself:

Does this follow the architecture?

Can existing code be reused?

Is this scalable?

Is this readable?

Is this testable?

Would another developer understand this?

If not,

improve it.

---

# Pull Request Checklist

Every feature should satisfy:

Backend completed

Frontend completed

Types updated

Validation added

Logging added

Error handling added

Documentation updated

No duplicated code

No unnecessary complexity

No hardcoded values

---

# Claude Workflow

Whenever implementing a feature:

1.

Understand the request.

↓

2.

Read relevant documentation.

↓

3.

Review existing implementation.

↓

4.

Create an implementation plan.

↓

5.

Implement backend.

↓

6.

Implement frontend.

↓

7.

Test.

↓

8.

Refactor.

↓

9.

Update documentation.

↓

10.

Review.

---

# Hallucination Prevention

Never assume undocumented behaviour.

Never invent APIs.

Never invent database fields.

Never invent parser behaviour.

If documentation is missing,

ask for clarification.

---

# Final Rule

Correct architecture is more important than implementation speed.

Never sacrifice long-term maintainability for short-term convenience.