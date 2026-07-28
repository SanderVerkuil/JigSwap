# In-progress solves: first-class starting, views & friend visibility

**Date:** 2026-07-27
**Status:** Approved (revised after adversarial review, same day)

## Problem

Users can technically start a puzzle today, but only implicitly: the log-solve
dialog leaves a solve in progress when the End date field is left empty. There
is no first-class "Start puzzle" action, no dedicated view of in-progress
puzzles, and friends cannot see what a member is currently working on.

The `Completion` aggregate already models a solve session with `start()`
(in-progress, no end date), `finish()`, editable start/end dates, and a
`CompletionStarted` event. This feature is read-side surfaces, one thin
mutation, and a privacy setting.

## Requirements

- Explicit "Start puzzle" action; start date defaults to today, editable to
  past or future.
- Users see their own in-progress puzzles (completions page + dashboard).
- **Friends — strictly mutual followers — can see what a user is working on**,
  via the member profile and the activity feed. Never anonymous visitors,
  never one-way followers (decided in review; see §4).
- Friend visibility is gated by a per-user setting, **off by default**, and
  every gate tests `shareInProgress === true` (the preference pattern is
  tri-state; absent/undefined must behave as off).
- Finishing uses the existing finish flow: completion date defaults to today,
  editable to past or future (already implemented).

## Design

### 1. Sharing preference

- `solvingPreferences` table gains `shareInProgress: v.optional(v.boolean())`.
  Absent = off — no migration needed.
- Follows the `setTrackCompletionDuration` precedent end-to-end, which means
  **additive domain changes** (see §6): a `shareInProgress` field + getter +
  setter on the `SolvingPreferences` entity
  (`packages/domain/src/solving/domain/solving-preferences.ts`), a
  `set-share-in-progress` use case + in-port, the repository mapper, and
  `solving/adapters/solvingSettingsProvider.ts`.
- Toggle rendered in the solving settings UI. **Toggle copy must state the
  retro-exposure** (decided in review): enabling it also surfaces puzzles the
  user already started — e.g. "Friends can see which puzzles you're working
  on, including ones you've already started."
- One flag gates both friend-facing surfaces (§4). All gates compare
  `=== true`; an absent preferences row means hidden.

### 2. Start action

**Backend:** new `packages/backend/convex/solving/startCompletion.ts`
composition root wrapping the existing `makeStartCompletion` use case
(currently only reachable via the `endDate === undefined` branch inside
`recordCompletion.ts`; that branch stays untouched for backward
compatibility).

- Args follow the existing `recordCompletion` convention: `copyId` (Library
  aggregateId), `startDate` (epoch ms; past or future allowed), optional
  `notes`.
- Authorization: copy the resolve-and-check block from
  `recordCompletion.ts:41-52` — resolve via `by_aggregate_id`, require
  owner **or** current holder (`heldBy`), identity from `requireMember`.
- **Must replicate the post-persist denormalization** from
  `recordCompletion.ts:101-122` (`puzzleId` patch + `copySnapshot` write) —
  extract that block into a shared helper used by both roots. Without it,
  started rows have no title/pieceCount source and every downstream view
  degrades (review blocker).
- Publishes the existing `CompletionStarted` domain event through the standard
  event publisher.

**Web:** new `StartSolveDialog` component (pattern-match
`log-solve-dialog.tsx`): start date `<input type="date">` defaulting to
today, optional notes. Submit button disables while the mutation is pending.

