# Completion follow-up: review + photos prompt, finish-instead, card polish

**Date:** 2026-07-27
**Status:** Approved (revised after adversarial review, same day)
**Lands on:** `feat/in-progress-solves` (PR #66).

## Requirements (user decisions recorded)

1. After registering a COMPLETED solve (finish flow or record-immediately
   flow), prompt once with a combined, skippable dialog: review (rating +
   text) AND optional photos of the completed puzzle.
2. Completion photos go through the NSFW moderation pipeline NOW, even
   though they remain self-facing.
3. Registering a completion for a copy the caller has in progress finishes
   the existing solve instead — at ALL record entry points. **Decision:**
   pages that already have a Start/Finish action HIDE their "Log solve"
   action while in progress (one Finish button); the resulting inability to
   backfill a separate past solve while another is open is ACCEPTED.
4. `/completions/new` cards use `imageFit="contain"`. The 44px thumbnails
   (completions rows, dashboard "Solving now", profile "Currently solving")
   switch to `object-contain` **with `bg-muted` + border backing** (decision:
   contain-with-backing). Completions rows additionally get the import-flow
   hover-expand (Tooltip with large contain preview).

## Design

### 1. `CompletionFollowUpProvider` (combined dialog)

- New provider + context mounted once in the dashboard shell next to
  `DurationPromptProvider`, exposing `requestFollowUp(completionId: string)`.
  **First-wins:** calls while the follow-up is open or pending are ignored
  (the completions-row Review button is the fallback). No-provider stub
  no-ops.
- Dialog: star rating + review textarea (submits `gateway.solving.reviewPuzzle`
  when rating ≥ 1 — the review path has NO edit window, verified), and a NEW
  multi-file photo picker (reusing `FileUpload`'s compressorjs settings —
  `FileUpload` itself is a single-file RHF field and is NOT reused as-is),
  client cap `min(5, 5 − existing photo count)`; local previews. Save and
  Skip. Review and photos are independent.
- Photo save: uploads in PARALLEL (`Promise.allSettled` of per-file
  grant→POST via `gateway.library.generateUploadUrl` — verified auth-gated
  and context-neutral), then ONE `attachCompletionPhotos` call. Partial
  failure: dialog stays open, failed thumbnails marked, Retry re-uploads
  failures only (successful storageIds retained); attach failure retries
  attach only; dismissal disabled while saving. Blobs orphaned by
  abandoning after upload are ACCEPTED (exact parity with the copy flow;
  no storage GC exists — noted, sweep out of scope). Domain `TooManyPhotos`
  maps to a friendly message, not the generic error.
- Triggers:
  - `FinishSolveDialog` success → `requestFollowUp(completionId)`. The
    dialog gains `onSuccess?: () => void`; ordering mirrors log-solve:
    `requestFollowUp` → `onSuccess` → `onOpenChange(false)` (provider-owned
    modal survives unmount/navigation — verified pattern).
  - `LogSolveDialog` completed-record success: capture `recordCompletion`'s
    returned completionId → follow-up. In-progress saves never trigger it.
- **Modal sequencing (never stack):** duration first-choice prompt →
  `offerUpdateCopy` (when pieces missing) → follow-up, one at a time.
  `requestPrompt` gains `onDone?: () => void` fired exactly once through a
  ref-guarded `finish()` called from BOTH the choice handler and the
  `onOpenChange(false)` path (double-fire and never-fire paths verified);
  when `requestPrompt` self-suppresses (already answered) it invokes
  `onDone` synchronously; the no-provider stub becomes `(onDone) => onDone?.()`.
- i18n: new `solving.followUp` namespace ×3 (all-locale parity), reusing
  `solving.review` labels where sensible.

### 2. Completion photos with moderation

- Schema: `completionImages` table — `completionId` (Solving aggregateId
  string; idiomatic for this context), `uploaderId: v.id("users")`,
  `fileId: v.id("_storage")`, optional `moderationStatus`
  (pending/approved/rejected; absent = legacy approved), optional
  `moderationScore`/`moderationLabel` (auditability; also lets score-less
  fail-open approvals be re-moderated before any future sharing), `createdAt`,
  `updatedAt`. Indexes: `by_completion` (["completionId"]),
  `by_moderation_status` (["moderationStatus"], for a future admin queue).
  NO `by_file` (the read joins via one `by_completion` query per row;
  by_file would also break across the moderation fileId swap).
- **Domain: new `attachPhotos` path** (NOT the edit path — the 24h edit
  window anchors on `endDate ?? updatedAt`, so any backdated completion is
  closed at creation; verified breaker). `Completion.attachPhotos(actor,
photos, now)`: owner check + MAX_PHOTOS cap across existing+new, NO
  window (photo attach is additive, not revisionist). New in-port + use case
  `makeAttachCompletionPhotos`; emits no new event kinds (`CompletionEdited`
  is verified consumer-safe, reuse it or none — implementer's call, spec
  requires no feed/notification side effects).
- Mutation `solving/attachCompletionPhotos.ts`: args
  `{ completionId: v.string(), storageIds: v.array(v.id("_storage")) }`
  (validator-typed ids), author-only, DEDUPES storageIds within the
  completion, then: domain attach → insert sidecar rows (`pending`) →
  schedule moderation per photo.
- **Moderation clone with the fileId-swap obligation:** a
  `solving/moderateCompletionPhoto` internal action + store pair patterned
  on `library/moderatePhoto`/`moderationStore`, keeping the re-encode step
  (EXIF/GPS stripping is part of the point). The store's approve-with-swap
  mutation atomically patches the sidecar's `fileId` AND swaps old→new
  inside the `completions` row's `photos` array (direct system `db.patch`,
  deliberately outside the domain path — commented as such). On REJECTION:
  drop the id from `completions.photos` (frees the cap slot), delete the
  blob, keep the sidecar row for audit; stamp the existing
  `photo_auto_rejected` moderation-action kind (already in schema/KIND_META
  — NO enum fan-out; verified), with a completion-appropriate targetLabel.
  Fails open like the copy pipeline (accepted for self-facing content).
