# Database Schema

## Purpose

This document defines the **PostgreSQL implementation** of the conceptual model described in `database_model.md`.

It is the bridge between the conceptual model and the Prisma schema / SQL migrations.

For every table it defines:

- Purpose
- Columns
- Types
- Nullability
- Defaults
- Constraints
- Foreign Keys
- Indexes

This document contains **no SQL and no Prisma code**.

Source documents:

- `database_model.md` (primary)
- `businessRules.md`
- `pdfParserRules.md`
- `pricing_rules.md`

---

# 1. Conventions

## Naming

- All table names are `snake_case`, singular.
- All column names are `snake_case`.
- Foreign key columns are named `<referenced_table>_id`.
- Columns carrying a unit include the unit in the name (`waiting_time_minutes`, `distance_km`, `duration_ms`, `file_size_bytes`).

## Primary Keys

Every table has:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` |

`gen_random_uuid()` is provided by the built-in `pgcrypto` / PostgreSQL 13+ core functions.

## Audit Columns

Every table has:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `created_at` | `TIMESTAMPTZ` | NO | `now()` |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` |

`updated_at` is maintained by the application layer (Prisma `@updatedAt`).

For append-only tables (`trip_history`, `parser_run`) these columns exist for schema consistency only; immutability is enforced by the Backend.

## Data Types

| Concept | Type |
|---|---|
| Timestamp | `TIMESTAMPTZ` |
| Date only | `DATE` |
| Time of day only | `TIME` |
| Money | `NUMERIC(12,2)` |
| Currency | `CHAR(3)`, default `'EUR'` |
| Free text | `TEXT` |
| Structured values | `JSONB` |

## JSONB Usage

Three columns use `JSONB`: `parser_run.metadata`, `trip.parser_metadata`, and `trip_history.previous_value` / `new_value`.

The parser columns exist for **diagnostics, debugging, transparency and parser comparison only**.

Rules:

- The application must never make a business decision based on a value inside a `JSONB` column.
- No value inside `JSONB` may drive business logic, filtering, reporting or pricing.
- If such a value becomes business-relevant, it must be **promoted to a dedicated relational column**. `JSONB` is not an escape hatch for schema design.
- The internal key structure is owned by the application, not by the database. This is deliberate: new PDF layouts must not require a migration.
- **No indexes initially.** A GIN index is added only when profiling demonstrates a real need to query JSON content — the write cost is otherwise paid for nothing.

## Ownership of Parser Data

| Grain | Content | Column |
|---|---|---|
| Per parser execution | Detected layout, confidence, detected sections, warnings, execution statistics, debug information | `parser_run.metadata` |
| Per parsed Trip | Raw terminal, raw destination, raw address, raw booking number, raw container number, raw date, matched labels | `trip.parser_metadata` |
| Per document | Storage path, file hash, filename, MIME type, file size | `pdf_document` (the PDF binary is never stored in PostgreSQL) |

`ParserRun` owns technical parser diagnostics. `Trip` owns only the parser output relevant to that specific Trip. This keeps the business model independent of parser implementation details.

If future requirements introduce multiple parser implementations, OCR providers, AI extraction engines or parser benchmarking, this design can evolve into a dedicated `parser_extraction` table without touching the business model.

## Soft Delete

- `trip` uses `status = 'DELETED'`.
- Configurable entities (`driver`, `vehicle`, `trailer`, `custom_property`, `route_pricing`, `pricing_component`, `route_cost`, `setting`) use `is_active BOOLEAN NOT NULL DEFAULT TRUE`.
- `vacation` has **no** soft delete flag.

## Active-Scoped Uniqueness

Uniqueness on configurable entities is enforced with **partial unique indexes filtered on `is_active = TRUE`**, so a business identifier may be reused after deactivation.

## Enum Strategy

Native PostgreSQL enum types are used for stable business lifecycles. `TEXT` is used for concepts the model declares extensible.

### Native enum types

| Enum type | Values | Used by |
|---|---|---|
| `trip_status` | `OPEN`, `CLOSED`, `CANCELLED`, `DELETED` | `trip.status` |
| `maintenance_status` | `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | `maintenance.status` |
| `import_type` | `NEW`, `UPDATE`, `CANCEL` | `imported_email.import_type` |
| `parser_result` | `SUCCESS`, `WARNING`, `FAILED`, `PARTIAL_SUCCESS` | `parser_run.result` |
| `pricing_calculation_status` | `CALCULATED`, `FAILED`, `MANUAL_OVERRIDE` | `trip_pricing.calculation_status` |
| `email_processing_status` | `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`, `IGNORED` | `imported_email.processing_status` |
| `import_source` | `EMAIL`, `MANUAL_UPLOAD`, `API` | `pdf_document.import_source` |
| `setting_value_type` | `STRING`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`, `JSON` | `setting.value_type` |

### TEXT (extensible, validated by the application)

| Column | Reason |
|---|---|
| `setting.category` | *"Additional categories may be added without changing the database structure"* |
| `trip_history.event_type` | *"The list should remain extensible"* |
| `pricing_component.code` | Pricing components are database-driven records, not code constants |
| `calendar_event.event_type` | *"Additional event types may be introduced in future versions"* |

## Referential Actions

Because business entities are never physically deleted, foreign keys use `ON DELETE RESTRICT` by default.

Two exceptions:

- `trip.trip_group_id` → `ON DELETE SET NULL` (dissolving a group must not delete Trips).
- `trip_pricing_item.trip_pricing_id` → `ON DELETE CASCADE` (reprocessing replaces the pricing result and its items).

---

# 2. Table Overview

