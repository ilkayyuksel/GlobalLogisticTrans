# Component Guidelines

## Purpose

This document defines every reusable UI component used throughout the Transport Management System.

The objective is to maximize component reuse and maintain a consistent user experience.

Before creating a new component, always verify whether an existing component can be reused or extended.

Avoid duplicate components.

---

# General Rules

Every component should:

- Have one responsibility
- Be reusable
- Be configurable through props
- Support Light Mode
- Support Dark Mode
- Support Dutch
- Support Turkish
- Be fully typed
- Be responsive on tablets
- Be accessible

Avoid hardcoded values.

---

# Component Folder Structure

Every reusable component should follow this structure:

Component/

├── Component.tsx

├── Component.types.ts

├── Component.test.tsx (future)

├── Component.stories.tsx (future)

└── index.ts

Avoid placing multiple unrelated components in one file.

---

# Buttons

Only use the predefined button variants.

Allowed variants:

Primary

Secondary

Outline

Ghost

Danger

Icon

Loading

Buttons should never have custom colors.

Every button should have:

Hover state

Focus state

Disabled state

Loading state

---

# Inputs

All inputs should behave consistently.

Supported inputs:

Text

Number

Textarea

Password

Email

Date

Time

Checkbox

Switch

Radio

Select

Multi Select

Autocomplete

Every input contains:

Label

Input

Validation

Optional helper text

---

# Select

Dropdowns should support:

Search

Keyboard navigation

Clear selection

Disabled state

Loading state

---

# Multi Select

The application uses Multi Select frequently.

Examples:

Custom Properties

Drivers

Vehicles

Tags

Requirements:

Search

Remove selected items

Clear all

Scrollable

Keyboard accessible

---

# Date Picker

Use one reusable Date Picker.

Support:

Single date

Range (future)

Localization

Dark Mode

Tablet

---

# Time Picker

Support:

24-hour format

Keyboard input

Dropdown selection

---

# Cards

Cards group related information.

All cards should use the same layout.

Structure:

Title

Description (optional)

Actions (optional)

Divider (optional)

Content

Footer (optional)

---

# Dashboard Card

Dashboard cards display statistics.

Examples:

Today's Trips

Finished Trips

Maintenance

Revenue

Parser Errors

Cards should contain:

Icon

Title

Value

Optional trend

---

# Tables

Tables are one of the most important components.

Every table should support:

Sorting

Searching

Filtering

Pagination

Sticky Header

Hover state

Empty state

Loading state

Tablet support

Future:

Column resizing

Column visibility

---

# Trip Table

The Trip Table is the most important component.

Columns:

Status

Vehicle

Driver

Date

Start

End

Container

Container Type

Booking

Terminal

Address

Custom Properties

Waiting Time

Price

Actions

Requirements:

Sorting

Filtering

Grouping

Search

Expandable rows

Context menu

Sticky header

Colored rows

PDF indicator

Combination indicator

---

# Status Badge

Use one reusable badge component.

Supported statuses:

Open

Finished

Cancelled

Parser Error

Waiting

Colors must match Design Tokens.

---

# Driver Badge

Each driver has one consistent color.

The badge should be reused throughout the application.

---

# Trip Group Badge

Combination trips display a shared badge.

The badge links related trips visually.

---

# Search Bar

Use one reusable search component.

Support:

Debounce

Clear button

Keyboard shortcuts (future)

---

# Filters

Filters should appear above tables.

Use:

Dropdowns

Checkboxes

Date Picker

Multi Select

Never place filters inside tables.

---

# Sidebar

The sidebar should be reusable.

Support:

Collapse

Expand

Active item

Icons

Nested menus (future)

---

# Top Navigation

Contains:

Search

Language

Theme Toggle

Notifications (future)

User Menu

---

# Tabs

Use tabs for:

Maintenance

Settings

Reports

Avoid excessive nesting.

---

# Modal

All modals should follow the same structure.

Header

Description

Content

Footer

Buttons

---

# Confirmation Dialog

Only use confirmations for destructive actions.

Examples:

Cancel Trip

Delete Maintenance

Reset Settings

---

# Drawer

Use drawers for:

Quick editing

Trip preview

PDF preview

Avoid full-page navigation when unnecessary.

---

# PDF Viewer

The PDF Viewer should support:

Zoom

Download

Open in new tab

Multiple pages

Page navigation

Loading state

Error state

---

# Calendar

Support:

Day

Week

Month

Notes

Drag & Drop (future)

---

# Maintenance Table

Columns:

Vehicle

Type

Description

Date

Mileage

Cost

Next Maintenance

Actions

---

# Vehicle Card

Display:

License Plate

Driver

Status

Maintenance

Last Service

---

# Driver Card

Display:

Name

Assigned Vehicle

Vacation

Availability

---

# Notes

Notes should support:

Color

Date

Category

Search

Edit

Delete

---

# Pricing Card

Display:

Base Price

Fuel

Waiting

Flat

Tar

Over Sint-Niklaas

Other

Total

---

# Pricing Breakdown

Expandable.

Show every calculation rule separately.

---

# Statistics Card

Reusable component.

Examples:

Revenue

Trips

Maintenance

Parser Success Rate

---

# Progress Indicator

Used for:

Parser

Import

Export

Uploads

Never block the interface unnecessarily.

---

# Skeleton

Every page should have matching skeletons.

Avoid generic loading spinners.

---

# Empty State

Every module has an Empty State.

Structure:

Illustration

Title

Description

Action

---

# Error State

Structure:

Icon

Title

Description

Retry Button

---

# Toast

Support:

Success

Info

Warning

Error

Should disappear automatically.

---

# Tooltip

Use tooltips sparingly.

Only when the meaning is unclear.

---

# Context Menu

Used in:

Trip Table

Maintenance

Calendar

Notes

Should contain the most common actions.

---

# Floating Action Button

Avoid unless absolutely necessary.

Desktop software should prefer normal buttons.

---

# Charts

Use one chart library.

Preferred:

Recharts

Supported charts:

Bar

Line

Area

Avoid Pie Charts unless appropriate.

---

# Icons

Only Lucide Icons.

Keep icon sizes consistent.

Never mix icon sets.

---

# Responsive Behaviour

Desktop remains the primary layout.

Tablet layouts may:

Collapse sidebars

Reduce padding

Hide less important columns

Never remove core functionality.

---

# Component Reuse

Before creating a component:

1. Search for an existing one.
2. Extend it if possible.
3. Create a new component only when necessary.

Avoid duplicate implementations.

---

# Naming

Examples:

TripTable

TripCard

TripActions

PricingCard

VehicleBadge

StatusBadge

MaintenanceTable

Avoid vague names like:

Card2

ButtonNew

TableComponent

---

# Component Size

Aim for:

Simple Components:

<150 lines

Complex Components:

<250 lines

Split large components into smaller reusable components.

---

# State Management

Keep component state local whenever possible.

Lift state only when necessary.

Avoid prop drilling.

---

# Performance

Avoid unnecessary renders.

Use memoization only when it provides measurable value.

Do not optimize prematurely.

---

# Final Rule

Every new component should answer these questions:

Can an existing component be reused?

Does it follow the Design Tokens?

Does it follow the UI Guidelines?

Will it still make sense when the application doubles in size?

If the answer is no,

reconsider the implementation.