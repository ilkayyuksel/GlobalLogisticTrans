# Architecture Rules

These rules are mandatory.

They exist to keep the system maintainable as it grows.

---

# 1. Single Responsibility

Every service has one responsibility.

Frontend

↓

Presentation

Backend

↓

Business Logic

Parser

↓

PDF Extraction

IMAP

↓

Email Automation

Database

↓

Persistence

---

# 2. Separation of Concerns

Business logic must never exist outside the backend.

The frontend displays data.

The parser extracts data.

The IMAP service orchestrates emails.

---

# 3. Service Independence

Services should remain loosely coupled.

Whenever possible:

Communicate through APIs.

Avoid direct dependencies.

---

# 4. Database Ownership

Only the backend owns the database.

Other services should not manipulate business data directly.

Parser returns JSON.

IMAP forwards files.

Backend decides what happens.

---

# 5. No Circular Dependencies

Modules should never depend on each other in circles.

Dependencies must flow in one direction.

---

# 6. Reuse First

Before writing new code:

Search existing code.

Prefer reuse.

Avoid duplication.

---

# 7. Simplicity

Choose the simplest solution.

Avoid unnecessary abstractions.

Avoid premature optimization.

---

# 8. Clean Code

Readable code is more valuable than clever code.

Future maintainers should immediately understand the code.

---

# 9. Documentation

Major architectural decisions must be documented.

Keep documentation synchronized with implementation.

---

# 10. Logging

Every service should provide useful logging.

Logs should help debugging.

Logs should never expose secrets.

---

# 11. Configuration

Configuration belongs in environment variables.

Never hardcode secrets.

Never hardcode URLs.

---

# 12. Scalability

Always assume:

- More users
- More PDF layouts
- More vehicles
- More integrations
- More services

Design for growth.

---

# 13. Testing

Business logic should be testable.

Prefer dependency injection.

Avoid hidden dependencies.

---

# 14. Backwards Compatibility

New features should not break existing functionality.

Prefer extending over rewriting.

---

# 15. Hallucination Prevention

Never invent:

- APIs
- Database fields
- Library methods
- Framework capabilities

If uncertain:

State the uncertainty.

Ask for clarification.

Never guess.

---

# 16. Technical Debt

Do not knowingly introduce technical debt.

If a requested solution is poor:

Explain why.

Propose a better alternative.

---

# 17. Long-Term Vision

Every implementation should answer:

- Can this scale?
- Can this be reused?
- Is this maintainable?
- Will this still make sense in two years?

If not,

reconsider the design.