| # | Table | Domain |
|---|---|---|
| 1 | `imported_email` | Import |
| 2 | `pdf_document` | Import |
| 3 | `parser_run` | Import |
| 4 | `trip_group` | Planning |
| 5 | `trip` | Planning |
| 6 | `trip_history` | Planning |
| 7 | `trip_custom_property` | Planning |
| 8 | `driver` | People |
| 9 | `vacation` | People |
| 10 | `vehicle` | Fleet |
| 11 | `trailer` | Fleet |
| 12 | `vehicle_assignment` | Fleet |
| 13 | `maintenance` | Fleet |
| 14 | `custom_property` | Settings |
| 15 | `setting` | Settings |
| 16 | `route_pricing` | Pricing configuration |
| 17 | `pricing_component` | Pricing configuration |
| 18 | `route_cost` | Pricing configuration |
| 19 | `trip_pricing` | Pricing |
| 20 | `trip_pricing_item` | Pricing |
| 21 | `calendar_event` | Calendar |
| 22 | `note` | Calendar |

---

# 3. Import Domain

## 3.1 `imported_email`

### Purpose

Represents one email received by the IMAP Service. Exists only for the email import path; manually uploaded and API-imported PDFs have no `imported_email` row.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `sender_email` | `TEXT` | NO | — | |
| `subject` | `TEXT` | NO | — | Carries the `NEW:` / `UPDATE:` / `CANCEL:` prefix |
| `message_id` | `TEXT` | NO | — | RFC Message-ID, used for duplicate detection |
| `received_at` | `TIMESTAMPTZ` | NO | — | |
| `processed_at` | `TIMESTAMPTZ` | YES | `NULL` | Set when processing completes |
| `processing_status` | `email_processing_status` | NO | `'RECEIVED'` | |
| `import_type` | `import_type` | NO | — | Derived from the subject prefix |
| `body` | `TEXT` | YES | `NULL` | Optional, debugging only |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `UNIQUE (message_id)` — a Message-ID may never be processed twice.

### Foreign Keys

None. The relationship to `pdf_document` is owned by `pdf_document`.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique | `message_id` | Unique |
| Lookup | `processing_status` | B-tree |
| Lookup | `received_at` | B-tree |

### Application-enforced rules

- Records are immutable after successful processing, except `processing_status` and `processed_at`.
- Records are never deleted.
- Only emails from configured trusted senders with exactly one PDF attachment are stored.

---

## 3.2 `pdf_document`

### Purpose

