# JigSwap — Add-Puzzle Redesign (Design Spec)

**Date:** 2026-06-13
**Branch:** `worktree-puzzle-import-from-url` (follow-on to the puzzle-import feature)
**Status:** Draft for review
**Design handoff:** Claude Design "JigSwap Application" → `addpuzzle.jsx`. Reference copied to
`docs/superpowers/design-reference/add-puzzle/` (component JSX + design tokens).

## Goal

Redesign the add-puzzle experience to match the handoff: a calm, two-column screen with a smart
URL-import zone, segmented/pill controls, a sticky **live-preview card**, and a readiness checklist.
Split into **two purpose-built flows** rather than one, and fold in the puzzle-import feature
(`extractFromUrl`) as the import zone.

## Locked decisions (from product)

| Decision    | Choice                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes      | **Both** add flows get the redesign, with **different purposes** (below)                                                                                                                                 |
| Dedup       | Handled in the **frontend with user confirmation** — "we found 'X', same or different?"                                                                                                                  |
| Cover image | v1: **cover-colour placeholder** (cosmetic). Future: **instance-level** custom photos (completed/box art) on `ownedPuzzleImages`, with a choice between the definition's global image and the user's own |
| Tokens      | **Map the design palette to the app's existing theme** (the handoff tokens already mirror the app's `--jigsaw-*` + shadcn base)                                                                          |

## The two flows

### A. `/my-puzzles/add` — "Add a Puzzle" (add to **my library**)

The full handoff screen. Purpose: get a puzzle I own into my collection, **finding an existing
catalog definition first**, or creating one if it doesn't exist, then acquiring a copy with
condition/availability.

Sections (top→bottom of the form column):

1. **Import from a Link** zone — paste a store URL → `gateway.catalog.extractPuzzleFromUrl`
   (the feature already built). On success, prefill + show "Imported from {brand}".
2. **Find existing** — search the catalog (`gateway.catalog.puzzleSuggestions` + own-pending) as the
   user types title/brand. If a candidate matches (by search **or** by the import's EAN/UPC via the
   draft's `match`), surface a **confirmation**: "We found **{title} · {brand} · {pieces}** already —
   is this the same puzzle?" with **Use this one** / **No, it's different**.
3. `or enter the details yourself` divider.
4. **Core details:** Puzzle Title, Brand (datalist of known brands), Piece Count (numeric +
   preset chips 300/500/750/1000/1500/2000), Difficulty (segmented pills w/ colour dots).
5. **Condition** (segmented: Excellent/Good/Fair/Poor) — _instance_ field.
6. **Availability** (multi-chip: For Trade / For Lend / For Sale) — _instance_ field.
7. `cover & extras` divider.
8. **Cover Colour** swatches + **Upload photo**; **Tags** (chip input); **Notes** (textarea).
9. **Footer:** `Add to Library` (primary), `Save & Add Another`, `Cancel`; disabled until
   title+brand+pieceCount present, with an inline hint.

Right column (sticky): **Live Preview** label → `PuzzleCard` (updates as you type) → caption →
**readiness checklist** (Title / Brand / Piece count / Availability).

**Submit ("Add to Library"):**

- If the user confirmed an **existing** match → `definitionId = match.aggregateId` (skip creation).
- Else → `gateway.catalog.createPuzzle({title, brand, pieceCount, difficulty, tags, ean?, upc?,
image?})` → returns the new `PuzzleDefinitionId` (pending moderation).
- Then `gateway.library.createOwned({ puzzleDefinitionId, condition, notes, acquisition? })`.
- Then, if any availability chip is on, `gateway.library.updateSharing({ copyId, visibility:
"visible", forTrade, forLend, forSale })`.
- `Save & Add Another` runs the same but resets the form instead of navigating.

### B. `/puzzles/add` — "Contribute a Puzzle" (catalog **definition only**)

Same visual language, **trimmed**: import zone + core catalog details (Title, Brand, Piece Count,
Difficulty, Tags, identifiers, cover/image) and the live preview — but **no** Condition,
Availability, Notes, and **no** copy acquisition. Purpose: contribute a definition to the shared
catalog without adding it to your own shelf. Submit = `createPuzzle` only (pending), then a success
state ("submitted for review"). The live preview shows the catalog card (no availability badge /
no instance bits).

## Component inventory (new, under `apps/web/src/components/add-puzzle/`)

Built with the app's shadcn primitives + theme tokens (NOT the handoff's inline styles verbatim):

