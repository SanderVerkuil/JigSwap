# My-puzzles: in-progress indicator on puzzle cards

**Date:** 2026-07-27
**Status:** Approved
**Lands on:** `feat/in-progress-solves` (PR #66).

## Problem

The my-puzzles overview only exposes in-progress state through the filter
pill and the overflow menu's Start/Finish label — nothing on the card itself
shows that a puzzle is on the table.

## Design (approved)

When `PuzzleCard`'s existing `solveInProgress` prop is true, the card renders
the indicator in BOTH placements (user decision):

1. **Cover overlay chip** — on the puzzle image, following the existing
   loan-badge overlay pattern (sits above the stretched link), with the
   `Clock` icon + the existing `solving.completions.inProgress` label
   ("In progress" / nl "Bezig"). No new locale keys.
2. **Context badge row** — a `Badge` alongside the condition/availability
   badges, same label.

`PuzzleCard` renders both internally from the boolean — no page changes:
my-puzzles already passes `solveInProgress`; other `PuzzleCard` consumers
don't pass the prop (default false) and are unaffected.

Accepted edge: `solveInProgress` derives from
`inProgressCompletionId != null` (action-aligned since the Task 8c label
fix), so a legacy in-progress row lacking an `aggregateId` shows no badge —
consistent with the menu, which can't finish such rows either.

## Testing

Web `tsc` + lint (presentational; no behavioral test surface beyond type
inference). Visual check deferred to PR review (no browser automation in
this environment).

## Out of scope

Completed-state indicators; badges on browse/other card consumers.

## Revision (same day, user decision)

1. **Card placement narrowed to overlay-only**: the context-row badge added in
   `1c57536f0` is REMOVED — the cover-overlay chip alone carries the state
   ("a bit double; just in the image is good enough").
2. **Copy detail page** (`CopyInstanceScreen`, serving `/my-puzzles/<id>` and
   `/copies/<id>`): when the caller has an in-progress solve on the copy
   (the existing owner-gated `myInProgress` selector), the hero's badge row
   (~line 412, rounded-full secondary badges) gains an "In progress" badge —
   `Clock` icon + the same `solving.completions.inProgress` key, matching
   sibling badge styling. Owner-scoped (the underlying query is gated to
   `viewerIsOwner` by an earlier review fix); borrower-facing state on
   `/copies/<id>` stays out of scope.
