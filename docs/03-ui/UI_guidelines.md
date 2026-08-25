# UI Guidelines

## Purpose

This document defines the design principles and user interface guidelines for the Transport Management System (TMS).

Every screen, component and interaction should follow these guidelines.

The goal is to create a modern, professional, consistent and maintainable enterprise application.

These guidelines should remain valid throughout the lifetime of the project.

---

# Design Philosophy

The application is intended to be used for several hours every day by planners and administrators.

Therefore the UI must prioritize:

- Productivity
- Clarity
- Speed
- Consistency
- Reliability

The interface should never distract the user.

The software should feel similar to modern enterprise applications such as:

- Linear
- GitHub
- Stripe Dashboard
- Notion
- Vercel Dashboard
- Grafana

Avoid flashy designs.

Avoid unnecessary animations.

Avoid unnecessary colors.

Whitespace is preferred over visual clutter.

---

# General Principles

Always prefer:

- consistency
- simplicity
- readability
- accessibility
- responsiveness

Avoid:

- crowded layouts
- inconsistent spacing
- inconsistent buttons
- inconsistent tables
- different component styles
- duplicated UI patterns

Every screen should feel like it belongs to the same application.

---

# Desktop First

This application is designed for desktop use.

Primary target resolutions:

- 1920x1080
- 2560x1440
- 3440x1440

The desktop experience always has priority.

---

# Tablet Support

The application must also support tablets.

Supported:

- Landscape
- Portrait

The application should remain fully usable on tablets.

Layouts may adapt where necessary.

---

# Mobile Phones

Phone support is NOT required.

The application does not need to be optimized for mobile phones.

---

# Internationalization

The application must support multiple languages.

Initially:

- Dutch
- Turkish

Future languages should be easy to add.

No visible text may be hardcoded.

Always use the translation system.

Examples:

Buttons

Labels

Errors

Notifications

Dialogs

Tables

Sidebar

Menus

Everything must be translatable.

---

# Theme

The application must support:

- Light Mode
- Dark Mode

Both themes should provide an excellent user experience.

No component may only support one theme.

The selected theme should persist between sessions.

---

# Typography

Use one font throughout the application.

Preferred font:

Inter

Fallback:

system-ui

Arial

sans-serif

Typography should remain consistent.

Avoid decorative fonts.

---

# Visual Hierarchy

Every page should have:

Page Title

↓

Description

↓

Primary Actions

↓

Filters

↓

Content

↓

Secondary Actions

The user should immediately understand where to focus.

---

# Layout

Every page should use the same spacing system.

Do not create custom layouts unless necessary.

Pages should align consistently.

---

# White Space

Use generous whitespace.

Whitespace improves readability.

Avoid squeezing too much information onto one screen.

---

# Sidebar

The sidebar is always located on the left.

The sidebar should remain consistent across the application.

Suggested navigation:

Dashboard

Planning

Trips

Fleet

Maintenance

Calendar

Notes

Settings

Logout

Icons should accompany every navigation item.

---

# Header

Every page should contain:

Page title

Optional description

Search

Language selector

Theme toggle

User menu

---

# Cards

Cards should be used to group related information.

Cards should remain visually lightweight.

Cards should never feel heavy or crowded.

Avoid excessive shadows.

---

# Row Actions

A row's actions are DIRECT controls, never a dropdown.

An action an operator performs many times a day must not cost an open, a read
and a click.

The lifecycle action follows from the status and there is at most one:

Open → Afwerken

Geannuleerd → Openen

Afgewerkt → none. It is terminal.

Verwijderd → none. It returns only through restoration.

A row never offers an action the backend would refuse.

The lifecycle action is the ONLY control in its column.

No edit button, no "more", no second menu under another name. Editing a
record's less common fields belongs to its detail page, which the row already
links to.

A read-only value may carry a control that OPENS something - a document viewer
beside a confirmed amount, for instance. That is not an edit control, and it
appears only when there is something to open: never a disabled icon pointing at
a document that does not exist.

An action that is not routine — cancelling, unlinking, deleting — does not
belong in a row. It keeps its confirmation and lives on the detail page, or
beside the thing it affects.

A routine action asks NOTHING. No browser confirmation, no dialog, no warning.
A dialog in front of a routine action is one people learn to dismiss without
reading, which then dismisses the dialogs that matter.

Where several rows carry the same action, the accessible name distinguishes
them: the visible label stays short, and the identifier of the row is added to
it.

---

# Tables

Tables are one of the most important components.

Every table should support:

Sorting

Searching

Filtering

Pagination

Sticky header

Hover states

Column resizing (future)

Column visibility (future)

Tables should remain readable with many rows.

---

# Forms

Forms should remain simple.

Every field should contain:

Label

Input

Optional helper text

Validation message

Avoid placeholder-only labels.

---

# Buttons

Buttons should remain consistent throughout the application.

Use only predefined button variants.

Avoid creating custom button styles.

Primary buttons represent the main action.

Secondary buttons represent alternative actions.

