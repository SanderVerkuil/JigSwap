# Brand/publisher/series autocomplete — design

Date: 2026-07-13
Status: approved pending user review

## Problem

`publisher`, `brand`, and `series` are deliberately free text (see
`2026-07-13-publisher-brand-series-design.md`), so "Jumbo", "jumbo" and "JUMBO"
diverge, and members must retype common values. Autocomplete was explicitly deferred
in that spec; this one adds it.

## Decisions (made with the user)

1. **Suggestion sources (hybrid)**:
   - Publisher: the domain `KNOWN_PUBLISHERS` allowlist (12 names) merged with
     distinct publisher values from approved catalog puzzles — useful from day one.
   - Brand and Series: distinct values from approved catalog puzzles only.
2. **Series scoping, with fallback**: when the form has a brand (or publisher, if
   brand is empty), series suggests distinct values among approved puzzles with that
   same maker; when no maker is set or the scoped list is empty, fall back to all
   distinct series values.
3. **All four definition forms** get autocomplete: `/puzzles/add`,
   `/my-puzzles/add/new`, member suggest-edit (`definition-fields.tsx`), and the
   admin edit-approve dialog.
4. **UI mechanism**: shadcn `Command` + `Popover` free-text combobox (both primitives
   already in `apps/web/src/components/ui/`). NOT native `<datalist>` (unstyleable,
   inconsistent across browsers) and NO new dependency.
5. **Branching**: stacked on `feat/publisher-brand-series` (PR #56); the PR targets
   that branch and is retargeted to main after #56 merges.

Fields stay free text everywhere: suggestions only fill the input; any typed value
remains valid. `artist` keeps a plain input (not requested; the component is
field-agnostic so it can be added later).

## Backend

Two new catalog queries following the `getAllBrands` pattern (distinct over an
index, approved puzzles only, public read):

- `packages/backend/convex/catalog/getAllPublishers.ts` — distinct over
  `by_publisher`, merged with the exported domain allowlist, deduped
  case-insensitively (canonical/allowlist casing wins), sorted alphabetically,
  `undefined` entries dropped. Returns `PublisherView[]` (= `string[]`).
- `packages/backend/convex/catalog/getAllSeries.ts` — args
  `{ brand?: string, publisher?: string }`. With a maker: query approved puzzles via
  `by_brand` (or `by_publisher` when only publisher given), collect distinct
  non-empty `series` values; if that yields nothing (or no maker was given), distinct
  over `by_series` instead. Returns `SeriesView[]`.

Domain: `KNOWN_PUBLISHERS` is currently module-private in
`packages/domain/src/catalog/domain/known-publishers.ts`; export it (as a readonly
array) alongside `matchKnownPublisher`.

Contracts: `PublisherView` and `SeriesView` type aliases next to `BrandView` in
`packages/contracts/src/catalog/views.ts`.

Gateway: `catalog.allPublishers`, `catalog.allSeries` next to the existing
`catalog.allBrands`/`allTags`.

Codegen: two new Convex function files ⇒ hand-edit
`packages/backend/convex/_generated/api.d.ts` (worktree has no deployment for
codegen), mirroring existing entries.

## Web

**One shared component** `apps/web/src/components/add-puzzle/suggest-input.tsx`
(colocated with the other shared field components that `definition-fields.tsx`
already imports):

- Props: `id`, `value`, `onChange(value: string)`, `placeholder`,
  `suggestions: readonly string[]` (plus aria/label passthrough as needed).
- Purely presentational — fetches nothing. Renders an `Input` inside a
  `Popover`+`Command`; the popover opens while typing when at least one suggestion
  matches, arrow keys + Enter pick a suggestion (calling `onChange` with it), Escape
  closes, clicking away closes. Typing always writes through to `onChange`
  unchanged — the input is the source of truth, suggestions never block a value.
- Matching: case-insensitive substring filter over the passed suggestions, exact
  current value excluded (no point suggesting what's already typed). Extracted as a
  pure helper `filterSuggestions(suggestions, query)` with a vitest spec.

**Consumers** (each fetches once via `convexQuery` and passes data down; Convex
reactivity keeps lists fresh; lists are small distinct values so no debounce or
server-side search):

- `/puzzles/add` and `/my-puzzles/add/new`: publisher, brand, and series inputs
  become `SuggestInput`s. The quick-add page's wrappers keep calling
  `setSelectedDefinitionId(null)` on change, exactly as today. Series queries pass
  `{ brand: form.brand || undefined, publisher: form.publisher || undefined }`.
- `suggest-edit/definition-fields.tsx`: same swap for its publisher/brand/series
  fields; the component keeps its controlled `set(key, value)` contract. The two
  pages that render it (member suggest-edit, admin direct edit) fetch the suggestion
  queries and pass them through new optional props (defaulting to empty arrays so
  the component stays usable without them).
- Admin edit-approve dialog (`edit-approve-dialog.tsx`): same swap for its
  publisher/brand fields (it has no series field today — leave that as is).

## Out of scope (deliberate)

- Autocomplete for `artist`, tags, or any non-definition field.
- Server-side/fuzzy search, popularity ranking, debouncing.
- Normalizing existing data (the migration in PR #56 covers publishers).
- Curated entity tables.

## Testing / verification

- Backend `.test.ts`: `getAllPublishers` (allowlist merged, data values included,
  case-insensitive dedupe prefers canonical casing, pending/rejected puzzles
  excluded); `getAllSeries` (scoped by brand, scoped by publisher, fallback when
  scope empty, fallback when no maker).
- Web vitest: `filterSuggestions` helper (substring, case-insensitive, excludes
  exact current value, empty query behavior).
- Manual: type in all four forms; verify picking a suggestion fills the field, free
  text still submits, and series suggestions narrow after entering a brand.
