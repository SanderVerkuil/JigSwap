# Completion follow-up: review + photos prompt, finish-instead, card polish

**Date:** 2026-07-27
**Status:** Approved (pending adversarial review)
**Lands on:** `feat/in-progress-solves` (PR #66).

## Requirements (user decisions recorded)

1. After registering a COMPLETED solve (finish flow or record-immediately
   flow), prompt once with a combined, skippable dialog: review (rating +
   text) AND optional photos of the completed puzzle.
2. Completion photos go through the NSFW moderation pipeline NOW (decision:
   "wire moderation now"), even though they remain self-facing.
3. Registering a completion for a copy the caller has in progress finishes
   the existing solve instead — at ALL record entry points (completions/new,
   my-puzzles, copy page, borrowed).
4. `/completions/new` cards use `imageFit="contain"`; the 44px thumbnails
   (completions rows, dashboard "Solving now", profile "Currently solving")
   switch to `object-contain`; completions rows additionally get the
   import-flow hover-expand (Tooltip with large contain preview).

## Design

### 1. `CompletionFollowUpProvider` (combined dialog)

- New provider + context, mounted once in the dashboard shell next to
  `DurationPromptProvider` (`routes/_dashboard/route.tsx`), exposing
  `requestFollowUp(completionId: string)`. Consumer hook no-ops outside the
  provider (mirror `duration-prompt-provider.tsx`).
- The dialog: title/description ("Completion saved — how was it?"), star
  rating + review textarea (submits via existing `gateway.solving.reviewPuzzle`
  when rating ≥ 1), a photo picker (multiple, up to 5, client-compressed via
  the existing `FileUpload`/compressor pieces, local previews), Save and Skip.
  Save uploads photos through `gateway.library.generateUploadUrl` + POST
  (the copy-gallery pipeline) then calls `attachCompletionPhotos` (§2);
  review and photos are independent — either may be empty.
- Triggers:
  - `FinishSolveDialog` success → `requestFollowUp(completionId)` (it has the
    id as a prop).
  - `LogSolveDialog` success WHEN `endDate` was set (completed record):
    capture `recordCompletion`'s returned `completionId` (currently
    discarded) → `requestFollowUp(id)`. In-progress saves never trigger it.
  - Ordering with existing post-save prompts in `LogSolveDialog`:
    `requestPrompt` (duration first-choice) gains an optional `onDone`
    callback invoked when its dialog closes (answered or dismissed); when the
    duration prompt fires, the follow-up is requested from `onDone`;
    otherwise directly. The `offerUpdateCopy` secondary dialog is unaffected
    (it only fires for pieces-missing, and may coexist).
- i18n: new `solving.followUp` namespace ×3 (title, description, photos
  section label/hint, addPhotos, save, skip, saved, saveError; rating/text
  labels reuse `solving.review` keys where sensible or duplicate under
  followUp — implementer picks the cleaner, spec requires all-3-locale
  parity).

### 2. Completion photos with moderation

- Schema: new `completionImages` table mirroring `ownedPuzzleImages`'s
  moderation-relevant shape: `completionId` (Solving aggregateId string),
  `uploaderId: v.id("users")`, `fileId: v.id("_storage")`,
  `moderationStatus` optional union (pending/approved/rejected; absent =
  legacy approved), `createdAt`, `updatedAt`; indexes `by_completion`
  (["completionId"]) and `by_file` (["fileId"]).
- New mutation `packages/backend/convex/solving/attachCompletionPhotos.ts`:
  args `{ completionId: v.string(), storageIds: v.array(v.string()) }`.
  Authorization: the completion's author only (load via `by_aggregate_id`,
  compare `userId`). Effects, in order: (1) domain append via the existing
  edit path — call `makeEditCompletion` with ONLY `photoFileIds` set to
  existing + new ids (the aggregate enforces the 5 cap and the edit window;
  in-progress rows are always editable, fresh finished rows are inside the
  24h window); (2) insert one `completionImages` row per new storage id with
  `moderationStatus: "pending"`; (3) schedule the NSFW moderation per photo,
  reusing the existing adapter machinery (`library/adapters/photoModeration`
  - a `solving/moderateCompletionPhoto` internal action/mutation pair
    patterned on `library/moderatePhoto`, updating the sidecar row's status;
    fails open like the copy pipeline).
- Read-side filter: `listMyCompletions`'s `resolvePhotoUrls` (and
  `getCompletionHistory`'s equivalent) exclude photos whose sidecar row is
  pending/rejected; absent sidecar = legacy = included. (Self-facing lists
  hide pending photos briefly until moderation passes — acceptable; the
  follow-up dialog shows local previews so the user still sees what they
  added.)
- Gateway: one line for `attachCompletionPhotos`. `_generated/api.d.ts`
  hand-registration for the new modules.
- Deliberately NOT touched: `finishCompletion`/`startCompletion` args
  (photos attach via the new mutation, never inline).

### 3. Finish-instead at all record entry points

- `/completions/new`: add the `myCompletions` query + the my-puzzles
  `solveStateByCopyId` selector (newest in-progress with aggregateId per
  copy); `handleSelect` opens `FinishSolveDialog` (`completionId`,
  `minEndDate`) when in-progress exists, else `LogSolveDialog` as today.
- my-puzzles (`handleLogSolve`), copy page (log-solve trigger), borrowed
  (log-solve button): same swap using each page's ALREADY-COMPUTED in-progress
  state (`solveStateByCopyId` / `myInProgress` / `inProgressByCopyDocId`).
  `LogSolveDialog` itself is unchanged; no backend change.

### 4. Cards & thumbnails

- `completions/new.tsx`: `imageFit="contain"` on `PuzzleCard`.
- `object-cover` → `object-contain` on the 44px thumbnails in
  `completions/index.tsx`, `dashboard-home/solving-now-section.tsx`,
  `members/profile-body.tsx` (the currently-solving items).
- Completions rows: wrap the thumbnail in the Tooltip hover-expand pattern
  from `add-puzzle/cover-colour-field.tsx` (TooltipProvider delay ~200,
  content `side="top"` with `max-h-[280px] max-w-[260px] rounded-md
object-contain` image). The trigger must sit ABOVE the row's stretched
  link (`relative z-10`) so hover/focus reaches it; keyboard focus shows the
  same preview (Tooltip default behavior).

### 5. Testing

- Backend: `attachCompletionPhotos` — author-only (other member rejected);
  5-cap enforced across existing+new (6th rejected via domain error);
  sidecar rows created pending; moderation scheduled (drained in convex-test;
  status transitions applied); `photoUrls` excludes pending/rejected,
  includes legacy-absent; appending twice accumulates.
- Existing suites stay green (schema addition is additive).
- Web: tsc/lint/meta test; behavior via PR preview.

## Out of scope

- Displaying completion photos beyond the uploader's own data (moderation
  wiring is the precondition, now met for the future).
- Backend enforcement of finish-instead; review editing inside the follow-up;
  admin moderation UI for completion photos (statuses exist; admin surface
  can come later — flag if the existing admin moderation queue is
  copy-photo-specific).
