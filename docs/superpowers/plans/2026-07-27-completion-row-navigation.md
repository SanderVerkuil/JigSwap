# Completion Row Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completion rows link to the most specific reachable target (own copy → borrowed copy → viewable copy → definition), show cover-photo/box-art thumbnails, and use "solving" wording while in progress; `canViewCopy` gains a holder clause; the copy page's cover gets the missing moderation filter.

**Architecture:** All work lands on `feat/in-progress-solves` (PR #66). Backend: `canViewCopyWithContext` extraction + heldBy clause in `library/canViewCopy.ts`; enrichment in `solving/listMyCompletions.ts` reusing `library/resolveCoverUrl.ts`; one-line moderation fix in `library/getCopyInstanceView.ts`. Web: presentational changes to `completions/index.tsx` + locale keys ×3. No new Convex modules (no `api.d.ts` edits), no contracts changes, no domain changes. Spec: `docs/superpowers/specs/2026-07-27-completion-row-navigation-design.md` (read it first — it records the privacy decisions).

**Tech Stack:** Convex, convex-test + Vitest, TanStack Router/Query, use-intl.

**Conventions (every task):** backend tests `cd packages/backend && npx vitest run convex/<file>`; prettier changed files before commit; locale keys land in ALL THREE of `apps/web/locales/{en,nl,source}.json` (source mirrors en); commit messages end with the Co-Authored-By trailer.

---

### Task 1: `canViewCopy` — holder clause + context extraction

**Files:**

- Modify: `packages/backend/convex/library/canViewCopy.ts`
- Test: `packages/backend/convex/libraryReads.test.ts` (extend — read its seed/identity helpers first and mirror them; if `canViewCopy`/`getCopyInstanceView` coverage lives elsewhere in that file's describes, colocate with it)

- [ ] **Step 1: Write the failing tests**

Read `libraryReads.test.ts` first; reuse its seed and `withIdentity` helpers (names differ from the solving test files). Add a describe with these cases (write real code adapted to the file's helpers — the behaviors are fixed):

1. "the current holder can view a private, closed copy": seed a copy owned by A with `visibility: "private"`, no availability flags, and a PRIVATE profile row for A (absent profile defaults to public — the test must insert `profiles` row with `visibility: "private"` or the open+public branch can't be isolated); patch `heldBy` to B via `t.run`; assert `getCopyInstanceView` as B returns a non-null view (this pins the gate through its heaviest consumer).
2. "an ex-holder falls through to the old rules": continue the scenario — patch `heldBy` back to A (simulating return; if the file has a real returnLoan flow test, prefer driving `api.library.returnLoan` and ALSO assert the ROW's `heldBy` equals the owner id afterwards — the persistence-level check the review asked for); assert `getCopyInstanceView` as B now returns null (or its not-found shape — read how existing denial tests assert it).
3. "owner and public+open behavior unchanged": one assertion each that the owner still sees their copy and a public-profile+open copy is still visible to a stranger (guards the refactor).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/libraryReads.test.ts`
Expected: case 1 FAILS (holder denied today); cases 2-3 pass (they pin current behavior — that is fine, they are refactor guards).

- [ ] **Step 3: Implement**

Replace the body of `canViewCopy.ts` below `isOpen` with:

```ts
// Reusable per-request context so bulk callers (e.g. the completions enrichment) don't rebuild
// the circle-shared set or re-read owner profiles per copy. `ownerVisibility` is a mutable memo.
export interface CopyViewContext {
  readonly circleSharedOpenIds: Set<string>;
  readonly ownerVisibility: Map<string, "public" | "private">;
}

export const buildCopyViewContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<CopyViewContext> => {
  const circleShared = (await collectCircleSharedCopies(ctx, viewerId)).filter(
    isOpen,
  );
  return {
    circleSharedOpenIds: new Set(
      circleShared.map((c) => c._id as unknown as string),
    ),
    ownerVisibility: new Map(),
  };
};

// THE single copy-reachability gate (context form). A copy is viewable by `viewerId` iff:
//   1. the viewer owns it; OR
//   2. the viewer currently HOLDS it (heldBy) — the member physically holding a copy may view its
//      page; they can already log solves against it from the Borrowed page; OR
//   3. the owner's profile is PUBLIC and the copy is OPEN (at least one availability flag); OR
//   4. the copy is shared into a circle the viewer belongs to.
export const canViewCopyWithContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
  context: CopyViewContext,
): Promise<boolean> => {
  if (copy.ownerId === viewerId) return true;
  if (copy.heldBy === viewerId) return true;

  if (isOpen(copy)) {
    const key = copy.ownerId as unknown as string;
    let visibility = context.ownerVisibility.get(key);
    if (visibility === undefined) {
      visibility = await profileVisibilityOf(ctx, copy.ownerId);
      context.ownerVisibility.set(key, visibility);
    }
    if (visibility === "public") return true;
  }

  return context.circleSharedOpenIds.has(copy._id as unknown as string);
};

// Single-copy convenience wrapper. The identity short-circuits are duplicated here ON PURPOSE:
// without them every existing call site would pay the circle-shared collection even for the
// owner/holder fast paths, which today return before it.
export const canViewCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  if (copy.ownerId === viewerId || copy.heldBy === viewerId) return true;
  return canViewCopyWithContext(
    ctx,
    viewerId,
    copy,
    await buildCopyViewContext(ctx, viewerId),
  );
};
```

Keep the existing file-header comment, extending its rule list with the holder clause. Preserve the existing imports (`profileVisibilityOf`, `collectCircleSharedCopies`); `Id` is already imported via the type import.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/libraryReads.test.ts convex/photoComments.test.ts`
Expected: all pass (photoComments consumes the gate — its existing tests must survive; the holder can now ALSO comment, which is the spec's accepted consequence — if a photoComments test asserts a holder is denied, that assertion must be updated to expect success and note the spec decision).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex/library/canViewCopy.ts packages/backend/convex/libraryReads.test.ts
git add packages/backend
git commit -m "feat(library): current holder may view the copy they hold; context form of canViewCopy"
```

---

### Task 2: Copy-page cover moderation filter (companion fix)

**Files:**

- Modify: `packages/backend/convex/library/getCopyInstanceView.ts` (~lines 324-333)
- Test: `packages/backend/convex/libraryReads.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In the same test file, add: seed a copy with a cover photo whose `ownedPuzzleImages` row has `moderationStatus: "rejected"` and set `ownedPuzzles.coverImageId` to it; assert `getCopyInstanceView` (as the owner) returns `coverImage` equal to the catalog box-art URL (or undefined when the puzzle has no image — match the seed) and `coverImageId: null`. Mirror how existing tests in the file insert `ownedPuzzleImages` rows (check the schema fields: `ownedPuzzleId`, `fileId`, `moderationStatus`, plus whatever is required — read `schema.ts` ~279-330).

- [ ] **Step 2: Run to verify failure**

Expected: FAILS — today the rejected cover renders (no moderation check in that block).

- [ ] **Step 3: Implement**

In `getCopyInstanceView.ts`, extend the cover condition:

```ts
    if (copy.coverImageId) {
      const coverRow = await ctx.db.get(copy.coverImageId);
      if (
        coverRow &&
        coverRow.ownedPuzzleId === args.copyId &&
        (coverRow.moderationStatus ?? "approved") === "approved"
      ) {
```

(one added condition; the rest of the block unchanged — a rejected/pending cover now falls back to `globalImage` and reports `coverImageId: null`, so the picker no longer claims a rejected cover as the active selection). Update the block's comment to mention the approved-only rule, mirroring `resolveCoverUrl.ts`'s wording.

- [ ] **Step 4: Run + commit**

Run: `cd packages/backend && npx vitest run convex/libraryReads.test.ts`
Expected: PASS.

```bash
pnpm prettier --write packages/backend/convex/library/getCopyInstanceView.ts packages/backend/convex/libraryReads.test.ts
git add packages/backend
git commit -m "fix(library): copy-page cover respects photo moderation status"
```

---

### Task 3: `listMyCompletions` enrichment (thumbnail + link)

**Files:**

- Modify: `packages/backend/convex/solving/listMyCompletions.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts` (extend — its seed provides alice + her copy with `snapshot` and `aggregateId`; foreign-copy cases insert extra rows via `t.run`)

- [ ] **Step 1: Write the failing tests**

New describe `"solving.listMyCompletions — row enrichment"`. Behaviors to pin (write full tests; drive writes through real mutations where possible — `recordForAlice`, `startCompletion` — and shape the world via `t.run` patches):

1. **Own copy → myCopy link + cover preference**: alice records a completion on her copy; insert an `ownedPuzzleImages` row (approved) for her copy and set `coverImageId`; assert the returned row has `link = { kind: "myCopy", id: <ownedPuzzles _id> }` and `thumbnailUrl` equal to the cover photo's URL (in convex-test, `storage.getUrl` of a stored id — store a blob via `t.run(ctx => ctx.storage.store(...))` if needed; if storing blobs is awkward, assert `thumbnailUrl` is a non-null string distinct from the box-art case by giving the puzzle no `image` so ONLY the cover can produce a URL).
2. **Pending/rejected cover NOT used**: same but `moderationStatus: "rejected"` → `thumbnailUrl` falls back to box art (give `puzzles.image` a stored id) or undefined when no box art; never the cover URL.
3. **Borrowed now → copy link**: bob-owned copy (insert via `t.run`: private profile row for bob, `visibility: "private"`, no availability flags), `heldBy: alice`; alice records a completion against it (use `recordCompletion` with that copy's aggregateId — holder is authorized); assert `link.kind === "copy"` with the bob-copy `_id` (pins the heldBy clause through the enrichment).
4. **Returned + viewable → copy link**: same copy, `heldBy` patched back to bob, bob's profile row set `visibility: "public"` and copy `availability.forLend: true` → `link.kind === "copy"`.
5. **Returned + unviewable → definition link + box art**: bob's profile `visibility: "private"`, all availability flags false → `link = { kind: "definition", id: <puzzles _id> }`, and `thumbnailUrl` is the box art (or undefined without one), never bob's cover photo even if he has an approved one (add one to make the assertion bite).
6. **Copy deleted → definition link; puzzle also deleted → no link**: delete the bob copy row → `definition`; then also delete the puzzles row → `link` undefined (and `thumbnailUrl` undefined).
7. **Orphaned row** (insert a completion row with neither `ownedPuzzleId` nor `puzzleId`) → no link, no thumbnail; row still returned.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: new describe fails (`link`/`thumbnailUrl` absent); all pre-existing tests pass.

- [ ] **Step 3: Implement**

Rewrite `listMyCompletions.ts`'s handler (keep `resolvePhotoUrls` as is):

```ts
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";

// The navigation target for a completion row, most-specific-first: the viewer's own copy page,
// a copy page they can reach (currently holding, or visible per the copy gate), else the durable
// puzzle definition — and no link at all when even that anchor is gone. Ids are Convex doc _ids
// (what the routes parse); NEVER copySnapshot.copyId (the aggregate string).
type CompletionLink = {
  kind: "myCopy" | "copy" | "definition";
  id: string;
};
```

Handler shape (full code — adapt only identifier details to the file):

```ts
export const listMyCompletions = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const me = memberId as unknown as Id<"users">;

    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .collect();

    // Resolve display/navigation data once per DISTINCT copy/puzzle — many completions share one.
    const copyIds = [
      ...new Set(
        rows.flatMap((r) => (r.ownedPuzzleId ? [r.ownedPuzzleId] : [])),
      ),
    ];
    const puzzleIds = [
      ...new Set(rows.flatMap((r) => (r.puzzleId ? [r.puzzleId] : []))),
    ];

    const copies = new Map<string, Doc<"ownedPuzzles"> | null>();
    await Promise.all(
      copyIds.map(async (id) => copies.set(id as string, await ctx.db.get(id))),
    );
    const puzzles = new Map<string, Doc<"puzzles"> | null>();
    await Promise.all(
      puzzleIds.map(async (id) =>
        puzzles.set(id as string, await ctx.db.get(id)),
      ),
    );

    // Reachability per distinct copy. The circle-shared context is built lazily: only when some
    // copy is foreign and not currently held (the common all-own case never pays for it).
    let context: CopyViewContext | null = null;
    const reachable = new Map<string, boolean>();
    for (const [id, copy] of copies) {
      if (!copy) {
        reachable.set(id, false);
        continue;
      }
      if (copy.ownerId === me || copy.heldBy === me) {
        reachable.set(id, true);
        continue;
      }
      context ??= await buildCopyViewContext(ctx, me);
      reachable.set(id, await canViewCopyWithContext(ctx, me, copy, context));
    }

    // Thumbnails per distinct copy (cover — approved only — then box art) and per distinct
    // puzzle (box art) for rows whose copy is gone or unreachable.
    const copyThumbs = new Map<string, string | null>();
    await Promise.all(
      [...copies.entries()].map(async ([id, copy]) => {
        if (!copy || !reachable.get(id)) {
          copyThumbs.set(id, null);
          return;
        }
        const puzzle = copy.puzzleId ? await ctx.db.get(copy.puzzleId) : null;
        copyThumbs.set(id, await resolveCopyCoverUrl(ctx, copy, puzzle));
      }),
    );
    const puzzleThumbs = new Map<string, string | null>();
    await Promise.all(
      [...puzzles.entries()].map(async ([id, puzzle]) => {
        puzzleThumbs.set(
          id,
          puzzle?.image ? await ctx.storage.getUrl(puzzle.image) : null,
        );
      }),
    );

    return Promise.all(
      rows.map(async (row) => {
        const copyKey = row.ownedPuzzleId as string | undefined;
        const puzzleKey = row.puzzleId as string | undefined;
        const copy = copyKey ? (copies.get(copyKey) ?? null) : null;
        const copyReachable = copyKey
          ? (reachable.get(copyKey) ?? false)
          : false;
        const puzzle = puzzleKey ? (puzzles.get(puzzleKey) ?? null) : null;

        let link: CompletionLink | undefined;
        if (copy && copy.ownerId === me) {
          link = { kind: "myCopy", id: copy._id as string };
        } else if (copy && copyReachable) {
          link = { kind: "copy", id: copy._id as string };
        } else if (puzzle) {
          link = { kind: "definition", id: puzzle._id as string };
        }

        const thumbnailUrl =
          (copyKey && copyReachable ? copyThumbs.get(copyKey) : null) ??
          (puzzleKey ? puzzleThumbs.get(puzzleKey) : null) ??
          undefined;

        return {
          ...row,
          photoUrls: await resolvePhotoUrls(ctx, row.photos),
          thumbnailUrl,
          link,
        };
      }),
    );
  },
});
```

Note the doc comment on the file: extend the existing header to describe the enrichment and the "self-facing read only" property.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts convex/libraryReads.test.ts`
Expected: all pass. Also `npx nx run backend:type-check --skip-nx-cache` (name per nx.json) — clean.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex
git add packages/backend
git commit -m "feat(solving): enrich listMyCompletions with navigation link + thumbnail"
```

---

### Task 4: Web — row image, stretched link, solving wording

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions/index.tsx`
- Modify: `apps/web/locales/{en,nl,source}.json`

- [ ] **Step 1: Implement the row changes**

In `renderCompletionRow` (~line 201):

1. Row root div: add `relative` to its `cn(...)` classes.
2. Replace the `CoverChip` block (~lines 247-250) with:

```tsx
{
  completion.thumbnailUrl ? (
    <Image
      src={completion.thumbnailUrl}
      alt=""
      width={44}
      height={44}
      className="h-11 w-11 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <CoverChip
      color={chipColor(index)}
      icon={done ? CircleCheck : Clock}
      size={44}
    />
  );
}
```

with `import { Image } from "@/compat/image";` added.

3. Title (~line 253 `<span className="text-sm font-semibold">{title}</span>`): when `completion.link` is present, wrap in the stretched link (house pattern from `puzzle-card-shell.tsx`):

```tsx
{
  completion.link ? (
    <Link
      href={hrefForLink(completion.link)}
      className="text-sm font-semibold after:absolute after:inset-0 after:z-[1] after:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {title}
    </Link>
  ) : (
    <span className="text-sm font-semibold">{title}</span>
  );
}
```

with a module-level helper (place near `todayInputValue`-style helpers if any, else above the component):

```tsx
// Route target for a completion's server-resolved navigation link (ids are doc _ids).
function hrefForLink(link: { kind: string; id: string }): string {
  if (link.kind === "myCopy") return `/my-puzzles/${link.id}`;
  if (link.kind === "copy") return `/copies/${link.id}`;
  return `/puzzles/${link.id}`;
}
```

4. The action-button cluster (the `div.flex.items-center.gap-1` holding Finish/review/edit/delete) gets `relative z-10` added to its className, so the buttons sit above the overlay.
5. Status line (~line 276): change

```tsx
{
  completion.copySnapshot.wasBorrowed
    ? t("solvedBorrowedCopy")
    : t("solvedOwnCopy");
}
```

to

```tsx
{
  completion.copySnapshot.wasBorrowed
    ? t(done ? "solvedBorrowedCopy" : "solvingBorrowedCopy")
    : t(done ? "solvedOwnCopy" : "solvingOwnCopy");
}
```

(`done` is already in scope in the row).

- [ ] **Step 2: Locale keys ×3**

`solving.completions` gains, next to the `solved*` siblings:

- en/source: `"solvingOwnCopy": "Solving your copy"`, `"solvingBorrowedCopy": "Solving a borrowed copy"` (read the actual `solved*` en strings first and mirror their phrasing exactly — the spec matched "Solved your copy"/"Solved a borrowed copy").
- nl: `"solvingOwnCopy": "Bezig met eigen exemplaar"`, `"solvingBorrowedCopy": "Bezig met geleend exemplaar"`.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit` (clean); `python3 -c "import json; [json.load(open(f'apps/web/locales/{l}.json')) for l in ('en','nl','source')]"` from repo root (valid); `npx vitest run src/components/social/activity-feed-meta.test.ts` (3 green); `npx nx run web:lint --skip-nx-cache` (no NEW errors).

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/completions/index.tsx apps/web/locales
git add apps/web
git commit -m "feat(web): completion rows link to copy/definition with cover thumbnails"
```

---

### Task 5: Verification sweep + push

- [ ] **Step 1:** `pnpm arch:check` — clean. `pnpm nx run-many --target=type-check --all --skip-nx-cache` — clean. `pnpm nx run-many -t test coverage --skip-nx-cache` — all green. Scoped `pnpm prettier --check` over the changed dirs — clean.
- [ ] **Step 2:** `git push origin feat/in-progress-solves` (fast-forward push — no force needed unless the remote moved) and confirm PR #66 still MERGEABLE via `gh pr view 66 --json mergeable,mergeStateStatus`.
- [ ] **Step 3:** Fix anything found (smallest change), separate commit, re-run.
