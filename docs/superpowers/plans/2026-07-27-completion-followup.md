# Completion Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combined review+photos prompt after completed solves (photos NSFW-moderated), finish-instead at all record entry points, contain-fit cards/thumbnails with hover-expand.

**Architecture:** Spec `docs/superpowers/specs/2026-07-27-completion-followup-design.md` is authoritative — read it before your task; it records verified breakers and user decisions. Branch `feat/in-progress-solves` (PR #66). Tasks 1-3 backend (domain attach path → mutation/schema → moderation clone + read filter), Tasks 4-6 web, Task 7 sweep+push.

**Conventions (every task):** backend tests `cd packages/backend && npx vitest run convex/<file>`; domain tests `cd packages/domain && npx vitest run <path>`; prettier changed files before commit; every commit gets `-m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`; locale keys ×3 (`apps/web/locales/{en,nl,source}.json`, source==en); new Convex modules hand-registered in `packages/backend/convex/_generated/api.d.ts` (mirror existing entries, alphabetical); JSX snippets are expressions to splice — never add `{ expr; }` wrappers; nx names are `@jigswap/backend` / `@jigswap/web`.

---

### Task 1: Domain — `Completion.attachPhotos` + use case

**Files:**

- Modify: `packages/domain/src/solving/domain/completion.ts`
- Create: `packages/domain/src/solving/application/ports/in/attach-completion-photos.port.ts` (+ barrel)
- Create: `packages/domain/src/solving/application/use-cases/attach-completion-photos.ts` (+ barrel)
- Test: extend `packages/domain/src/solving/domain/completion.spec.ts` and `packages/domain/src/solving/application/use-cases/completion-use-cases.spec.ts`

- [ ] **Step 1: Failing specs.** Read `completion.spec.ts`'s helpers first (how it builds completions/records events). Cases: (a) owner attaches 2 photos to a completion with 1 → photos length 3, updatedAt bumped; (b) non-owner → `NotCompletionOwner`; (c) existing 4 + new 2 → `TooManyPhotos`; (d) **backdated**: a completion recorded with `endDate` 10 days ago attaches successfully (pins window-free — this is the spec's verified breaker); (e) use-case spec: load→attach→save→publish via the in-memory fakes, and `CompletionNotFound` for unknown id.
- [ ] **Step 2: Run** both spec files — new cases FAIL (method/use case missing).
- [ ] **Step 3: Implement.** In `completion.ts`, add next to `edit()` (MIRROR `edit()`'s internals exactly — state-replacement style, error constructors, event recording; the code below is behavioral, adapt identifiers to the class's real private API):

```ts
  // Append photos. Additive (never removes), owner-only, capped at MAX_PHOTOS. Deliberately NOT
  // window-gated: attaching photos is not a revision of the solve's facts, and a backdated
  // completion's endDate-anchored window is already closed at creation.
  attachPhotos(
    actingMemberId: MemberId,
    photos: readonly Photo[],
    now: Date,
  ): Result<void, SolvingError> {
    if (actingMemberId !== this.state.userId) {
      return err(SolvingError.notCompletionOwner());
    }
    const combined = [...this.state.photos, ...photos];
    if (combined.length > MAX_PHOTOS) {
      return err(SolvingError.tooManyPhotos(MAX_PHOTOS));
    }
    this.state = { ...this.state, photos: combined, updatedAt: now };
    // Reuse CompletionEdited (verified consumer-safe: no feed/notification/goal reactions).
    // Record it exactly the way edit() records its event.
    ...
    return ok(undefined);
  }
```

