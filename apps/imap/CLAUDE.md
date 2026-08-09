# IMAP Service Guidelines

## Purpose

Monitor email inboxes.

Download transport PDFs.

Forward PDFs to the parser.

Nothing more.

---

# Responsibilities

Connect to IMAP.

Monitor mailbox.

Validate sender.

Validate subject.

Download attachments.

Detect duplicates.

Forward PDFs.

Store metadata.

---

# Do NOT

Do not parse PDFs.

Do not implement business logic.

Do not calculate prices.

Do not manipulate trips.

---

# Reliability

The service must be idempotent.

A single email should never be processed twice.

Handle reconnects gracefully.

---

# Duplicate Detection

Prevent duplicate downloads.

Prevent duplicate parser executions.

---

# Logging

Log:

- connection
- reconnection
- new email
- sender
- attachment
- parser request
- failures

---

# Error Handling

Retry temporary failures.

Log permanent failures.

Never silently ignore errors.

---

# Security

Never log passwords.

Never expose credentials.

Always validate sender.

---

# Goal

The IMAP service should simply orchestrate the workflow.