# In-progress solves: first-class starting, views & friend visibility

**Date:** 2026-07-27
**Status:** Approved

## Problem

Users can technically start a puzzle today, but only implicitly: the log-solve
dialog leaves a solve in progress when the End date field is left empty. There
is no first-class "Start puzzle" action, no dedicated view of in-progress
puzzles, and friends cannot see what a member is currently working on.

The domain layer already models all of this: the `Completion` aggregate is a
solve session with `start()` (in-progress, no end date), `finish()`, editable
start/end dates, and a `CompletionStarted` event. This feature is read-side
surfaces, one thin mutation, and a privacy setting — no domain changes.

## Requirements

- Explicit "Start puzzle" action; start date defaults to today, editable to
  past or future.
- Users see their own in-progress puzzles (completions page + dashboard).
- Friends (mutual followers, per the existing privacy model) can see what a
  user is working on — via the member profile and the activity feed.
- Friend visibility is gated by a per-user setting, **off by default**.
- Finishing uses the existing finish flow: completion date defaults to today,
  editable to past or future (already implemented).

## Design

### 1. Sharing preference

- `solvingPreferences` table gains `shareInProgress: v.optional(v.boolean())`.
  Absent = `false` (off by default) — no migration needed.
- Exposed via the existing federated settings pattern
  (`solving/adapters/solvingSettingsProvider.ts`) and a mutation following the
  `setTrackCompletionDuration` precedent.
- Toggle rendered in the solving settings UI.
- This single flag gates both friend-facing surfaces (profile section and
  activity-feed event).

### 2. Start action

**Backend:** new `packages/backend/convex/solving/startCompletion.ts`
composition root wrapping the existing `makeStartCompletion` use case
(currently only reachable via the `endDate === undefined` branch inside
`recordCompletion.ts`; that branch stays untouched for backward
compatibility).

- Args: `ownedPuzzleId`, `startDate` (epoch ms; past or future allowed),
  optional `notes`.
- Authorization identical to `recordCompletion`: owner **or** current holder
  (`heldBy`), so borrowed copies work.
- Publishes the existing `CompletionStarted` domain event through the standard
  event publisher.

**Web:** new `StartSolveDialog` component (pattern-match
`log-solve-dialog.tsx`): start date `<input type="date">` defaulting to
today, optional notes. A "Start puzzle" button appears next to the existing
"Log solve" trigger on the copy detail page (`copies/$id.tsx`), my-puzzles,
and borrowed pages. If the copy already has an in-progress solve, the button
shows **"Finish solve"** (opening the existing `FinishSolveDialog`) instead of
offering a duplicate start. The backend does not hard-block duplicates —
multiple solves remain legal in the domain.

### 3. My in-progress views

- **Completions page** (`completions/index.tsx`): split the existing list into
  an "In progress" section on top (reusing the existing Finish button) and the
  completed history below. Uses the data the page already loads.
- **Dashboard card** (`dashboard.tsx`): new query
  `packages/backend/convex/solving/listMyInProgress.ts` returning
  `InProgressSolveView[]` (see §5). Card shows thumbnail, title, piece count,
  "started N days ago", a Finish button, and an empty state linking to the
  puzzle library.

### 4. Friend visibility

Both surfaces are gated by the §1 setting.

- **Profile section:** `social/getPublicProfile.ts` gains a
  `currentlySolving` array in the _unlocked_ payload, populated only when
  `isSelf || target.shareInProgress`. The query already scans the member's
  completions and discards in-progress rows; instead it keeps up to 10 of
  them (most recently started first). Rendered as a "Currently solving"
  section in `components/members/profile-body.tsx`.
- **Activity feed:** add `"CompletionStarted"` to `FEED_EVENT_NAMES` in
  `social/getActivityFeed.ts` with **read-time preference filtering**:
  batch-load the distinct actors' `shareInProgress` preference and drop events
  from members who have not opted in. Read-time filtering means switching the
  setting off retroactively hides previously emitted "started" items. A new
  `ActivityKind` fans out to the domain social types, the feed renderer, and
  all three locale files (known enum sync-point).
- **No push notifications** — feed and profile only.

### 5. Contracts & gateway

- New `packages/contracts/src/solving/views.ts` with `InProgressSolveView`:
  completion id, puzzle title/thumbnail/pieceCount, `startDate`,
  `ownedPuzzleId`. Used by `listMyInProgress`.
- The profile's `currentlySolving` item shape is declared in the existing
  social contract (`contracts/src/social/social.ts`) to keep bounded contexts
  decoupled.
- Gateway: two new lines in the `solving:` block of
  `packages/gateway/src/operations.ts` (`startCompletion`,
  `listMyInProgress`).

### 6. Domain layer

**Zero changes.** `Completion.start()`, `finish()`, the
`endDate ≥ startDate` invariant, the in-progress-always-editable rule, and
`CompletionStarted` all exist and are covered by `completion.spec.ts`.

### 7. Testing

Backend `.test.ts` (convex-test, following `solvingMutations.test.ts`
conventions):

- `startCompletion`: creates an in-progress row (`isCompleted: false`, no
  `endDate`); accepts backdated and future start dates; rejects
  non-owner/non-holder; allows the borrower of a lent copy.
- `listMyInProgress`: returns only the caller's in-progress solves as DTOs.
- `getPublicProfile` gating matrix: setting off → `currentlySolving` absent
  even for mutual followers; setting on → present when profile unlocked;
  locked profile → absent; self always sees their own.
- Activity feed: `CompletionStarted` appears only for actors with
  `shareInProgress` enabled.

Web: extend meta/locale exhaustiveness tests where the new `ActivityKind`
requires it.

Verification: `pnpm arch:check`, `pnpm type-check`, `pnpm test`
(`--skip-nx-cache` to mirror CI), prettier on changed files before commit.

## Out of scope

- Push notifications for started puzzles.
- Timers / elapsed-time tracking beyond "started N days ago".
- Pausing or abandoning states (deleting the in-progress completion already
  covers abandonment).
- Reworking the existing log-solve dialog or its implicit start branch.
