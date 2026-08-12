# PDF Parser — implementation notes

Where the real transport orders disagree with `pdfParserRules.md` and
`parserLayouts.md`, the parser follows **the documents**. They are the only
primary source: they are what the business actually receives, and a rule that
contradicts them would fail on the first real import.

These contradictions are recorded here, not fixed in the business
documentation. Correcting those documents is a separate decision.

Fixtures: `docs/06-pdf/1page.pdf` (order 1212816), `2pages.pdf` (1352505),
`combination.pdf` (1212625).

---

## 1. A Combination's two trips do NOT share a booking number — RESOLVED

**Resolution.** The document won. `pdfParserRules.md`, `parserLayouts.md`,
`database_schema.md`, `database_model.md` and `TripService` have all been
corrected to state that each Trip keeps its own booking number and that the
TripGroup is what links the two legs. This entry is kept as the record of why.

**Documentation, as it read before the correction.** `pdfParserRules.md`:
*"Combination trips share the same Booking Number."* `parserLayouts.md`:
*"They share PDF, Booking Number, Trip Group."* `database_schema.md` §L367
encoded the same: *"All Trips in a group share the same `booking_number`."*

**The document.** `combination.pdf` states two different bookings — page 1
`DUBANR2598395` (delivery), page 2 `ANRBEL2603249` (collection). They are an
inbound and an outbound booking, which is what a combination is.

**Why the document wins.** Beyond being primary evidence, the Backend could not
accept the documented behaviour: `TripService` refuses a Trip whose booking
number is already held by an OPEN, CLOSED or CANCELLED Trip. If the two trips
shared a number, the second could never be imported.

**What the parser does.** Reads each page's booking independently and never
compares them. The two trips are related by a shared `groupKey` instead.

## 2. Address values are located by structure, not by the `Address:` label

**Documentation.** `parserLayouts.md` §Address Rules: *"Locate `Address` → Read
following lines → Stop at `Date/time` or `Remarks`."*

**The document.** `Address:` shares its row with the first address line *and*
with the `Remarks:` column, so "the lines following the label" is not a
well-defined set. In `2pages.pdf` the same column continues past the address
into `Loading Ref: 11554650` and a packing instruction.

**What the parser does.** Anchors on the section header (`LOADING 1:` /
`DELIVERY 1:`) and finds the `CC-postcode City` line, which matched all four
trips. The raw address stops at the postcode line, or at the country line when
one is printed.

## 3. `F-` and `FR-` both mean France

**Documentation.** `pdfParserRules.md` prints `FR-62119 DOURGES`;
`parserLayouts.md` prints `F-62119 DOURGES` for the same city.

**The document.** `1page.pdf` uses `F-62119 DOURGES`; `2pages.pdf` uses
`FR-59166 Bousbecque`. Both forms are real.

**What the parser does.** Both prefixes map to France, in one table:
`src/fields/country.ts`.

Also: three of four addresses print an explicit country line and one does not,
so the parser needs both sources. The printed line wins when present, and is
accepted only when it names a country the table knows — otherwise a remark
sitting in that column would be stored as a country.

## 4. `Trip type:` is not the trip's direction

**Documentation.** `pdfParserRules.md` lists "Trip Type" as a required field
meaning Normal or Combination.

**The document.** A field literally labelled `Trip type:` exists on the delivery
page with the value `Truck Standard` — a Eucon service level, unrelated to
Collection/Delivery or to Combination.

**What the parser does.** Ignores `Trip type:` entirely. Direction comes from
the `COLLECTION` / `DELIVERY` prefix of the `Bookings nr/Trip nr:` line, and
Combination from the `** COMBINATION **` page-header marker.

---

## Open business decision: terminal naming

Not a contradiction — a gap. The documents name one physical terminal three
ways: `PSA Quay 869` heading a four-line block on a collection, and `Quay 869`
beside `Terminal:` on a delivery. The Backend's route configuration uses
different names again (`PSA Antwerp`, `MSC PSA European Terminal`,
`DP World Antwerp Gateway`) and matches them by exact string equality.

The mapping is **not the parser's job** and no longer lives here. The parser
reports the terminal exactly as the document wrote it — `PSA Quay 869`,
`Quay 869` — normalized but never renamed, because only the Backend knows what
terminals its routes are configured under.

The Backend's import layer owns the translation, in
`apps/backend/src/pdf-import/terminal-mapping.ts`, and that table is
**deliberately empty**. Until the operator decides the pairs, an unmapped
terminal refuses the import with `IMPORT_UNKNOWN_TERMINAL` — a loud failure,
where a guess would be a quiet one that prices the trip against the wrong route.
