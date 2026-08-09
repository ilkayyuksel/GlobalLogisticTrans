# Feature List

This document contains all functional requirements of the Transport Management System.

It describes WHAT the application should be able to do.

Implementation details are intentionally excluded.

---

# 1. Authentication

The application requires authentication before access is granted.

Future support may include:

- Auth0
- Multiple users
- Roles
- Permissions

---

# 2. Dashboard

The dashboard provides a real-time overview of the transport planning.

Features:

- Today's trips
- Weekly overview
- Monthly overview
- Active trips
- Finished trips
- Cancelled trips
- Statistics
- Fleet status
- Maintenance reminders
- Calendar overview

---

# 3. Trip Management

Trips are the core of the application.

Each trip contains:

- Assigned vehicle
- Assigned driver
- Status
- Trip Group
- Planned date
- Original date
- Execution date
- Start time
- End time
- Container number
- Container type
- Booking number
- Terminal
- Address
- Custom properties
- Waiting time
- Linked PDF
- Pricing overview
- Audit history

---

# 4. Trip Actions

Every trip supports the following actions.

- Open trip
- Edit trip
- Mark as finished
- Reopen trip
- Move to another planning day
- Download PDF
- View PDF
- Reprocess pricing
- View Trip Group
- Unlink from Trip Group
- Cancel trip

Trips are never permanently deleted.

---

# 5. Trip Planning

Trips are displayed by:

- Day
- Week
- Month

Trips can be moved between planning days.

Trips are automatically grouped by assigned vehicle.

Trips assigned to the same vehicle appear together.

Every vehicle receives its own planning color.

---

# 6. Combination Trips

The system supports transport orders containing multiple trips.

Features:

- Automatic Trip Group creation
- Group color
- Group identifier
- View linked trips
- Independent planning
- Independent status
- Independent execution

---

# 7. PDF Processing

Features:

- Automatic PDF import
- Multiple PDF layouts
- Multi-page PDFs
- Combination PDFs
- Manual PDF upload
- PDF debug mode
- Parser diagnostics

---

# 8. Email Processing

Features:

- IMAP monitoring
- Automatic PDF download
- Duplicate detection
- Email logging
- Sender validation
- Subject detection
- Automatic trip creation
- Automatic trip updates
- Automatic cancellations

---

# 9. Pricing Engine

The system automatically calculates trip pricing.

Features:

- Rule-based calculations
- Fuel calculation
- Waiting time
- Custom property pricing
- Combination pricing
- Manual adjustments
- Price recalculation
- Pricing overview
- Automatic pricing
- Pricing breakdown
- Recalculate pricing
- Preview pricing
- Configurable pricing rules

Detailed rules are documented separately.

---

# 10. Export

Export trips to Excel.

Supported exports:

- Daily
- Weekly

Future:

- Monthly
- Custom range

Exports include pricing.

---

# 11. Fleet Management

Vehicle management.

Trailer management.

Maintenance history.

Maintenance reminders.

Vehicle documents.

Driver assignment.

---

# 12. Driver Management

Features:

- Driver list
- Vehicle assignment
- Vacation planning
- Availability
- Driver history

Unavailable drivers cannot be assigned.

---

# 13. Calendar

Personal planning.

Weekly calendar.

Monthly calendar.

Notes.

Appointments.

Drag & Drop planning.

---

# 14. Notes

Create notes.

Categorize notes.

Color notes.

Link notes to dates.

---

# 15. Settings

Manage:

Vehicles

Drivers

Custom properties

Fuel percentage

Pricing settings

General settings

Parser settings

Application settings

---

# 16. Communication

Future module.

Possible features:

WhatsApp

Email

SMS

Push notifications

Driver communication

Photo upload

Proof of delivery

Container confirmation

---

# 17. Audit

The application keeps history of important actions.

Examples:

Planning changes

Container changes

Pricing recalculations

Trip updates

Manual overrides

Status changes

---

# 18. Administration

Administrative tools.

Database maintenance.

Parser diagnostics.

Email diagnostics.

Log viewer.

System settings.

Health checks.