- **Close the bypass:** remove the dormant `photos` args from the public
  `editCompletion` and `recordCompletion` mutations (zero client callers —
  verified; adjust any backend tests that used them). The domain command
  fields stay (used by the attach use case). "Absent sidecar = legacy
  approved" is then safe: no unmoderated write path remains.
- `deleteCompletion` composition root: after the domain delete, cascade —
  delete `completionImages` rows via `by_completion` and best-effort
  `ctx.storage.delete` each referenced blob (mirrors `removeCopyPhoto`).
- Read filter (`listMyCompletions` + `getCompletionHistory` photo
  resolution): exclude REJECTED only — pending stays visible (self-facing
  lists are always the uploader; matches the copy-gallery
  pending-visible-to-uploader precedent); absent sidecar = legacy included.
- Gateway line + `api.d.ts` registration for the new modules.
- Known/accepted: the admin REVIEW QUEUE is `ownedPuzzleImages`-typed and
  will not show completion photos (they DO appear in the admin activity log
  via the stamp); no uploader notification on auto-reject (copy parity).

### 3. Finish-instead at all record entry points

- `/completions/new`: add `myCompletions` + the `solveStateByCopyId`
  selector; `handleSelect` opens `FinishSolveDialog` (`completionId`,
  `minEndDate`, `onSuccess` → navigate to `/completions`) when in-progress,
  else `LogSolveDialog`. The follow-up modal opening over the freshly
  navigated route (toast + route change + modal) is deliberate.
- my-puzzles / copy page / borrowed: while the caller has an in-progress
  solve on the copy, HIDE the "Log solve" action (the existing Start/Finish
  swap button is the single completion affordance). No LogSolveDialog or
  backend changes.

### 4. Cards & thumbnails

- `completions/new.tsx`: `imageFit="contain"` on `PuzzleCard`.
- 44px thumbnails in `completions/index.tsx`,
  `dashboard-home/solving-now-section.tsx`, `members/profile-body.tsx`:
  `object-contain` with `bg-muted` + a subtle border (per decision), keeping
  the rounded shape legible under letterboxing.
- Completions rows hover-expand: `TooltipProvider` (delay ~200) with the
  trigger being a **`Link` to `hrefForLink(completion.link)`** (same target
  as the title), `relative z-10` above the stretched-link overlay, with an
  aria-label ("View {title}") — clicking the thumbnail keeps navigating (it
  did before via the overlay), keyboard focus reaches the trigger and shows
  the preview; the extra tab stop per row is accepted. Rows WITHOUT a `link`
  render the plain thumbnail under the overlay, no trigger. `TooltipContent`
  `side="top"` with `max-h-[280px] max-w-[260px] rounded-md object-contain`
  image (portals at z-50 — no stacking conflict; verified).

### 5. Testing

Backend (following the ESTABLISHED moderation-test pattern — do NOT drain
the node action; env-less drains fail open and can never produce
"rejected"):

- `attachCompletionPhotos`: author-only; dedupe; 5-cap across existing+new
  (6th → domain error); BACKDATED completion (endDate last week) attach
  SUCCEEDS (pins the window-free path); sidecar rows pending; moderation
  job scheduled (assert via `_scheduled_functions`, like
  `addCopyPhoto.test.ts`).
- Verdict store mutations called DIRECTLY (internal): approve-with-swap
  patches sidecar fileId AND the completions.photos entry; reject drops the
  id from photos, deletes the blob, stamps `photo_auto_rejected`.
- Photo read filter: sidecar statuses inserted explicitly — rejected
  excluded, pending included, absent (legacy) included.
- `deleteCompletion` cascades sidecars + blobs.
- `editCompletion`/`recordCompletion` no longer accept `photos` (existing
  tests adjusted).
- Existing suites stay green.

Web: tsc/lint/meta test; flows via PR preview.

## Out of scope

- Displaying completion photos beyond the uploader; admin review-queue
  support for completion photos (activity-log visibility only); uploader
  notifications on auto-reject; periodic orphaned-storage sweep;
  re-moderation of score-less legacy approvals (precondition noted for any
  future sharing); backend enforcement of finish-instead; review editing in
  the follow-up.
