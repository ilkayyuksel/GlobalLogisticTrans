# Design Tokens

## Purpose

This document defines all reusable design tokens used throughout the application.

Every component should use these tokens.

Avoid introducing custom values unless absolutely necessary.

Consistency is more important than visual creativity.

---

# Design Philosophy

The application should feel like modern enterprise software.

Design priorities:

- Clarity
- Consistency
- Accessibility
- Professional appearance

The interface should remain timeless.

Avoid trendy UI elements.

---

# Color Palette

## Primary

Used for:

- Primary buttons
- Links
- Active navigation
- Selected items
- Focus states

Color:

#2563EB

Hover:

#1D4ED8

Pressed:

#1E40AF

---

## Success

Used for:

Completed actions

Finished trips

Successful imports

Color:

#16A34A

Hover:

#15803D

---

## Warning

Used for:

Parser warnings

Waiting status

Missing information

Color:

#F59E0B

Hover:

#D97706

---

## Danger

Used for:

Cancelled trips

Delete actions

Errors

Color:

#DC2626

Hover:

#B91C1C

---

## Info

Used for:

Informational badges

Notifications

Color:

#0284C7

---

# Neutral Colors

Use Tailwind Slate.

Backgrounds should never be pure white or pure black.

Preferred palette:

Slate-50

Slate-100

Slate-200

Slate-300

Slate-400

Slate-500

Slate-600

Slate-700

Slate-800

Slate-900

---

# Light Theme

Background

#F8FAFC

Card

#FFFFFF

Sidebar

#FFFFFF

Border

#E2E8F0

Text Primary

#0F172A

Text Secondary

#475569

Muted Text

#94A3B8

Hover

#F1F5F9

---

# Dark Theme

Background

#0F172A

Sidebar

#111827

Card

#1E293B

Border

#334155

Text Primary

#F8FAFC

Text Secondary

#CBD5E1

Muted Text

#94A3B8

Hover

#334155

---

# Typography

Font Family

Inter

Fallback

system-ui

Arial

sans-serif

---

# Font Sizes

Extra Small

12px

Small

14px

Body

16px

Medium

18px

Heading Small

20px

Heading Medium

24px

Heading Large

30px

Page Title

36px

---

# Font Weights

Regular

400

Medium

500

Semibold

600

Bold

700

---

# Line Heights

Small

1.25

Body

1.5

Large Headings

1.2

---

# Spacing System

Use an 8px grid.

Allowed spacing:

4

8

12

16

24

32

40

48

64

80

96

Never use arbitrary spacing values.

---

# Border Radius

Small

6px

Default

8px

Large

12px

Dialog

16px

Avoid overly rounded interfaces.

---

# Shadows

Small

shadow-sm

Medium

shadow

Large

shadow-md

Avoid:

shadow-xl

shadow-2xl

unless absolutely necessary.

---

# Borders

Standard Border

1px

Color

Slate-200

Dark

Slate-700

---

# Icons

Icon Library

Lucide Icons

Default Size

18px

Large

22px

Small

16px

Never mix icon libraries.

---

# Buttons

Height

40px

Padding

Horizontal

16px

Vertical

8px

Border Radius

8px

Icon Spacing

8px

---

# Inputs

Height

40px

Border Radius

8px

Padding

12px

Border

Slate-300

Focus

Primary Blue

---

# Tables

Header Height

48px

Row Height

44px

Hover Color

Slate-50

Selected Row

Blue-50

Border

Slate-200

---

# Sidebar

Width

280px

Collapsed

72px

---

# Header

Height

64px

---

# Cards

Padding

24px

Gap

24px

Radius

12px

Shadow

shadow-sm

---

# Dialog

Maximum Width

700px

Padding

24px

Radius

16px

---

# Toast

Width

360px

Radius

12px

Padding

16px

---

# Badges

Height

24px

Padding

12px

Radius

9999px

---

# Status Colors

OPEN

Blue

FINISHED

Green

CANCELLED

Red

PARSER ERROR

Orange

WAITING

Yellow

---

# Driver Colors

Every driver should receive one consistent color.

Suggested palette:

Blue

Green

Purple

Orange

Cyan

Pink

Emerald

Indigo

Amber

Teal

The assigned color should never change.

---

# Trip Group Colors

Combination trips should use subtle background colors.

Never use strong saturated colors.

Opacity:

10-15%

The border may use the full color.

---

# Focus Ring

Primary Blue

2px

Visible on all interactive elements.

---

# Dividers

Use subtle borders.

Never use thick separators.

---

# Scrollbars

Use thin scrollbars.

Colors should adapt to Light/Dark mode.

---

# Animations

Duration

150ms

Fast

100ms

Slow

250ms

Animation Types

Fade

Slide

Opacity

Avoid:

Bounce

Zoom

Rotate

Complex transitions

---

# Breakpoints

Desktop XL

1536px

Desktop

1280px

Laptop

1024px

Tablet

768px

Below Tablet:

No optimization required.

---

# Z-Index

Header

100

Sidebar

200

Dropdown

500

Dialog

1000

Toast

1100

Tooltip

1200

---

# Charts

Keep charts simple.

Avoid excessive colors.

Maximum 6 colors per chart.

Prefer bars over pie charts.

---

# Empty States

Icon

Title

Description

Action Button

Always follow the same structure.

---

# Loading

Always use Skeleton components.

Avoid infinite spinners.

---

# Success Feedback

Use green.

Short animations only.

Maximum duration:

2 seconds.

---

# Error Feedback

Use red.

Explain the problem.

Suggest a solution whenever possible.

---

# Accessibility

Minimum contrast:

WCAG AA

Interactive elements should remain at least:

40px x 40px

---

# Component Library

Preferred Component Library

shadcn/ui

Do not introduce additional UI libraries unless absolutely necessary.

---

# Tailwind

Always use Tailwind utility classes.

Avoid inline styles.

Avoid custom CSS unless Tailwind cannot solve the problem cleanly.

---

# Final Rule

Whenever a new component is created:

It must follow these tokens.

Do not introduce new colors.

Do not introduce new spacing.

Do not introduce new shadows.

Do not introduce new typography.

Consistency is mandatory.