Danger buttons represent destructive actions.

Ghost buttons represent subtle actions.

Icon buttons should only be used when the meaning is obvious.

---

# Icons

Use only one icon library.

Preferred:

Lucide Icons

Do not mix icon libraries.

Icons should always have a clear meaning.

---

# Dialogs

Dialogs should contain:

Title

Description

Content

Actions

Avoid confirmation dialogs unless necessary.

---

# Markers That Are Not States

A label that classifies a record is shown BESIDE its status, never instead of
it, and never in a lifecycle colour.

Every filled badge tone already means something in the lifecycle. A
classification that borrowed one would read as a status the record does not
have.

Use the outline tone for these.

---

# Notifications

Every important action should provide feedback.

Examples:

Trip saved

Trip imported

Pricing recalculated

Export completed

Parser failed

Maintenance saved

Notifications should disappear automatically unless action is required.

---

# Loading States

Every asynchronous action should display feedback.

Prefer Skeleton components over loading spinners.

Examples:

Loading trips

Loading dashboard

Loading parser results

Loading maintenance

Loading exports

---

# Empty States

Every page should define an empty state.

Examples:

No trips found

No maintenance planned

No notes available

No calendar events

Empty states should explain what the user can do next.

---

# Error States

Errors should always be understandable.

Avoid technical messages.

Bad:

Unknown Exception

Good:

The PDF could not be parsed.

Please verify the document layout.

---

# Validation

Validation should happen immediately when possible.

Display validation messages below the relevant field.

Avoid popups for validation.

---

# Search

Search should be fast.

Search fields should always remain visible when useful.

Searching should not reload the page.

---

# Filtering

Filtering should be simple.

Filters should remain visible.

Frequently used filters should be easy to access.

A status filter NARROWS.

"All" is the union of every status the screen shows.

It is never a status of its own, and it never shows less than a narrower filter.

Every status the screen can show needs its own choice.

Without one, rows exist that can only ever be seen unfiltered - and the counters
stop adding up, which reads as a filter losing rows even when it is not.

---

# Selection

A selection survives navigation.

Changing the day, the week, the month, the page or a filter does not clear it.

One movement often spans two days, and its two Trips cannot be selected at all
if changing day throws the first tick away.

A selection is keyed by Trip id.

Never by booking number: several Trips may share one.

Never by row position.

"Select all visible rows" ADDS the rows on screen to the selection.

It never replaces it.

Five picked on Monday plus three on Tuesday is eight.

Only the operator clears a selection, or an action that consumes it.

A row is never dropped from a selection for being off screen.

Actions act on the WHOLE selection, including the rows that are not visible.

---

# Sorting

Users should be able to sort large tables.

Current sorting should always be visible.

---

# Pagination

Large datasets should be paginated.

Avoid extremely long pages.

A page should be large enough for the period it shows.

A month holds many times what a day holds. With one page size for both, widening
a filter makes the result larger and pushes rows onto the next page - so a row
that was just visible under a narrow filter disappears under a wider one.

---

# Calendar

The calendar should resemble common planning software.

Support:

Day

Week

Month

Notes

Appointments

Drag & Drop (future)

---

# Dashboard

The dashboard should immediately communicate:

Today's planning

Current workload

Finished trips

Cancelled trips

Maintenance reminders

Upcoming appointments

Statistics

---

# PDF Viewer

PDF viewing should happen inside the application.

Users should not need to download the file first.

Support:

Zoom

Download

Open in new tab

---

# Colors

Colors should communicate meaning.

Never use colors purely for decoration.

Status colors should remain consistent.

Driver colors should remain consistent.

Trip group colors should remain consistent.

---

# Accessibility

Maintain sufficient color contrast.

Support keyboard navigation.

Interactive elements should remain accessible.

Avoid tiny click targets.

---

# Animations

Animations should be subtle.

Never slow down the user.

Prefer:

Fade

Slide

Opacity

Avoid:

Large animations

Bouncing

Excessive movement

---

# Performance

The interface should remain responsive.

Avoid unnecessary renders.

Lazy load large modules where appropriate.

Virtualize large datasets when necessary.

---

# Responsiveness

Desktop layouts should gracefully adapt to tablets.

Tables may collapse less important columns.

Cards may stack vertically.

Navigation may become collapsible.

---

# Consistency

Every component should feel familiar.

Buttons should always behave the same.

Dialogs should always behave the same.

Tables should always behave the same.

Forms should always behave the same.

Consistency is more important than creativity.

---

# Reusability

Before creating a new component:

Search whether an existing component already solves the problem.

Prefer reuse over duplication.

Avoid creating nearly identical components.

---

# Future Expansion

Every new screen should follow these guidelines.

Exceptions should remain extremely rare.

When introducing a new UI pattern:

Ensure it improves the overall design system.

Do not introduce inconsistency.

---

# Final Principle

The application should feel like professional enterprise software.

The interface should never make the user think.

Users should always know:

- where they are
- what they can do
- what happened
- what will happen next

Clarity always wins over visual complexity.