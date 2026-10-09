# System Architecture

# Overview

The Transport Management System (TMS) is designed as a modular, service-oriented application.

Every major responsibility is isolated into its own service.

Each service owns a single responsibility and communicates with other services through clearly defined interfaces.

The objective is to keep the application maintainable, testable and scalable as new features are introduced.

---

# High Level Architecture

                    ┌──────────────┐
                    │     IMAP     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    Parser    │
                    └──────┬───────┘
                           │ ParsedTrip
                           ▼
                    ┌──────────────┐
                    │   Backend    │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┬────────────────┐
          │                │                │                │
          ▼                ▼                ▼                ▼
    PostgreSQL      Pricing Engine     Auth0          WhatsApp Service
          ▲                │                                 │
          └────────────────┘                                 ▼
                           │                            WhatsApp
                           ▼
                    ┌──────────────┐
                    │  Frontend    │
                    └──────────────┘

Documents flow INWARD from the mailbox and OUTWARD to drivers. The WhatsApp
service is the only outbound leg, and the only one talking to a system this
business does not control.

---

# Core Principles

The architecture follows these principles:

- Single Responsibility
- Separation of Concerns
- Loose Coupling
- High Cohesion
- Clean Architecture
- Explicit Boundaries
- Reusability
- Scalability
- Testability

Every module should remain independently understandable.

---

# Frontend

## Purpose

The frontend provides the user interface.

Its responsibility is limited to:

- displaying information
- collecting user input
- communicating with the backend
- rendering dashboards
- rendering planning views
- rendering forms
- displaying reports

The frontend should never implement business rules.

The frontend never accesses the database directly.

The frontend never communicates directly with infrastructure services.

All communication goes through the backend.

## Navigation: view state and scroll restoration

Leaving a page and coming Back returns to the same page as it was left: the
same list and the same scroll position. One mechanism serves every route; no
page carries scroll code of its own.

**View state lives in the address.** List pages keep their filters, search,
date, view, sort and page in query parameters through `useUrlState`
(`hooks/use-url-state.ts`, codecs in `lib/navigation/url-state-codecs.ts`):
Ritten, Onderhoud, Voertuigen, Chauffeurs, Imports and Routeprijzen. A change
REPLACES the current history entry (never a push) and nothing is written while
a page mounts; a default value is no parameter. Back, Forward and a reload then
restore it as the browser restores any address. Lists reset to page 1 when a
filter changes, but not on mount (`useResetOnChange`).

**Scroll positions belong to history entries.** `ScrollRestoration`, rendered
once in the root layout, drives `ScrollTracker` (`lib/navigation/`):

| Event | Effect |
|---|---|
| the user scrolls | the position is recorded for the entry on screen |
| Back / Forward | the entry returned to gets its position back |
| reload | the same, as the browser itself would |
| any other navigation | nothing: a new page starts at the top (the router) |
| refetch, state update, delete, inline edit | nothing |

- **Entry identity:** a key in `history.state`, added through the native
  History API the App Router integrates with. Router-written states lose it;
  the same entry is re-stamped with its own key, a new one gets a new key. The
  router's own fields are always kept, so Back never makes it reload a page.
- **Storage:** in memory, mirrored to `sessionStorage` (`tms.navigation.entries`)
  on `pagehide`; the 50 most recent entries are kept.
- **Async content:** `useAsync` reports each load to `lib/navigation/page-loads`
  until the render showing its result is committed. A restore applies the
  position as soon as the content can hold it, re-applies it as content grows
  (ResizeObserver), and applies it a last time when no load is pending — clamped
  to the nearest reachable point if the list got shorter. User input ends it.
- **Scrollers:** the window, plus containers that declare
  `data-scroll-restoration-id`: each Ritten day table (sideways) and the Agenda
  week grid. Other `overflow` boxes (dialogs, menus) are not remembered.
- `history.scrollRestoration` is `manual`: the browser's own restore fires
  before client data loads and would cut the position short.

**Back links.** "Terug naar …" links are `BackLink`: when the page was opened
from that list it calls `history.back()` — the same entry as the browser's Back
button — and otherwise it is an ordinary link.

---

# Backend

## Purpose

The backend is the heart of the application.

It owns:

- business rules
- workflow orchestration
- validation
- permissions
- calculations
- planning logic
- exports
- integrations

The backend is the only component that decides how the system behaves.

Every external service communicates through the backend.

---

# PDF Parser

## Purpose

The parser converts transport order PDFs into structured data.

Responsibilities:

- detect PDF layout
- extract fields
- validate extracted values
- return structured JSON

The parser never:

- writes to the database
- creates trips
- updates trips
- performs calculations
- makes business decisions

It simply extracts information.

---

# Pricing Engine

The Pricing Engine is an independent microservice.

Responsibilities:

- Calculate trip prices
- Execute pricing rules
- Apply fuel calculations
- Apply waiting time calculations
- Apply custom properties
- Calculate totals
- Return a complete pricing breakdown

The Pricing Engine never:

- stores trips
- modifies trips
- parses PDFs
- communicates with IMAP
- renders UI

---

# Email Service

## Purpose

The email service monitors the configured mailbox.

Responsibilities:

- connect to IMAP
- monitor incoming emails
- validate sender
- validate subject
- download attachments
- detect duplicates
- send PDFs to the parser

The email service never:

- parses PDFs
- creates trips
- modifies business data

Its only responsibility is orchestration.

---

# WhatsApp Service

## Purpose

The WhatsApp service delivers a Trip's transport order to its driver.

It is the mirror image of the email service: that one carries documents in, this
one carries them out. It runs as its own container because it holds a long-lived
WhatsApp Web connection and a logged-in session, neither of which belongs in an
API process that is replaced on every deploy.

Responsibilities:

- hold the WhatsApp connection
- persist the session across restarts
- expose the pairing QR to an authenticated caller
- report whether it can currently deliver
- relay one PDF to one phone number

The WhatsApp service never:

- reads the database
- reads the filesystem
- decides which driver or which document
- modifies business data

It receives bytes and a number that the Backend derived from a Trip. Every
domain decision — the effective driver, the latest applicable transport
document, whether the Trip may be sent for at all — is made in the Backend,
against the database, before this service is called.

## The unofficial transport

The connection is driven by Baileys, an open-source WhatsApp Web client. This is
NOT an integration WhatsApp supports, and it can result in the number being
blocked. It is a deliberate first step.

The Backend therefore depends on an interface, `WhatsAppSender`, and never on
Baileys. Baileys is imported in exactly one file of one service. Replacing the
unofficial transport with the official WhatsApp Cloud API is a new
implementation of that interface plus a different delivery service — no change
to Trips, documents, drivers or pricing.

## Sending changes nothing

A send is an outward operational action. It performs no write of any kind: not
the Trip's status, its driver, its vehicle, its planning date, its document
history, its pricing or its waiting time. A failed send therefore cannot corrupt
a Trip, because a successful one does not touch it either.

Nothing sends automatically. An arriving NEW or UPDATE, a Trip being created, a
driver or vehicle changing — none of these deliver anything. An operator presses
a button, because a document reaching a driver is a commitment and a person
should make it.

## Session state

The pairing keys are files on a Docker volume, and those files ARE the
logged-in account: anyone holding them can send as the company. They are never
logged, never returned by an endpoint, never committed, and the container that
holds them publishes no port and sits on the internal network only.

A restart reuses the session. Only `docker compose down -v`, or WhatsApp logging
the device out, requires scanning a QR code again.

## Staying connected

A WhatsApp Web socket closes often — a dropped network, a server restart, a
timeout, a stream error — and the stored session stays valid through all of it.
Treating any of those as a logout is what makes somebody scan a QR code every
morning, so the service does not:

- every close is classified by ONE decision function against Baileys' own
  disconnect code, never by the fact that the socket closed;
- the default for an unrecognised code is to RECONNECT, because guessing
  "logged out" costs a person a trip to their phone while guessing the other
  way costs one more attempt;
- reconnects back off 1s, 2s, 5s, 10s, 30s and reset on success;
- exactly three codes clear the session — the phone unlinking the device, a
  session that no longer decrypts, and a multi-device mismatch. Each is WhatsApp
  stating the credentials are dead;
- a blocked account is reported as an error rather than as a pairing problem,
  because re-pairing would not help either.

Only ONE socket is ever live. Each is stamped with a generation number and
events from a superseded socket are ignored — without that, a closing socket's
late events start reconnects of their own, two sockets end up fighting over one
session, and WhatsApp resolves the fight by logging the device out.

Credential writes are serialised onto a single chain and awaited during
shutdown. A fire-and-forget save can interleave with the next one and leave a
half-written file, or be lost entirely to process exit — either way the next
start finds credentials it cannot load.

A QR code is offered only while the status is PAIRING_REQUIRED. A transient
disconnect reports DISCONNECTED and returns no QR at all.

## Reachable out, not reachable in

The service needs to open an OUTBOUND websocket to WhatsApp, and it must remain
unreachable from the internet. Those are two different properties, and
conflating them broke it: placed on the `internal: true` network alone it had no
route out at all, and reported

    DISCONNECTED — the connection dropped (408); retrying in 30s

forever, with an empty session directory and no QR ever produced. The account
could not be paired at all.

It now sits on two networks. `internal` is how the backend reaches it; `egress`
is how it reaches WhatsApp. It still publishes no port and carries no Traefik
label, so nothing outside Docker can address it.

## Pairing

Because the service is unreachable from outside, pairing goes through TRANO:

    Browser → /admin/whatsapp
            → backend GET /api/v1/whatsapp/pairing   (authenticated session)
            → whatsapp:3200 /pairing                 (internal network)

The backend relays the status and the code and nothing else — the response is
rebuilt field by field rather than forwarded, so session keys, the storage path
and the account's own number cannot leak through a field added later. The
alternative, publishing port 3200, would put a code that links a phone to the
company's WhatsApp account on the open internet behind nothing at all.