- `add-puzzle-layout.tsx` — two-column responsive grid (form + 332px sticky preview, max-w 1080;
  collapses to single column on mobile, preview moving below or into a summary).
- `import-zone.tsx` — restyle of the existing `PuzzleImportBar` into the violet-tinted card; same
  `usePuzzleImport` hook + `extractFromUrl` action; emits draft/match to the host.
- `segmented-pills.tsx` — single-select pill row, optional leading colour dot (Difficulty,
  Condition).
- `availability-chips.tsx` — multi-select chips with check/plus icon and green active tint.
- `piece-count-field.tsx` — numeric input + preset chips.
- `cover-colour-field.tsx` — swatch row (gradient swatches) + dashed Upload-photo control.
- `tag-input.tsx` — chip tag editor (Enter to add, Backspace to remove).
- `live-preview.tsx` — adapts an existing `PuzzleCard` (`components/ui/puzzle-card.tsx` or
  `components/puzzles/puzzle-card.tsx`) + readiness checklist.
- `match-confirm.tsx` — the "we found 'X' — same or different?" banner.
- `section-divider.tsx` — labelled hairline divider.

Form state managed with the existing `react-hook-form` + zod pattern (extend
`puzzle-form-schema` or a new schema that adds condition/availability/notes/coverColor for flow A).

## Token mapping (design → app theme)

The handoff palette mirrors the app's tokens; map (don't duplicate names):

- `--jig-violet-{400,500,600}` → app primary / brand violet; `--jig-violet-50` → violet tint
  surface (import zone, selected chips).
- `--swap-green-{400,500,600,700}` + `-50` → success / available / availability-active.
- Difficulty dots: easy → green-400, medium → amber-400, hard → orange-500, expert → red-500.
- `--piece-pink-400`, `--amber-400`, `--orange-500` → cover swatches / accents.
- Surfaces/border/text → existing `--surface-card`, `--surface-muted`, `--border`,
  `--text-strong/body/muted` (or their app equivalents).

Audit `apps/web/src/styles/globals.css` first; add only the brand ramps that don't already exist as
CSS variables. Reuse the existing `--jigsaw-*` utilities where present.

## Backend

- **Flow A** composes existing gateway ops only — `catalog.createPuzzle`, `library.createOwned`,
  `library.updateSharing` — plus `catalog.extractPuzzleFromUrl` for import and
  `catalog.puzzleSuggestions` / `catalog.myContributedPuzzles` for find-existing. **No new backend
  required** if acquire-against-own-pending works (see Risks).
- **Flow B** = `catalog.createPuzzle` only (unchanged).
- **Cover colour:** v1 cosmetic — drives the preview, **not persisted**. Existing file upload
  (`library.generateUploadUrl`) still stores a real image when the user uploads one.

## Out of scope (v1)

- **Instance-level photos** and the definition-vs-custom image chooser — the explicit future
  direction. Will build on the existing `ownedPuzzleImages` table (copy → uploaded photos with
  tags box_front/box_back/completed) and add an "image source" choice on the copy. Tracked as a
  follow-up spec.
- Persisting cover colour.
- Changing the moderation model.

## Risks / open questions

1. **Acquire against own _pending_ definition.** Flow A creates a `pending` definition then
   immediately acquires a copy against its `aggregateId`. The current `/my-puzzles/add` comment
   notes pending puzzles aren't _searchable_, but acquisition keys on the known `aggregateId`, so it
   should work — **must verify** `library.createOwned` doesn't reject a pending/own definition. If it
   does, resolve before building flow A (small domain change, or acquire on approval).
2. **Token parity** — confirm the app's globals already define the violet/green ramps; fill gaps.
3. **PuzzleCard reuse** — pick the existing card that best matches the handoff's preview and adapt,
   rather than building a third.
4. **Mobile** — the handoff is desktop two-column; define the responsive collapse explicitly.

## Verification

- Unit: the new schema(s) + any pure mapping (draft→form, availability→sharing args).
- Component: form readiness gating, match-confirm branch, segmented/chip selection.
- Convex (`convex-test`): the Flow A submit composition if any new mutation is added (likely none).
- Manual: both flows end-to-end against dev — import, find-existing/confirm, create+acquire, the
  preview updating live, and Flow B contribution.
