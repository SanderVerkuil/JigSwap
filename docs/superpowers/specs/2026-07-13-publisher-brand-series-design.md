# Publisher vs. brand vs. series — design

Date: 2026-07-13
Status: approved pending user review

## Problem

Puzzle definitions have a single free-text `brand` field, and it currently mixes two
different real-world concepts:

- the **publisher** (the company): Jumbo, Ravensburger, Falcon, Schmidt
- the **brand / product line**: Jan van Haasteren, Wasgij

A Jan van Haasteren puzzle is published by Jumbo, may be drawn by Jan van Haasteren or
Wilma van den Bosch (the `artist` field), and belongs to a series such as Standard or
Junior. Wasgij similarly has Original / Mystery / Destiny series. Because both meanings
land in `brand`, the data is ambiguous and inconsistent.

## Decisions (made with the user)

1. **Structure**: stay free-text with guidance (labels, placeholders, help text). No
   curated entities, no autocomplete for now.
2. **Semantics**:
   - `publisher` _(new field)_ — the company.
   - `brand` _(existing, meaning narrowed)_ — the product line. Left empty when the
     puzzle has no distinct line (e.g. a plain Ravensburger puzzle has publisher
     "Ravensburger" and no brand).
   - `series` and `artist` keep their current meaning.
3. **Migration**: one-time "move known publishers" migration. A case-insensitive
   allowlist of publisher names; matching `brand` values move to `publisher` and
   `brand` is cleared. Everything else is left untouched.
4. **Full form**: `publisher` joins the key-info section next to `brand`.
5. **Quick-add wizard** (`/my-puzzles/add`): the single required Brand field becomes an
   optional **Publisher** field plus an optional **Brand** field. (Amended 2026-07-13:
   publisher was initially required; the user decided both maker fields stay optional —
   only title and piece count gate submission.)

## Data model

- `puzzleDefinitions` (`packages/backend/convex/schema.ts`): add
  `publisher: v.optional(v.string())` and a `by_publisher` index (mirrors `by_brand`).
- `proposalFields` (same file): add `publisher` so suggest-edit change proposals can
  propose it (applies to both `changes` and `baseline`).
- Domain (`packages/domain/src/catalog/...`): `publisher` joins
  `PuzzleDefinitionState` / creation props / `PuzzleDefinitionChanges`, the create and
  update use cases, and the change-proposal field set.
- **Search**: `PuzzleDefinition.searchableText()` adds `publisher` to the projection
  (title, brand, artist, series, tags). Without this, migrated puzzles would stop
  matching searches like "ravensburger".
- **Denormalized copies stay brand-only** (deliberate): owned-puzzle `snapshot`,
  `puzzleImportCache.draft`, completion-log fields. These are display caches, not
  sources of truth.

## Migration

Internal Convex mutation, run once per deployment:

- Allowlist (case-insensitive, trimmed): Jumbo, Ravensburger, Falcon, Schmidt, Heye,
  Clementoni, Educa, Trefl, King, Castorland, Eurographics, Gibsons. Easy to extend
  before running.
- For each puzzle definition whose `brand` matches: set `publisher` to the canonical
  casing from the allowlist, clear `brand`, and **recompute `searchableText`**.
- Skip rows that already have a `publisher` (idempotent, safe to re-run).
- **Dry-run mode first**: reports which rows would change (title, old brand → new
  publisher) without writing, so the result can be eyeballed before committing.
- The pure allowlist/matching logic lives in the domain and gets a `.spec.ts` unit
  test (project test convention).

## UI

**Full form** (`apps/web/src/components/forms/puzzle-form/`):

- `publisher` field in the key-info grid next to `brand`.
- Placeholders/help text carry the distinction: publisher "Jumbo, Ravensburger…",
  brand "Jan van Haasteren, Wasgij…" plus a hint that brand can stay empty when the
  line and the company are the same.
- Zod schema: `publisher: z.string().max(50).optional()`.

**Quick-add wizard** (`apps/web/src/components/add-puzzle/`):

- Required `brand` field becomes optional `publisher` (new label and
  placeholder).
- New optional `brand` field below/next to it.
- The create path (library createOwned → catalog definition creation) passes both.

**Suggest-edit** (`apps/web/src/components/suggest-edit/`): `publisher` joins
`definition-fields.tsx` and `proposal-diff.ts` (+ its test).

**Display**: the puzzle detail page's details section shows Publisher alongside Brand /
Artist / Series. Cards and other brand usages are unchanged.

**Locales**: labels, placeholders, and help text added to all three locale files.

## Out of scope (deliberate)

- Curated publisher/brand entities or autocomplete.
- A publisher filter in catalog filters.
- Updating denormalized brand caches or backfilling them.
- Renaming the stored `brand` column.

## Testing / verification

- Domain unit tests: migration matcher (`.spec.ts`), `searchableText()` includes
  publisher, update use case accepts publisher changes.
- Backend tests (`.test.ts` at `convex/` root): create/update with publisher,
  migration dry-run and real run against seeded rows.
- `proposal-diff.test.ts` extended for the new field.
- Manual: add a puzzle via both flows; search for a migrated publisher name; propose a
  publisher edit via suggest-edit.
