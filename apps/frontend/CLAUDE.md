# Frontend Guidelines

## Purpose

The frontend is responsible ONLY for presenting information and collecting user input.

The frontend is NOT responsible for business logic.

It should remain lightweight, reusable and easy to maintain.

---

# Responsibilities

The frontend may:

- Display data
- Render tables
- Render forms
- Handle routing
- Handle authentication flow
- Display notifications
- Validate simple UI input
- Communicate with the backend API

The frontend must NOT:

- Contain business rules
- Parse PDFs
- Calculate prices
- Process emails
- Perform database operations
- Contain duplicated logic

---

# Technology

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

---

# Components

Always prefer reusable components.

Before creating a component:

Search whether one already exists.

Never duplicate components with slightly different styling.

Extract common UI into shared components.

---

# Pages

Pages should remain thin.

Pages orchestrate components.

Pages do not contain business logic.

---

# State

Keep state local whenever possible.

Avoid global state unless necessary.

---

# API

Never hardcode API URLs.

Always use the API client.

Do not call fetch() throughout the application.

Use a centralized API layer.

---

# Forms

Forms should use reusable form components.

Validation should be shared whenever possible.

---

# Styling

Use Tailwind.

Avoid inline styles.

Maintain visual consistency.

---

# Error Handling

Always display meaningful error messages.

Gracefully handle loading states.

Gracefully handle empty states.

Gracefully handle API failures.

---

# Accessibility

Build accessible components.

Use semantic HTML.

Keyboard navigation should work.

---

# File Size

Component:
Prefer <200 lines

Page:
Prefer <250 lines

Split large components.

---

# Logging

Frontend logging should only help debugging.

Never log secrets.

Never log tokens.

Never log sensitive user data.

---

# Testing

Components should be easy to test.

Avoid unnecessary coupling.

---

# Goal

Build reusable UI.

Do not solve business problems in the frontend.