Represents one imported PDF, the immutable source of one or more Trips. May originate from an email, a manual dashboard upload, or a future API import.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `imported_email_id` | `UUID` | YES | `NULL` | `NULL` for manual / API imports |
| `import_source` | `import_source` | NO | — | `EMAIL`, `MANUAL_UPLOAD`, `API` |
| `original_filename` | `TEXT` | NO | — | |
| `storage_path` | `TEXT` | NO | — | Path on disk; base directory is configurable |
| `file_size_bytes` | `BIGINT` | NO | — | |
| `file_hash` | `TEXT` | NO | — | Used for duplicate detection and integrity verification |
| `mime_type` | `TEXT` | NO | — | |
| `uploaded_at` | `TIMESTAMPTZ` | NO | `now()` | Upload Timestamp |
| `parser_version` | `TEXT` | YES | `NULL` | See open point O2 |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `UNIQUE (imported_email_id)` — an ImportedEmail contains exactly one PdfDocument. `NULL` values are distinct in PostgreSQL, so this does not restrict manual/API imports.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `imported_email_id` | `imported_email(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique | `imported_email_id` | Unique (partial by nature of NULLs) |
| Lookup | `file_hash` | B-tree, **not unique** — used to *find* duplicates, not to block identical re-imports |
| Lookup | `import_source` | B-tree |
| Lookup | `uploaded_at` | B-tree |

### Application-enforced rules

- The stored file is never modified or replaced.
- A `pdf_document` always exists before any Trip referencing it.

---

## 3.3 `parser_run`

### Purpose

Records one execution of the PDF Parser. Append-only diagnostic history. Exists independently of Trips — a parser run may fail before any Trip is created.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `pdf_document_id` | `UUID` | NO | — | |
| `parser_version` | `TEXT` | NO | — | |
| `started_at` | `TIMESTAMPTZ` | NO | — | |
| `finished_at` | `TIMESTAMPTZ` | YES | `NULL` | `NULL` while running or if the run crashed |
| `duration_ms` | `INTEGER` | YES | `NULL` | Execution Duration in milliseconds — see open point O3 |
| `result` | `parser_result` | NO | — | |
| `warning_count` | `INTEGER` | NO | `0` | |
| `error_count` | `INTEGER` | NO | `0` | |
| `error_code` | `TEXT` | YES | `NULL` | |
| `error_message` | `TEXT` | YES | `NULL` | |
| `metadata` | `JSONB` | YES | `NULL` | Technical parser diagnostics — see §1 JSONB Usage |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

`metadata` holds run-level technical diagnostics only: detected layout, parser confidence, detected sections, warnings, execution statistics, debug information and parser-specific data. Because every execution creates a new row, this metadata is never overwritten — the full diagnostic history of a PDF survives across parser versions, which is what makes parser comparison possible.

Raw extracted values belonging to a specific Trip are **not** stored here; they belong to `trip.parser_metadata`.

### Constraints

- `CHECK` — `warning_count` must be greater than or equal to zero.
- `CHECK` — `error_count` must be greater than or equal to zero.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `pdf_document_id` | `pdf_document(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Lookup | `pdf_document_id` | B-tree |
| Lookup | `pdf_document_id`, `started_at` | B-tree — latest run per document |
| Lookup | `result` | B-tree |

### Application-enforced rules

- Append-only: never updated, never deleted.
- Every parser execution — including reprocessing and retries — creates a new row.

---

# 4. Planning Domain

## 4.1 `trip_group`

### Purpose

Groups the Trips of a Combination transport. Holds no business data of its own — only the grouping relationship.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

None at database level.

### Foreign Keys

None. The relationship is owned by `trip.trip_group_id`.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |

### Application-enforced rules

- A persisted group contains **at least two** Trips; a group reduced to one Trip is dissolved.
- Currently a maximum of two Trips.
- All Trips in a group originate from the same `pdf_document_id`.
- Each Trip in a group keeps its **own** `booking_number`. The real transport orders give the two legs different numbers (for example `DUBANR2598395` for the Delivery and `ANRBEL2603249` for the Collection), so `trip_group_id` — never a shared booking number — is what links them.

---

## 4.2 `trip`

### Purpose

The central entity. Represents one physical transport movement.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `pdf_document_id` | `UUID` | NO | — | Every Trip originates from exactly one PDF |
| `trip_group_id` | `UUID` | YES | `NULL` | Non-null ⇒ Trip is part of a Combination |
| `vehicle_id` | `UUID` | YES | `NULL` | Manually assigned |
| `driver_id` | `UUID` | YES | `NULL` | **Driver override.** When `NULL`, the Driver is resolved through `vehicle_assignment` |
| `status` | `trip_status` | NO | `'OPEN'` | |
| `booking_number` | `TEXT` | NO | — | Original PDF value. Per Trip, including each leg of a Combination |
| `container_number` | `TEXT` | YES | `NULL` | Empty for Loading until entered manually |
| `container_type` | `TEXT` | NO | — | e.g. `20TK`, `45PH` |
| `terminal` | `TEXT` | YES | `NULL` | Not guaranteed by the parser |
| `destination_city` | `TEXT` | NO | — | Normalized by the parser |
| `destination_country` | `TEXT` | NO | — | Normalized by the parser |
| `original_planning_date` | `DATE` | NO | — | Immutable; the date extracted at import |
| `planning_date` | `DATE` | NO | — | Current planning date; manually movable |
| `start_time` | `TIME` | YES | `NULL` | Planned start; not guaranteed by the parser |
| `end_time` | `TIME` | YES | `NULL` | Planned end; equals `start_time` when the PDF has one time |
| `execution_datetime` | `TIMESTAMPTZ` | YES | `NULL` | Actual execution/completion moment |
| `waiting_time_minutes` | `INTEGER` | YES | `NULL` | Manually entered |
| `distance_km` | `NUMERIC(8,2)` | YES | `NULL` | Manually entered; used by Distance-Based Pricing |
| `internal_notes` | `TEXT` | YES | `NULL` | Administrator notes |
| `parser_metadata` | `JSONB` | YES | `NULL` | Raw extracted values for this Trip — see §1 JSONB Usage |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Creation Timestamp |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

`parser_metadata` holds only the raw values that explain how this Trip's business fields were populated: raw terminal, raw destination, raw address, raw booking number, raw container number, raw date, matched labels. It is **parser-controlled** — replaced on every reprocessing, never protected like a manual field.

It must never contain parser confidence, detected layout, warnings, execution statistics, parser timing or parser version. Those belong exclusively to `parser_run.metadata`.

**Not stored (derived):**

| Concept | Resolved through |
|---|---|
| Import Source | `pdf_document.import_source` |
| Original Email | `pdf_document.imported_email_id` |
| Original Import Date | `imported_email.received_at` |
| Original Parser Version | `parser_run.parser_version` |
| Original Booking Reference | identical to `booking_number` |
| Trip Type (Normal / Combination) | `trip_group_id IS NOT NULL` |
| Previous status (for restore) | `trip_history` |
| Assigned Driver (when not overridden) | `vehicle_assignment` valid on `planning_date` |
| Pricing | `trip_pricing` |

### Constraints

- `CHECK` — `waiting_time_minutes`, when present, must be greater than or equal to zero.
- `CHECK` — `distance_km`, when present, must be greater than or equal to zero.

No `CHECK` on `end_time >= start_time`: the model does not state whether a planned interval may cross midnight.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `pdf_document_id` | `pdf_document(id)` | `RESTRICT` |
| `trip_group_id` | `trip_group(id)` | `SET NULL` |
| `vehicle_id` | `vehicle(id)` | `RESTRICT` |
| `driver_id` | `driver(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Lookup | `booking_number` | B-tree, **not unique** | Matching `UPDATE:` / `CANCEL:` documents to their Trip. Not unique because a `DELETED` Trip releases its booking number so it can be re-entered; uniqueness among the statuses that hold it is enforced by `TripService` |
| Lookup | `planning_date` | B-tree | Daily/weekly planning views and exports |
| Lookup | `status` | B-tree | Filtering out `DELETED` / `CANCELLED` |
| Lookup | `status`, `planning_date` | B-tree | Primary planning-board query |
| Lookup | `vehicle_id`, `planning_date` | B-tree | Vehicle grouping in planning; overlap validation |
| Lookup | `trip_group_id` | B-tree | Loading Combination siblings |
| Lookup | `driver_id` | B-tree | Driver override lookups |
| Lookup | `pdf_document_id` | B-tree | Trips created by a PDF |

### Application-enforced rules

These cannot be expressed as simple database constraints:

- **Booking Number uniqueness** — unique per Trip, except that all Trips sharing a `trip_group_id` share the same value.
- **Vehicle overlap** — a Vehicle may not be assigned to two Trips whose `planning_date` + `start_time` / `end_time` intervals overlap.
- **Status transitions** — invalid transitions are rejected; `CLOSED → OPEN` is not allowed.
- **Assignment eligibility** — inactive Vehicles and inactive Drivers cannot be assigned to new Trips; a Driver on Vacation cannot be assigned.
- **Manual field protection** — parser updates never overwrite `planning_date`, `driver_id`, `vehicle_id`, `waiting_time_minutes`, `distance_km`, `container_number`, `internal_notes`, or Custom Property assignments.
- **Immutability** — `original_planning_date`, `booking_number` and `pdf_document_id` never change after creation.
- Trips are never physically deleted.

---

## 4.3 `trip_history`

### Purpose

Append-only audit trail of every important change to a Trip.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `trip_id` | `UUID` | NO | — | |
| `event_type` | `TEXT` | NO | — | Extensible; validated by the application |
| `occurred_at` | `TIMESTAMPTZ` | NO | `now()` | Event timestamp |
| `performed_by` | `VARCHAR(255)` | NO | — | Auth0 subject (`sub`) — see open point O4 |
| `previous_value` | `JSONB` | YES | `NULL` | |
| `new_value` | `JSONB` | YES | `NULL` | |
| `description` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

None at database level.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `trip_id` | `trip(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Lookup | `trip_id`, `occurred_at` | B-tree (descending on `occurred_at`) | Trip timeline |
| Lookup | `event_type` | B-tree | Event-type reporting |
| Lookup | `performed_by` | B-tree | Per-user audit |

### Application-enforced rules

- Append-only: never updated, never deleted.
- Survives Trip status changes; `CANCELLED` and `DELETED` Trips keep their history.
- A record is written for: driver changed, vehicle changed, planning date changed, status changed, waiting time changed, container number entered/modified, custom property added/removed, trip reopened, trip cancelled, trip restored, trip imported, trip updated from PDF, pricing recalculated, trip added to / removed from group.

---

## 4.4 `trip_custom_property`

### Purpose

Join table implementing the many-to-many relationship between Trip and CustomProperty.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `trip_id` | `UUID` | NO | — | |
| `custom_property_id` | `UUID` | NO | — | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | Serves as the "Added Timestamp" |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `UNIQUE (trip_id, custom_property_id)` — the same Custom Property cannot be assigned twice to the same Trip.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `trip_id` | `trip(id)` | `RESTRICT` |
| `custom_property_id` | `custom_property(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique | `trip_id`, `custom_property_id` | Unique |
| Lookup | `custom_property_id` | B-tree — usage reporting per property |

### Application-enforced rules

- Only active Custom Properties may be assigned to a Trip.
- Adding or removing a row writes a `trip_history` record.
- Rows may be physically deleted when the Administrator unassigns a property; the historical pricing consequence is already frozen in `trip_pricing_item`.

---

# 5. People Domain

## 5.1 `driver`

### Purpose

Represents a company driver. Contains planning-related information only; authentication is external (Auth0) and not linked.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `name` | `TEXT` | NO | — | Not unique |
| `licence_number` | `TEXT` | YES | `NULL` | Unique among active Drivers only |
| `phone_number` | `TEXT` | YES | `NULL` | |
| `email` | `TEXT` | YES | `NULL` | |
| `emergency_contact` | `TEXT` | YES | `NULL` | See open point O5 |
| `notes` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- Partial `UNIQUE (licence_number)` where `is_active = TRUE` — scoped to active rows for the same reason as vehicle and trailer plates: a deactivated Driver keeps its historical value while freeing the number for reuse. `NULL` values are distinct in PostgreSQL, so any number of Drivers may have no licence number.

Driver names are explicitly not unique.

### Foreign Keys

None. Vehicle linkage is owned by `vehicle_assignment`.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique (partial) | `licence_number` where `is_active = TRUE` | Unique |
| Lookup | `is_active` | B-tree — assignment dropdowns |

### Application-enforced rules

- Created manually only; never created automatically.
- Never physically deleted.
- Inactive Drivers cannot receive new Trips but remain linked to historical Trips.
- A licence number is never used as an identifier; `id` remains the only identity.

---

## 5.2 `vacation`

### Purpose

A period during which a Driver is unavailable for new planning.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `driver_id` | `UUID` | NO | — | |
| `start_date` | `DATE` | NO | — | Inclusive |
| `end_date` | `DATE` | NO | — | Inclusive |
| `reason` | `TEXT` | YES | `NULL` | |
| `notes` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `CHECK` — `end_date` must be greater than or equal to `start_date`.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `driver_id` | `driver(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Lookup | `driver_id`, `start_date` | B-tree | Availability check for a Driver |
| Lookup | `start_date`, `end_date` | B-tree | Date-range availability across all Drivers |

### Application-enforced rules

- Vacation periods must not overlap for the same Driver. (A PostgreSQL `EXCLUDE` constraint over a date range could enforce this natively, but is not representable in Prisma's schema language.)
- Vacation affects future planning only; historical Trips are never modified.

---

# 6. Fleet Domain

## 6.1 `vehicle`

### Purpose

Represents a company truck that can be assigned to Trips and carries the planning color.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `license_plate` | `TEXT` | NO | — | Business identifier |
| `display_color` | `TEXT` | NO | — | Planning color; not unique |
| `description` | `TEXT` | YES | `NULL` | |
| `brand` | `TEXT` | YES | `NULL` | |
| `model` | `TEXT` | YES | `NULL` | |
| `year` | `INTEGER` | YES | `NULL` | |
| `notes` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- Partial `UNIQUE (license_plate)` where `is_active = TRUE` — a plate may be reused after a Vehicle is deactivated.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique (partial) | `license_plate` where `is_active = TRUE` | Unique |
| Lookup | `is_active` | B-tree |

### Application-enforced rules

- Created manually; never physically deleted.
- Inactive Vehicles cannot be assigned to new Trips.
- A Vehicle cannot be assigned to two Trips with overlapping planned intervals.

---

## 6.2 `trailer`

### Purpose

Represents a company trailer. Used exclusively for maintenance administration — never assigned to Trips.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `license_plate` | `TEXT` | NO | — | Business identifier |
| `description` | `TEXT` | YES | `NULL` | |
| `brand` | `TEXT` | YES | `NULL` | |
| `model` | `TEXT` | YES | `NULL` | |
| `year` | `INTEGER` | YES | `NULL` | |
| `notes` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- Partial `UNIQUE (license_plate)` where `is_active = TRUE`.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique (partial) | `license_plate` where `is_active = TRUE` | Unique |
| Lookup | `is_active` | B-tree |

### Application-enforced rules

- Never assigned to a Trip — no `trip` relationship exists.
- Inactive Trailers cannot receive new maintenance planning.
- Never physically deleted.

---

## 6.3 `vehicle_assignment`

### Purpose

Historized link between a Driver and a Vehicle. Allows the Driver of a historical Trip to be resolved correctly after a Vehicle is reassigned.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `vehicle_id` | `UUID` | NO | — | |
| `driver_id` | `UUID` | NO | — | |
| `valid_from` | `DATE` | NO | — | Inclusive |
| `valid_to` | `DATE` | YES | `NULL` | `NULL` ⇒ currently active |
| `notes` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `CHECK` — `valid_to`, when present, must be greater than or equal to `valid_from`.
- Partial `UNIQUE (vehicle_id)` where `valid_to IS NULL` — a Vehicle has at most one active assignment.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `vehicle_id` | `vehicle(id)` | `RESTRICT` |
| `driver_id` | `driver(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Unique (partial) | `vehicle_id` where `valid_to IS NULL` | Unique | One active assignment per Vehicle |
| Lookup | `vehicle_id`, `valid_from` | B-tree | **Driver resolution for a Trip's planning date** |
| Lookup | `driver_id` | B-tree | Vehicles driven by a Driver over time |

### Application-enforced rules

- Assignment periods for the same Vehicle must not overlap. (An `EXCLUDE` constraint could enforce this natively but is not representable in Prisma.)
- Never physically deleted.
- Ending an assignment never changes the Driver already resolved for historical Trips.

---

## 6.4 `maintenance`

### Purpose

A maintenance event belonging to exactly one asset — a Vehicle **or** a Trailer, never both.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `vehicle_id` | `UUID` | YES | `NULL` | Set only for Vehicle maintenance |
| `trailer_id` | `UUID` | YES | `NULL` | Set only for Trailer maintenance |
| `status` | `maintenance_status` | NO | — | |
| `maintenance_type` | `TEXT` | YES | `NULL` | Free text — Onderhoud, Herstelling, Banden. Deliberately not an enum |
| `maintenance_date` | `DATE` | NO | — | |
| `description` | `TEXT` | NO | — | |
| `mileage` | `INTEGER` | YES | `NULL` | Odometer reading AT THIS maintenance, entered by the Administrator. Never the vehicle's current mileage |
| `cost` | `NUMERIC(12,2)` | YES | `NULL` | |
| `workshop` | `TEXT` | YES | `NULL` | Shown in the UI as "Garage" |
| `next_maintenance_date` | `DATE` | YES | `NULL` | Planned next maintenance. The Administrator's plan; nothing derives it |
| `next_maintenance_mileage` | `INTEGER` | YES | `NULL` | Planned next odometer reading. Whether it has been reached is NOT evaluable — see below |
| `notes` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

The conceptual "Asset Type" field is not stored — the asset type is implied by which foreign key is populated.

### Constraints

- `CHECK` — exactly one of `vehicle_id` and `trailer_id` must be non-null (an exclusive-or over the two null-tests).
- `CHECK` — `cost`, when present, must be greater than or equal to zero.
- `CHECK` — `mileage`, when present, must be greater than or equal to zero.
- `CHECK` — `next_maintenance_mileage`, when present, must be greater than or equal to zero.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `vehicle_id` | `vehicle(id)` | `RESTRICT` |
| `trailer_id` | `trailer(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Lookup | `vehicle_id`, `maintenance_date` | B-tree | Vehicle maintenance history |
| Lookup | `trailer_id`, `maintenance_date` | B-tree | Trailer maintenance history |
| Lookup | `status` | B-tree | Planned/open maintenance overview |
| Lookup | `maintenance_date` | B-tree | Scheduling overview |
| Lookup | `next_maintenance_date` | B-tree | Due-maintenance warnings |

### Application-enforced rules

- Records are never reassigned to another asset.
- Records are immutable after completion.
- Maintenance history is never removed; work that will not happen is set to `CANCELLED`.
- **Mileage is entered by hand and is never derived.** The system holds no current odometer
  reading for a vehicle, so a maintenance is considered due only when `next_maintenance_date`
  is set and has arrived. `next_maintenance_mileage` is stored and displayed, but whether it
  has been reached cannot be answered and must never be presented as a warning.

---

# 7. Settings Domain

## 7.1 `custom_property`

### Purpose

Configurable property that can be assigned to Trips and may contribute a pricing component.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `name` | `TEXT` | NO | — | e.g. `TAR`, `Flat`, `Over Sint-Niklaas`, `Toll`, `Tunnel` |
| `description` | `TEXT` | YES | `NULL` | |
| `pricing_component_id` | `UUID` | YES | `NULL` | `NULL` ⇒ fixed-price. Non-null ⇒ route-priced; the amount comes from `route_cost` |
| `default_price` | `NUMERIC(12,2)` | YES | `NULL` | Optional pricing value. Must be `NULL` when `pricing_component_id` is set |
| `display_order` | `INTEGER` | NO | — | |
| `color` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

A property with a `pricing_component_id` determines only **whether** the
component applies to a Trip. Its amount is resolved from `route_cost` for the
Trip's route, and the resulting pricing item is classified by the referenced
component — so it appears at that component's position in the sequence, not at
the Custom Property position.

### Constraints

- Partial `UNIQUE (name)` where `is_active = TRUE`.
- Partial `UNIQUE (pricing_component_id)` where `is_active = TRUE` — a component may be reached through at most one active property, otherwise one charge would produce two pricing lines. `NULL` values are distinct in PostgreSQL, so any number of fixed-price properties may exist.
- `CHECK` — `default_price` must be `NULL` when `pricing_component_id` is not `NULL`. A route-priced property never carries a price of its own, and a value stored here would silently never be used.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `pricing_component_id` | `pricing_component(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique (partial) | `name` where `is_active = TRUE` | Unique |
| Unique (partial) | `pricing_component_id` where `is_active = TRUE` | Unique |
| Lookup | `is_active`, `display_order` | B-tree — ordered selection list |

### Application-enforced rules

- Never physically deleted.
- Inactive properties cannot be selected for new Trips but remain visible on historical Trips.
- Changing `default_price` never recalculates historical Trips automatically.
- A referenced `pricing_component` must be active when the property is used for a new calculation.

---

## 7.2 `setting`

### Purpose

Generic key/value configuration store. New settings are added as rows, never as columns.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `category` | `TEXT` | NO | — | e.g. `GENERAL`, `PLANNING`, `PRICING`, `IMPORT`, `EXPORT`, `PARSER`, `NOTIFICATION`, `WHATSAPP` |
| `key` | `TEXT` | NO | — | |
| `value` | `TEXT` | NO | — | Cast by the application according to `value_type` |
| `value_type` | `setting_value_type` | NO | — | |
| `description` | `TEXT` | NO | — | |
| `default_value` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `UNIQUE (category, key)` — unconditional, since a Setting key must be unique within its category and Settings are never deleted.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique | `category`, `key` | Unique |
| Lookup | `category` | B-tree — loading a category as a block |

### Application-enforced rules

- `value` and `default_value` must parse according to `value_type`. PostgreSQL cannot validate this.
- Allowed `category` values are validated by the application.
- Inactive Settings are ignored by the application.
- Never physically deleted.
- Changing a Setting never modifies historical business data.

---

# 8. Pricing Configuration

## 8.1 `route_pricing`

### Purpose

Configured base transport price for one route, used when the active Pricing Strategy is Route-Based Pricing.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `route_name` | `TEXT` | NO | — | |
| `departure` | `TEXT` | NO | — | |
| `destination` | `TEXT` | NO | — | |
| `base_price` | `NUMERIC(12,2)` | NO | — | |
| `notes` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- Partial `UNIQUE (departure, destination)` where `is_active = TRUE` — the route, as currently defined, is the departure/destination pair.
- `CHECK` — `base_price` must be greater than or equal to zero.

### Foreign Keys

None. Trips do not reference `route_pricing`; the Pricing Engine selects the row during calculation.

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Unique (partial) | `departure`, `destination` where `is_active = TRUE` | Unique | Route uniqueness among active records |
| Lookup | `is_active` | B-tree | Active-only selection |

### Application-enforced rules

- Only active records may be used for new calculations.
- Modifying a route price never changes historical Trip pricing automatically.

---

## 8.2 `pricing_component`

### Purpose

Catalog of the pricing component kinds the Pricing Engine may produce. The single source of truth for classifying a `trip_pricing_item`.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `code` | `TEXT` | NO | — | e.g. `BASE_PRICE`, `FUEL_SURCHARGE`, `COMBINATION`, `WAITING_TIME`, `TOLL`, `TUNNEL`, `CUSTOM_PROPERTY`, `MANUAL_ADJUSTMENT` |
| `name` | `TEXT` | NO | — | |
| `description` | `TEXT` | NO | — | |
| `display_order` | `INTEGER` | NO | — | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- Partial `UNIQUE (code)` where `is_active = TRUE`.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique (partial) | `code` where `is_active = TRUE` | Unique |
| Lookup | `is_active`, `display_order` | B-tree — ordered component list for exports and reporting |

### Application-enforced rules

- Inactive components cannot be used for new calculations; historical `trip_pricing_item` rows keep referencing them.
- The components required by `pricing_rules.md` (Base Price, Combination Surcharge, Fuel Surcharge, Waiting Time, Toll, Tunnel, Custom Property, Manual Adjustment) must be seeded.

---

## 8.3 `route_cost`

### Purpose

The amount of a route-dependent pricing component for one route. Whether the
component applies to a Trip is decided by `trip_custom_property`; this table
answers only how much it costs on that route.

Deliberately **independent of `route_pricing`**: a toll is incurred whichever
Pricing Strategy produced the base price, and `route_pricing` is consulted only
under Route-Based Pricing. Keying this table by the route itself, rather than by
`route_pricing_id`, keeps route costs alive when the strategy changes.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `departure` | `TEXT` | NO | — | Matched against `trip.terminal` |
| `destination` | `TEXT` | NO | — | Matched against `trip.destination_city` |
| `pricing_component_id` | `UUID` | NO | — | The component this amount belongs to |
| `amount` | `NUMERIC(12,2)` | NO | — | |
| `notes` | `TEXT` | YES | `NULL` | |
| `is_active` | `BOOLEAN` | NO | `TRUE` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

The route is identified the same way `route_pricing` identifies it, so the two
stay comparable, but neither references the other.

### Constraints

- Partial `UNIQUE (departure, destination, pricing_component_id)` where `is_active = TRUE` — one active amount per component per route.
- `CHECK` — `amount` must be greater than or equal to zero (negative pricing is not supported).

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `pricing_component_id` | `pricing_component(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Unique (partial) | `departure`, `destination`, `pricing_component_id` where `is_active = TRUE` | Unique | Route uniqueness per component |
| Lookup | `departure`, `destination` | B-tree | **Resolving every route cost for a Trip's route in one query** |
| Lookup | `pricing_component_id` | B-tree | Per-component reporting and maintenance |

### Application-enforced rules

- Only active records may be used for new calculations.
- Modifying an amount never changes historical Trip pricing automatically.
- Records are never physically deleted.
- A Trip carrying a route-priced Custom Property whose route has no active `route_cost` for that component **fails the calculation**. It is never skipped and never priced as zero — see `pricing_rules.md`.

---

# 9. Pricing Domain

## 9.1 `trip_pricing`

### Purpose

The calculated pricing summary for one Trip. Exists only once the Trip reaches `CLOSED`.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `trip_id` | `UUID` | NO | — | One-to-zero-or-one |
| `total_price` | `NUMERIC(12,2)` | NO | — | Sum of all `trip_pricing_item.amount` |
| `currency` | `CHAR(3)` | NO | `'EUR'` | |
| `calculated_at` | `TIMESTAMPTZ` | NO | — | |
| `pricing_engine_version` | `TEXT` | NO | — | |
| `pricing_rule_version` | `TEXT` | NO | — | |
| `calculation_status` | `pricing_calculation_status` | NO | — | |
| `notes` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `UNIQUE (trip_id)` — enforces the one-to-zero-or-one relationship.
- `CHECK` — `total_price` must be greater than or equal to zero (negative pricing is not supported).

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `trip_id` | `trip(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Unique | `trip_id` | Unique |
| Lookup | `calculated_at` | B-tree — pricing reporting |
| Lookup | `calculation_status` | B-tree — finding failed calculations |

### Application-enforced rules

- May only exist when the parent Trip's status is `CLOSED`. PostgreSQL cannot enforce a cross-table conditional existence rule.
- Created when the Trip becomes `CLOSED`, or when the Administrator triggers **Reprocess Pricing**.
- Reprocessing **overwrites** the row using current Settings; no previous version is retained.
- `total_price` must equal the sum of the related `trip_pricing_item.amount` values.
- The Pricing Engine never modifies planning data.

---

## 9.2 `trip_pricing_item`

### Purpose

One individual component of a pricing calculation. Every pricing element — base price, fuel, waiting time, custom properties, manual adjustments — is stored as its own row, so new pricing rules never require schema changes.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `trip_pricing_id` | `UUID` | NO | — | |
| `pricing_component_id` | `UUID` | NO | — | Classifies the item |
| `custom_property_id` | `UUID` | YES | `NULL` | Reference Entity — set when the item originates from a Custom Property |
| `description` | `TEXT` | NO | — | |
| `amount` | `NUMERIC(12,2)` | NO | — | |
| `currency` | `CHAR(3)` | NO | `'EUR'` | |
| `calculation_order` | `INTEGER` | NO | — | Preserves the order defined in `pricing_rules.md` |
| `quantity` | `NUMERIC(12,2)` | YES | `NULL` | e.g. billable waiting blocks, kilometres |
| `unit_price` | `NUMERIC(12,2)` | YES | `NULL` | |
| `notes` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

No `CHECK` on the sign of `amount`: `database_model.md` states amounts may be positive or negative. See open point O6.

### Constraints

None beyond the foreign keys. `calculation_order` is not unique — the model requires ordering, not uniqueness.

### Foreign Keys

| Column | References | On Delete |
|---|---|---|
| `trip_pricing_id` | `trip_pricing(id)` | `CASCADE` |
| `pricing_component_id` | `pricing_component(id)` | `RESTRICT` |
| `custom_property_id` | `custom_property(id)` | `RESTRICT` |

### Indexes

| Index | Columns | Type | Purpose |
|---|---|---|---|
| PK | `id` | Primary key | |
| Lookup | `trip_pricing_id`, `calculation_order` | B-tree | Ordered breakdown retrieval and Excel export |
| Lookup | `pricing_component_id` | B-tree | Component-level reporting |
| Lookup | `custom_property_id` | B-tree | Custom-property revenue reporting |

### Application-enforced rules

- Items are never shared between Trips.
- Reprocessing replaces the whole item set together with its `trip_pricing` parent.
- Fuel is calculated only on the base transport price and excludes the Combination Surcharge, Waiting Time, Toll, Tunnel, Manual Adjustments and Custom Properties.

---

# 10. Calendar Domain

## 10.1 `calendar_event`

### Purpose

An event in the Administrator's internal planning calendar. Fully independent from Trips.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `title` | `TEXT` | NO | — | |
| `description` | `TEXT` | YES | `NULL` | |
| `event_type` | `TEXT` | NO | — | e.g. `MEETING`, `REMINDER`, `PERSONAL`, `MAINTENANCE`, `OTHER` |
| `start_date` | `DATE` | NO | — | |
| `start_time` | `TIME` | NO | — | |
| `end_date` | `DATE` | YES | `NULL` | |
| `end_time` | `TIME` | YES | `NULL` | |
| `color` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

- `CHECK` — `end_date`, when present, must be greater than or equal to `start_date`.

Events may overlap; no exclusion constraint applies.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Lookup | `start_date` | B-tree — calendar month/week views |
| Lookup | `event_type` | B-tree |

### Application-enforced rules

- May be physically deleted; deletion never affects business data.

---

## 10.2 `note`

### Purpose

A free-form administrator note. Standalone, with no business relationships.

### Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary key |
| `title` | `TEXT` | NO | — | |
| `content` | `TEXT` | NO | — | Unlimited length |
| `color` | `TEXT` | YES | `NULL` | |
| `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NO | `now()` | |

### Constraints

None.

### Foreign Keys

None.

### Indexes

| Index | Columns | Type |
|---|---|---|
| PK | `id` | Primary key |
| Lookup | `updated_at` | B-tree — most-recently-edited ordering |

### Application-enforced rules

- May be physically deleted; deletion never affects business data.

---

# 11. Constraints Not Enforceable in the Database

The following business rules require Backend enforcement. They are listed together so no rule is silently lost during implementation.

| Rule | Source | Reason it cannot be a simple constraint |
|---|---|---|
| Booking Number unique per Trip, including each leg of a Combination | `database_model.md` §4.1, §4.2 | A `DELETED` Trip releases its Booking Number, so uniqueness holds only among the statuses that hold it |
| All Trips in a TripGroup share the same PDF | §4.2 | Cross-row invariant; `trip_group` stores no PDF reference |
| A TripGroup contains at least two Trips; dissolves at one | §4.2 | Requires counting sibling rows on removal |
| A Vehicle may not be assigned to overlapping Trips | §4.1, §4.8 | Interval overlap across `planning_date` + `start_time`/`end_time` |
| Vacation periods must not overlap per Driver | §4.11 | Range exclusion; not representable in Prisma |
| VehicleAssignment periods must not overlap per Vehicle | §4.20 | Range exclusion; not representable in Prisma |
| Valid Trip status transitions | §4.1 | State machine |
| `trip_pricing` exists only when the Trip is `CLOSED` | §4.13 | Cross-table conditional existence |
| `trip_pricing.total_price` equals the sum of its items | §6 Pricing Constraints | Cross-table aggregate |
| Inactive Vehicles/Drivers cannot be assigned to new Trips | §4.7, §4.8 | Applies to new assignments only; historical rows must remain valid |
| A Driver on Vacation cannot be assigned | §4.11 | Requires a date-range lookup |
| Parser updates never overwrite manual fields | §6 Manual Override Constraints | Field-level write authorization |
| `setting.value` must parse per `value_type` | §4.17 | Generic value column |
| `trip_history` and `parser_run` are append-only | §4.3, §4.6 | Requires revoked UPDATE/DELETE rights or triggers |
| Trips, Drivers, Vehicles, Trailers, Settings are never physically deleted | §6 | Enforced by `ON DELETE RESTRICT` plus Backend policy |
| A route-priced Custom Property must resolve a `route_cost` for the Trip's route | §4.22 | Cross-table conditional existence, dependent on the Trip's route |
| A referenced `pricing_component` must be active for a new calculation | §4.12 | Applies to new calculations only; historical rows must stay valid |

---

# 12. Open Points

These are unresolved ambiguities in the source documents. Each is flagged where it occurs above. None blocked schema generation, but each should be confirmed and the source document corrected.

**O1 — `pdf_document.file_hash` uniqueness.**
`database_model.md` §4.4 says every PDF "should receive a unique file hash" and that the hash is used for *duplicate detection*. This schema uses a **non-unique** index, so identical file content can be re-imported (for example the same PDF resent with an `UPDATE:` email) and detected by query. A unique constraint would block that. Confirm the intent.

**O2 — `pdf_document.parser_version` is redundant.**
§4.4 lists Parser Version under PdfDocument's Stored Information, but answer A4 states the original parser version is derived through `parser_run`. Both cannot be true without duplicating data. The column is included here (per the primary document) and left nullable. Recommend removing it from §4.4 and relying on `parser_run`.

**O3 — `parser_run.duration_ms` unit.**
§4.6 lists "Execution Duration" without a unit. Milliseconds was chosen and encoded in the column name. It is also derivable from `started_at` / `finished_at`.

**O4 — `trip_history.performed_by` for system-generated events.**
§4.3 lists "Performed By" as a required field, so the column is `NOT NULL`. Events generated by the IMAP Service, the Parser Service or the Pricing Engine have no Auth0 subject. A reserved system identifier must be defined, or the column must become nullable.

**O5 — `driver.emergency_contact`.**
§4.7's "Contact Information" section lists emergency contact as an optional Driver field, but the "Stored Information" list omits it. Included here as nullable. Confirm and align §4.7.

**O6 — Sign of `trip_pricing_item.amount`.**
`database_model.md` §4.14 states "Amounts may be positive or negative." `pricing_rules.md` states "Negative pricing is not supported" and "Manual Adjustments are always positive amounts." The primary document was followed: no sign constraint on items, but `trip_pricing.total_price` must be non-negative. These two documents contradict each other and should be reconciled.

**O7 — Historical pricing items versus overwrite-on-reprocess.**
§4.14 states "Historical PricingItems should never be removed", while §4.13 and answer 6 state reprocessing overwrites the pricing result with no version retained. This schema follows the overwrite decision (`ON DELETE CASCADE` from `trip_pricing`). The §4.14 sentence should be corrected.

**O8 — Raw parser metadata storage. RESOLVED.**
Split by grain across two `JSONB` columns: `parser_run.metadata` for technical diagnostics (never overwritten, one row per execution) and `trip.parser_metadata` for the raw extracted values of that specific Trip (parser-controlled, replaced on reprocessing). Rules in §1 JSONB Usage and §1 Ownership of Parser Data. `database_model.md` §4.1 and §4.6 updated to match.

**O9 — `trip.original_planning_date` nullability.**
Answer A9's `NOT NULL` list did not include this column, but it is populated at import from the same parser-validated Date that feeds `planning_date` (which is `NOT NULL`), and `businessRules.md` §4 requires it for reporting. It is defined `NOT NULL` here. Confirm.

**O10 — Enum classification for three unlisted lists.**
The enum/TEXT rule was applied to three lists that were not explicitly classified: `email_processing_status`, `import_source` and `setting_value_type` are native enums, as stable technical lifecycles. `calendar_event.event_type` is `TEXT`, because §4.15 explicitly calls it extensible.