Port (mirror `edit-completion.port.ts`'s error-union typing):

```ts
export interface AttachCompletionPhotosCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
  readonly photoFileIds: readonly FileId[];
}
export interface AttachCompletionPhotos {
  (
    cmd: AttachCompletionPhotosCommand,
  ): Promise<Result<void /* same union as EditCompletion */>>;
}
```

Use case: verbatim shape of `makeEditCompletion` (load → `completion.attachPhotos(cmd.actingMemberId, cmd.photoFileIds.map(Photo.of), clock.now())` → save → publish). Barrel exports in `ports/in/index.ts` + `use-cases/index.ts`.

- [ ] **Step 4: Run** both spec files + full domain suite — green. `pnpm arch:check` clean.
- [ ] **Step 5: Commit** `feat(domain): window-free attachPhotos on Completion`.

---

### Task 2: Backend — schema, `attachCompletionPhotos`, bypass removal, delete cascade

**Files:**

- Modify: `packages/backend/convex/schema.ts`
- Create: `packages/backend/convex/solving/attachCompletionPhotos.ts`
- Modify: `packages/backend/convex/solving/editCompletion.ts`, `packages/backend/convex/solving/recordCompletion.ts` (strip `photos` args), `packages/backend/convex/solving/deleteCompletion.ts` (cascade)
- Modify: `packages/backend/convex/_generated/api.d.ts`, `packages/gateway/src/operations.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts` (extend; adjust any tests using the stripped args)

- [ ] **Step 1: Failing tests.** New describe: (a) author attaches 2 photos (real stored blobs via `ctx.storage.store(new Blob([...]))` — precedent `setCopyCover.test.ts:86-92`) → `completions.photos` grows, one `completionImages` row per photo with `moderationStatus: "pending"`, one scheduled `moderateCompletionPhoto` job per photo (assert via `_scheduled_functions`, precedent `addCopyPhoto.test.ts:113-121`); (b) non-author rejected; (c) duplicate storageIds in one call + re-attach of an already-attached id → deduped (no extra rows/photos); (d) existing 4 + 2 new → `TooManyPhotos` ConvexError code; (e) **backdated completion (endDate 10 days ago) attach succeeds**; (f) `deleteCompletion` removes sidecar rows and (assert via `t.run` storage lookup if feasible, else assert sidecars gone) blobs; (g) `editCompletion`/`recordCompletion` no longer accept `photos` (TypeScript-level — just remove usages; adjust the existing tests that passed `photos` if any — grep first).
- [ ] **Step 2: Run** — new describe fails (module missing).
- [ ] **Step 3: Implement.**

`schema.ts` (next to the other solving tables):

```ts
  // Moderation sidecars for completion photos (completions.photos storage ids). One row per photo;
  // absent moderationStatus = legacy approved. The moderation pipeline may SWAP fileId (re-encode)
  // — it patches this row and the completions.photos entry together.
  completionImages: defineTable({
    completionId: v.string(), // Solving CompletionId aggregateId
    uploaderId: v.id("users"),
    fileId: v.id("_storage"),
    moderationStatus: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_completion", ["completionId"])
    .index("by_moderation_status", ["moderationStatus"]),
```

`attachCompletionPhotos.ts`:

```ts
import {
  makeAttachCompletionPhotos,
  type MemberId,
  toCompletionId,
  toFileId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: author attaches uploaded photos to their completion. Window-free by design
// (see the domain method); every new photo gets a pending moderation sidecar + a scheduled
// moderation job (transactional with this mutation).
export const attachCompletionPhotos = mutation({
  args: {
    completionId: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    // Dedupe within the call and against already-attached photos.
    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.completionId),
      )
      .unique();
    if (!row) throw new ConvexError("Completion not found");
    const attached = new Set(row.photos as string[]);
    const newIds = [...new Set(args.storageIds as string[])].filter(
      (id) => !attached.has(id),
    );
    if (newIds.length === 0) return;

    const attachUseCase = makeAttachCompletionPhotos({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await attachUseCase({
      actingMemberId: memberId as unknown as MemberId,
      completionId: toCompletionId(args.completionId),
      photoFileIds: newIds.map((id) => toFileId(id)),
    });
    if (result.isErr) throw toConvexError(result.error);

    const now = Date.now();
    for (const fileId of newIds) {
      const imageId = await ctx.db.insert("completionImages", {
        completionId: args.completionId,
        uploaderId: memberId as unknown as Id<"users">,
        fileId: fileId as Id<"_storage">,
        moderationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.solving.moderateCompletionPhoto.moderateCompletionPhoto,
        { imageId },
      );
    }
  },
});
```

(The `internal.solving.moderateCompletionPhoto` reference lands in Task 3 — for THIS task's tests to run, create the Task 3 files as minimal stubs OR order the scheduling line into Task 3. DECISION: create `solving/moderateCompletionPhoto.ts` in THIS task as a stub internal action that does nothing yet, registered in api.d.ts, so scheduling asserts work; Task 3 fills it in.)

`editCompletion.ts` / `recordCompletion.ts`: delete the `photos` arg + its `photoFileIds` mapping (pass `undefined`/omit to the domain commands — they're optional). `deleteCompletion.ts`: load the row via `by_aggregate_id` BEFORE the use case (capture `photos`); after success, delete sidecars via `by_completion` and best-effort `ctx.storage.delete` every captured photo id (try/catch per blob; comment mirrors `removeCopyPhoto`).

Gateway: `attachCompletionPhotos` line. api.d.ts: both new modules.

- [ ] **Step 4: Run** solvingMutations + full backend affected files + `@jigswap/backend:type-check` — green.
- [ ] **Step 5: Commit** `feat(backend): completion photo attach with moderation sidecars; close photo-arg bypass`.

---

### Task 3: Backend — moderation clone + read filter

**Files:**

- Modify: `packages/backend/convex/solving/moderateCompletionPhoto.ts` (fill the Task 2 stub)
- Create: `packages/backend/convex/solving/completionModerationStore.ts`
- Modify: `packages/backend/convex/solving/listMyCompletions.ts`, `packages/backend/convex/solving/getCompletionHistory.ts` (photo filter)
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Test: new `packages/backend/convex/completionModeration.test.ts`

- [ ] **Step 1: Read the pattern files fully**: `library/moderatePhoto.ts`, `library/moderationStore.ts`, `library/adapters/photoModeration.ts` (the pure port — REUSED as-is), `admin/stampModerationAction.ts`.
- [ ] **Step 2: Failing tests** (per the ESTABLISHED pattern — never drain the node action; env-less drains fail open):
  - Verdict mutations called directly: approve-with-swap patches the sidecar's `fileId` to the new blob AND swaps old→new inside `completions.photos` (insert a completion + sidecar first via attach); reject removes the id from `completions.photos`, deletes the blob (assert sidecar keeps `rejected` + the `moderationActions` stamp row exists with kind `photo_auto_rejected`).
  - Photo read filter: seed sidecars in each status — `listMyCompletions`'s `photoUrls` excludes REJECTED only; pending and absent (legacy) included. Same for `getCompletionHistory`.
- [ ] **Step 3: Implement.** `completionModerationStore.ts`: internal mutations mirroring `moderationStore.ts`'s responsibilities but typed to `completionImages` — `loadForModeration(imageId)`, `setVerdict/approve(imageId, {score,label})`, `setModerationFile(imageId, newFileId)` — with the two OBLIGATIONS the spec mandates:
  1. **approve/setModerationFile**: in ONE mutation, patch the sidecar `fileId` AND load the completion row (`by_aggregate_id` on the sidecar's `completionId`) and `db.patch` its `photos` array replacing old id with new (direct system write, comment: deliberately outside the domain path). Delete the old blob after (as the library flow does).
  2. **reject**: patch sidecar `rejected` (+score/label), load the completion row and `db.patch` `photos` without the id (frees a cap slot), `ctx.storage.delete` the blob, and stamp `photo_auto_rejected` via the existing `stampModerationAction` helper with `targetId = completionId` aggregate string and `targetLabel` from `copySnapshot?.title ?? "Completion photo"`.

  `moderateCompletionPhoto.ts`: internal action cloned from `library/moderatePhoto.ts` — same re-encode (EXIF strip) + classify + fails-open semantics, calling the solving store's mutations. Keep the same env/provider handling.
  Read filter: in both reads, per completion row load `completionImages` via `by_completion` (only when `row.aggregateId` present), build `fileId → status`, and filter `row.photos` to entries whose status is not `"rejected"` before URL resolution.

- [ ] **Step 4: Run** the new test file + solvingMutations + type-check — green.
- [ ] **Step 5: Commit** `feat(backend): completion photo moderation pipeline + rejected-photo filtering`.

---

### Task 4: Web — providers, follow-up dialog, trigger wiring

**Files:**

- Modify: `apps/web/src/components/solving/duration-prompt-provider.tsx`
- Create: `apps/web/src/components/solving/completion-follow-up-provider.tsx`
- Modify: `apps/web/src/routes/_dashboard/route.tsx` (mount), `apps/web/src/components/solving/log-solve-dialog.tsx`, `apps/web/src/components/solving/finish-solve-dialog.tsx`
- Modify: locale ×3 (`solving.followUp` namespace)

- [ ] **Step 1: `requestPrompt(onDone?)`.** Rewrite the provider's core (file is 75 lines — current code in repo):

```tsx
const onDoneRef = useRef<(() => void) | null>(null);

const finish = () => {
  const cb = onDoneRef.current;
  onDoneRef.current = null; // once-guard
  cb?.();
};

const requestPrompt = (onDone?: () => void) => {
  if (trackCompletionDuration === undefined) {
    onDoneRef.current = onDone ?? null;
    setOpen(true);
  } else {
    onDone?.(); // self-suppressed: chain continues synchronously
  }
};

const choose = async (enabled: boolean) => {
  await setTrackDuration(enabled);
  setOpen(false);
  finish();
};

// Dialog onOpenChange: (o) => { setOpen(o); if (!o) finish(); }
```

No-provider stub: `{ requestPrompt: (onDone) => onDone?.() }`. Update the `DurationPromptApi` type.

- [ ] **Step 2: `CompletionFollowUpProvider`.** New file, mirroring the provider idiom: context `{ requestFollowUp(completionId: string): void }`, first-wins (`if (completionId already set) return`), no-provider stub no-ops. The dialog content:
  - Star rating (`StarRating` interactive — check `review-puzzle-dialog.tsx` for the exact usage) + review `Textarea`.
  - Photo section: hidden `<input type="file" accept="image/*" multiple>` behind an add-tile (pattern: `copies/$id.tsx` PhotoStrip label ~857-961); compress each picked file with compressorjs using `forms/file-upload/index.tsx`'s settings (quality/max dims — read it; use the library directly, NOT the FileUpload component); cap picks at 5 (and show the domain TooManyPhotos error friendly on attach failure); local previews via `URL.createObjectURL` (revoke on cleanup); remove-before-save supported.
  - Save: `Promise.allSettled` over per-file (generateUploadUrl → POST → storageId); failures keep the dialog open with failed items marked and a Retry that re-runs failures only; then if rating ≥ 1 `reviewPuzzle({completionId, rating, text})`; then if storageIds `attachCompletionPhotos({completionId, storageIds})` (retry attach-only on failure). Dismissal disabled while saving (`onOpenChange` guarded on pending). Skip closes immediately (orphaned uploaded blobs accepted per spec).
  - Toasts: saved / saveError. All strings from `solving.followUp` (title, description, ratingLabel, textLabel/placeholder — reuse `solving.review` keys where they fit, photosLabel, photosHint, addPhotos, retry, save, skip, saved, saveError, tooManyPhotos) ×3 locales.
- [ ] **Step 3: Mount + wire triggers.** `route.tsx`: wrap next to `DurationPromptProvider` (follow-up INSIDE so it can be requested from the duration chain). `log-solve-dialog.tsx`: capture `const completionId = await recordCompletion.mutateAsync(...) as string;` and build the chain — replace the current post-save block with:

```ts
const completed = end !== undefined;
const piecesMissing = completed && !allPiecesPresent;
reset();
onSuccess?.();
onOpenChange(false);
const followUp = () => {
  if (completed) requestFollowUp(completionId);
};
const offerOrFollowUp = () => {
  if (piecesMissing && viewerIsOwner) {
    followUpAfterUpdateCopyRef.current = followUp; // fire when that dialog closes
    setOfferUpdateCopy(true);
  } else {
    followUp();
  }
};
if (wasFirstChoice) requestPrompt(offerOrFollowUp);
else offerOrFollowUp();
```

with `followUpAfterUpdateCopyRef` invoked (once-guarded, same ref-null pattern) from BOTH `confirmUpdateCopy`'s finally and the offer dialog's `onOpenChange(false)`. `finish-solve-dialog.tsx`: add `onSuccess?: () => void`; in the success path order `requestFollowUp(completionId)` → `onSuccess?.()` → `onOpenChange(false)`.

- [ ] **Step 4: Verify** tsc (no new errors), lint (no new), meta test 3 green, locale JSON valid.
- [ ] **Step 5: Commit** `feat(web): combined review+photos follow-up after completed solves`.

---

### Task 5: Web — finish-instead at all entry points

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions/new.tsx`, `my-puzzles/index.tsx`, `copies/$id.tsx`, `borrowed.tsx`, `apps/web/src/components/ui/puzzle-card.tsx`

- [ ] **Step 1: completions/new.** Add the `myCompletions` query + `solveStateByCopyId` memo (copy from `my-puzzles/index.tsx` — the version keeping `inProgressCompletionId`/`inProgressStartDate`); `handleSelect` branches: in-progress → `setFinishTarget({completionId, startDate})`, else current `setSolveTarget`. Mount `<FinishSolveDialog completionId minEndDate onSuccess={() => router.push("/completions")} .../>` beside the LogSolveDialog (which keeps its own onSuccess navigation).
- [ ] **Step 2: Hide Log while in progress.** my-puzzles: `PuzzleCard` — render the log-solve menu item only when NOT `solveInProgress` (the Start/Finish item remains the single completion affordance; read the overflow menu and gate the log item on `!solveInProgress`). copies page: render the "Log completion" button only when `!myInProgress`. borrowed: render the "Log solve" button only when the copy has no in-progress entry (`!inProgressByCopyDocId.has(...)` — the Finish swap button remains).
- [ ] **Step 3: Verify** tsc/lint/meta test.
- [ ] **Step 4: Commit** `feat(web): finish in-progress solve instead of double-logging at all entry points`.

---

### Task 6: Web — cards & thumbnails

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions/new.tsx` (imageFit), `completions/index.tsx` (contain + hover-expand), `apps/web/src/components/dashboard-home/solving-now-section.tsx`, `apps/web/src/components/members/profile-body.tsx`

- [ ] **Step 1:** `completions/new.tsx`: add `imageFit="contain"` to its `PuzzleCard`.
- [ ] **Step 2:** The three 44px thumbnails: className becomes `h-11 w-11 shrink-0 rounded-lg border bg-muted object-contain` (keep each file's current radius — `rounded-lg` on completions, `rounded-md` on the other two; add `border bg-muted` to all three).
- [ ] **Step 3:** completions rows hover-expand (pattern: `add-puzzle/cover-colour-field.tsx:163-221`): when `completion.link && completion.thumbnailUrl`, render

```tsx
<TooltipProvider delayDuration={200}>
  <Tooltip>
    <TooltipTrigger asChild>
      <Link
        href={hrefForLink(completion.link)}
        aria-label={title}
        className="relative z-10 shrink-0"
      >
        <Image ... (the contain thumbnail) />
      </Link>
    </TooltipTrigger>
    <TooltipContent side="top" className="p-1.5">
      <img
        src={completion.thumbnailUrl}
        alt=""
        className="max-h-[280px] max-w-[260px] rounded-md object-contain"
      />
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

(imports from `@/components/ui/tooltip` — same as cover-colour-field). Rows with a thumbnail but NO link render the plain thumbnail (no trigger); rows with neither keep `CoverChip`. The extra tab stop is accepted per spec.

- [ ] **Step 4: Verify** tsc/lint/meta test; **Step 5: Commit** `feat(web): contain-fit cards and thumbnails with hover-expand on completions`.

---

### Task 7: Verification sweep + push

- [ ] `pnpm arch:check`; `pnpm nx run-many --target=type-check --all --skip-nx-cache`; `pnpm nx run-many -t test coverage --skip-nx-cache`; scoped `pnpm prettier --check` (changed dirs + docs/superpowers). Fix smallest-change + separate commit if needed.
- [ ] `git push origin feat/in-progress-solves`; `gh pr view 66 --json mergeable,mergeStateStatus` — report.
