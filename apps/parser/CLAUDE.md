# PDF Parser Guidelines

## Purpose

The parser converts transport PDFs into structured JSON.

Nothing else.

---

# Responsibilities

Read PDF.

Extract information.

Return structured JSON.

Never modify the database.

Never call APIs.

Never perform business logic.

---

# Deterministic

The parser must always produce the same output for the same input.

No randomness.

No AI.

No OCR unless explicitly requested.

---

# Parsing

Support multiple layouts.

Each layout should have its own parser.

Avoid giant parser files.

Keep parsing rules isolated.

---

# Output

Always return structured JSON.

Never return formatted text.

---

# Validation

Validate extracted values.

Missing values should be NULL.

Never invent values.

---

# Debugging

Parser debugging is mandatory.

When a value is not found:

Explain why.

Show which parser was used.

Log the parsing process.

---

# Logging

Log:

- parser selected
- layout detected
- extracted values
- missing fields
- parser errors

---

# Extensibility

New PDF layouts should be easy to add.

Never break existing layouts.

---

# Goal

The parser should become increasingly robust over time.