---

# Authentication

Authentication is handled by an external identity provider.

The application itself does not manage passwords.

Responsibilities:

- user authentication
- identity verification
- access tokens

Authorization decisions remain inside the backend.

## Session expiry, and what says a user must sign in again

Two lifetimes are involved and they must not be confused.

The ACCESS TOKEN is short-lived by design. When it runs out, the Auth0 SDK's
`/auth/access-token` endpoint mints a new one from the refresh token, and the
operator notices nothing. This is ordinary and must never cost anyone their
place in the work.

The SESSION is the encrypted cookie that says the browser may ask for a token at
all. When it has expired or been revoked, no renewal is possible and the
operator has to sign in again.

There is exactly ONE signal for "sign in again", and it is a 401:

- `/auth/access-token` answers 401 both when the session is missing and when the
  refresh fails (`SESSION_EXPIRED`, `FAILED_TO_REFRESH_TOKEN`);
- the backend answers 401 only from `AccessTokenGuard`, which is the only place
  in the API that raises one. No domain code returns 401, and the API uses no
  403 at all.

So a 401 — and nothing else — means re-authenticate. A 400, 404, 409, 422, 429,
500, a timeout or a dropped connection are ordinary failures that pages handle
themselves; treating any of them as an expired session would throw work away.

A backend 401 is not taken at face value either: the client renews the token
once and repeats the call, because the usual cause is a token that aged out
while a tab was asleep. Only when no new token can be had is the session
actually gone.

When it is gone, the browser goes to `/auth?returnTo=<page>` — the same entry
page, with the same parameter, that the middleware redirects to when it turns an
unauthenticated request away — and the operator returns to the page they were on
after signing in. It happens once however many requests failed together, and the
client stops sending anything further. See `lib/auth/session-expiry.ts`.

---

# Database

The database is the system of record.

It stores:

- trips
- trip groups
- planning
- vehicles
- trailers
- drivers
- maintenance
- settings
- pricing data
- exports
- documents
- audit history

No service except the backend owns business data.

---

# File Storage

Transport documents are stored separately from structured data.

Examples:

- PDFs
- exports
- generated files
- uploaded documents

The database only stores references to these files.

---

# Communication Flow

The system follows a predictable workflow.

Email arrives

↓

Email Service

↓

PDF Parser

↓

Structured JSON

↓

Backend

↓

Business Rules

↓

Database

↓

Frontend

At every step the responsibility is clearly separated.

---

# Business Logic Flow

Business logic always starts inside the backend.

Example:

Administrator edits trip

↓

Backend validates request

↓

Business rules executed

↓

Database updated

↓

Audit created

↓

Response returned

No business logic may bypass the backend.

---

# Module Independence

Every module should remain independently replaceable.

For example:

The parser may be rewritten without changing the frontend.

Authentication may change without changing planning.

The frontend may change without changing the parser.

This reduces coupling.

---

# Scalability

The architecture should support future modules without major redesign.

Potential future modules include:

- Mobile application
- Driver portal
- Customer portal
- Route optimization
- GPS integration
- Fuel administration
- Invoice generation
- AI document classification
- OCR
- Notification service
- Reporting engine

Adding these modules should not require changing the existing architecture.

---

# Integration Strategy

External systems should remain isolated.

Examples:

- Email
- WhatsApp
- ERP
- Accounting software
- GPS providers

These integrations communicate with the backend through dedicated integration layers.

Business rules remain inside the backend.

---

# Error Handling

Failures should remain isolated.

A parser failure must not stop the email service.

A frontend failure must not affect the database.

An export failure must not affect planning.

Modules should fail independently whenever possible.

---

# Logging

Every service should generate useful logs.

Logs should allow reconstructing the complete processing flow.

Examples:

Email received

↓

PDF downloaded

↓

Parser executed

↓

Trip created

↓

Pricing calculated

↓

Export generated

This greatly simplifies debugging.

---

# Audit Trail

Important business actions should be traceable.

Examples:

Trip created

Trip updated

Planning changed

Driver assigned

Pricing recalculated

Trip cancelled

Manual overrides

Historical information should never be lost.

---

# Configuration

Configuration belongs outside the application.

Examples:

- mailbox
- storage locations
- authentication
- API endpoints
- pricing configuration
- environment settings

Configuration should never be hardcoded.

---

# Security

The system follows the principle of least privilege.

Each component should only access the resources it requires.

Sensitive information should never be exposed.

All external input should be validated.

---

# Maintainability

The project is expected to grow continuously.

Architecture decisions should prioritize long-term maintainability over short-term implementation speed.

Avoid technical debt.

Refactor when necessary.

Keep modules focused.

Prefer extending the architecture over rewriting it.

---

# Guiding Principle

Every implementation should answer the following questions:

Can this be reused?

Can this be tested?

Can this be understood in six months?

Can another developer work on it without additional explanation?

Can this scale as the project grows?

If the answer is "no", reconsider the design before implementation.