"Start puzzle" appears next to the existing "Log solve" trigger on the copy
detail page (`copies/$id.tsx`), my-puzzles, and borrowed pages. If **the
caller** has an in-progress solve on that copy (not "the copy has one" —
finish authorization is author-only, so a borrower's solve must not flip the
owner's button), the button shows **"Finish solve"** opening the existing
`FinishSolveDialog`, targeting the caller's most recently started in-progress
solve; rows lacking `aggregateId` (legacy) can't open the dialog — mirror the
guard at `completions/index.tsx:304`.

Per-page wiring:

- my-puzzles already builds `solveStateByCopyId` from `myCompletions`; it must
  additionally retain the in-progress row's `aggregateId` for the dialog.
- The borrowed page loads **no completion data today**; it must additionally
  query `myCompletions` and join on `loan.copyDocId`, skipping the
  `copyDocId === ""` rows `loanReadViews.ts` emits when the copy is gone.

Duplicate starts: the backend does not hard-block them (multiple solves stay
legal in the domain). Cross-device races can therefore produce two in-progress
rows for one copy — **accepted**: both appear in the in-progress views and are
independently finishable/deletable. Not a bug.

Future start dates are allowed but need care:

- `finish()` rejects `endDate < startDate` — pass the row's `startDate` into
  `FinishSolveDialog`, set it as the date input's `min`, and map the domain
  error to a specific message (today it's a generic error toast).
- Relative-time copy clamps: "starts in N days" / "started today" instead of
  "started −N days ago".
- Rows with `startDate > now` are **excluded from friend-facing surfaces**
  (profile + feed rendering keeps event order untouched); a friend seeing
  "currently solving" something unstarted is wrong.

### 3. My in-progress views

All in-progress reads filter on **`isCompleted === false`**, never on
`endDate === undefined` — `edit()` can attach an `endDate` to a
still-in-progress row; `isCompleted` is authoritative (only `finish()` flips
it).

- **Completions page** (`completions/index.tsx`): split the existing
  client-side list into an "In progress" section on top (ordered `startDate`
  desc; reusing the existing Finish button) and the completed history below.
  No new data needed — `listMyCompletions` already returns in-progress rows.
- **Dashboard**: the dashboard is deliberately card-free (whitespace-separated
  blocks) — build a section component in
  `apps/web/src/components/dashboard-home/` following the `SectionHead`
  pattern, not a boxed Card. Backed by a new query
  `packages/backend/convex/solving/listMyInProgress.ts` returning
  `InProgressSolveView[]` (§5): thumbnail, title, piece count, clamped
  "started N days ago", a Finish button, and an empty state linking to the
  puzzle library.
- **New index**: `completions.by_user_completed: ["userId", "isCompleted"]` in
  `schema.ts`; `listMyInProgress` queries
  `.withIndex("by_user_completed", q => q.eq("userId", me).eq("isCompleted", false)).order("desc")`.
  The `by_user` precedent would scan a power user's full history on every
  dashboard load and re-subscribe on any completion edit; composite
  user+boolean precedent exists (`goals.by_user_active`). Convex indexes are
  additive, no backfill.
- **Display-data fallback chain** (copy deletion never cascades to
  completions; `ownedPuzzleId` can dangle): live copy → `copySnapshot` →
  `puzzles` row → placeholder title. Finish/abandon actions keep working — the
  finish use case checks authorship only, no copy needed. Same chain applies
  to the profile section (§4).

### 4. Friend visibility

Both surfaces gate on the actor's `shareInProgress === true`. "Friend" means
**mutual follow**, enforced at read time on both surfaces (decided in
review).

- **Profile section:** `social/getPublicProfile.ts` gains a
  `currentlySolving` array populated only when
  `isSelf || (isMutual && shareInProgress === true)` — **not** merely
  `unlocked`: the query is unauthenticated and profiles default to public, so
  the unlocked payload alone would expose real-time solving activity to
  anonymous visitors. `isMutual` requires an authenticated viewer, which
  excludes anonymous traffic for free. Self always sees their own.
  Data comes from a separate small indexed read
  (`by_user_completed`, `isCompleted === false`, `.order("desc")`, cap 10) —
  the existing `.take(2000)` scan takes the _oldest_ rows and could miss the
  newest starts. Future-dated rows excluded (§2). Rendered as a "Currently
  solving" section in `components/members/profile-body.tsx`.
- **Activity feed:** add `"CompletionStarted"` to `FEED_EVENT_NAMES` in
  `social/getActivityFeed.ts` with read-time filtering:
  - For `CompletionStarted` entries that **passed the audience filter** (never
    for all 500 raw events), batch-load per distinct actor — matching the
    existing `resolveActorName` `Promise.all` pattern; `solvingPreferences`
    has a `by_member` index — both the `shareInProgress` preference **and**
    `areMutualFollowers(viewer, actor)`; drop entries failing either. The
    viewer's own events are exempt.
  - Filtering happens **before** `buildActivityFeed`'s limit slice, so pages
    are never short.
  - Read-time filtering means switching the setting off retroactively hides
    previously emitted items. The opt-in direction retro-exposes up to the
    90-day feed window of historical starts (the implicit start path has been
    recording `CompletionStarted` all along) — **accepted** (decided in
    review), covered by the §1 toggle copy.
  - Accepted, documented limitations inherited from the feed: the global
    per-name 500 cap can starve small audiences (the file's own finding #7 —
    made stricter here by the opt-in rate; a per-actor `domainEvents` index is
    out of scope), and abandoning a solve (deleting the completion) leaves the
    "started" feed item for the remainder of the window, consistent with
    `CompletionRecorded` after deletion.
- **New `ActivityKind` fan-out** — the full, exact sync list (review blocker:
  the renderer crashes on unknown kinds):
  1. `packages/domain/src/social/domain/activity-feed.ts` — the union.
  2. `packages/contracts/src/social/social.ts` — `ActivityEntryView.kind`.
  3. `packages/backend/convex/social/getActivityFeed.ts` —
     `FEED_EVENT_NAMES`, the kind-mapping switch, the new filter.
  4. `apps/web/src/components/social/activity-feed.tsx` — locally re-declared
     union + `META` + `activity.<kind>.{you,other}` locale keys. **Must be
     made defensive: skip entries whose kind has no `META` entry** (Convex
     deploys before web bundles; old clients must not crash).
  5. `apps/web/src/components/dashboard-home/pulse-section.tsx` — second
     renderer the original spec missed; needs `dashboard.pulse.latest.<kind>`
     keys and the same defensive skip.
  6. `apps/web/locales/{en,nl,source}.json` — both namespaces, all three
     files.
     A feed-kind exhaustiveness test does not exist and **must be created**,
     patterned on `notification-meta.test.ts`.
- **No push notifications** — feed and profile only.

### 5. Contracts & gateway

- New `packages/contracts/src/solving/views.ts` (+ barrel `index.ts`,
  export from `contracts/src/index.ts`, matching the library/catalog layout)
  with `InProgressSolveView` for the owner-facing dashboard read: completion
  aggregateId, title, pieceCount, `startDate`, thumbnail URL, `copyId`.
- The profile's `currentlySolving` item shape is declared in the existing
  social contract (`contracts/src/social/social.ts`) and is **exactly**:
  `title`, `pieceCount`, `startDate`, optional catalog thumbnail URL.
  **Explicitly excluded: `notes`, `photos`, any copy/completion ids** —
  in-progress rows can carry notes and photos, and nothing else prevents an
  implementer from spreading the row. Thumbnails always come from the catalog
  `puzzles.image` (via `storage.getUrl`), never from the completion's photo
  uploads. Note `copySnapshot` has no image field, so the thumbnail requires
  the `puzzles` join; it is only served to authenticated mutual followers
  (§4 gate) or self.
- Gateway: three new lines in the `solving:` block of
  `packages/gateway/src/operations.ts` (`startCompletion`,
  `listMyInProgress`, `setShareInProgress`).

### 6. Domain layer

**No changes to the `Completion` aggregate** — `start()`, `finish()`, the
`endDate ≥ startDate` invariant, the in-progress-always-editable rule, and
`CompletionStarted` all exist and are covered by `completion.spec.ts`.

Additive domain changes elsewhere (the original "zero domain changes" claim
was refuted in review):

- `packages/domain/src/solving`: `SolvingPreferences` gains the
  `shareInProgress` field + `set-share-in-progress` use case/port (§1).
- `packages/domain/src/social`: `ActivityKind` union gains the new literal
  (§4).

### 7. Testing

Backend `.test.ts` (convex-test, following `solvingMutations.test.ts`
conventions):

- `startCompletion`: creates an in-progress row (`isCompleted: false`, no
  `endDate`, **with `copySnapshot` and `puzzleId` denormalized**); accepts
  backdated and future start dates; rejects non-owner/non-holder; allows the
  borrower of a lent copy.
- `listMyInProgress`: returns only the caller's in-progress solves as DTOs;
  handles a deleted copy via the fallback chain.
- `getPublicProfile` gating matrix: **anonymous viewer on a public profile
  with sharing on → absent** (the cell the original spec missed); absent
  preferences row → absent; setting off → absent even for mutual followers;
  setting on + mutual follower → present; setting on + non-mutual authenticated
  viewer on a public profile → absent; locked profile → absent; self always
  sees their own; future-dated rows excluded.
- Activity feed: `CompletionStarted` appears only when the actor has
  `shareInProgress === true` **and** is a mutual follower of the viewer;
  viewer's own starts always appear; page is full-length when opted-out
  actors' events are dropped (filter-before-slice).

Web: create the feed-kind exhaustiveness test (META + both locale namespaces
cover every `ActivityKind`); verify unknown kinds render as skipped, not
crashed.

Verification: `pnpm arch:check`, `pnpm type-check`, `pnpm test`
(`--skip-nx-cache` to mirror CI), prettier on changed files before commit.

## Out of scope

- Push notifications for started puzzles.
- Timers / elapsed-time tracking beyond "started N days ago".
- Pausing or abandoning states (deleting the in-progress completion covers
  abandonment; the residual feed item is documented in §4).
- Reworking the existing log-solve dialog or its implicit start branch.
- A per-actor `domainEvents` index (`actorId` + `by_actor_and_time`) — the
  feed's global-cap limitation is accepted and tracked in
  `getActivityFeed.ts`'s own comments.
- Fixing the pre-existing `edit()` wart where an in-progress row can carry an
  `endDate` (reads key on `isCompleted`, so behavior is correct).
