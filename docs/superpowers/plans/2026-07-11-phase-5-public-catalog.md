# Phase 5 — Public Puzzle Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unauthenticated, SEO-facing puzzle catalog pages (`/catalog`, `/catalog/$id`) showing moderated catalog data, rating breakdown, public-owner availability aggregates, and privacy-projected reviews — with bidirectional member redirects, marketing-nav entry, robots.txt and a sitemap.

**Architecture:** New unauthenticated Convex queries in `catalog/` + `social/` reuse aggregate helpers extracted from the auth-gated `library/getPuzzleDefinitionView.ts`. A new public identity projection in `social/privacy.ts` names review authors iff their profile is public. Web routes live under `_public/` (marketing shell), SSR'd via the `ensureQueryData` public-loader pattern; sitemap/robots are TanStack Start server routes.

**Tech Stack:** Convex (convex-test + vitest), TanStack Start/Router (file routes, `head()`, server routes), @convex-dev/react-query, Tailwind + existing `PuzzleCardShell`/`catalog-detail-parts`, use-intl (en/nl).

**Spec:** `docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md` (Phase 5 section).

**Conventions that bind every task:**

- Backend tests live at `packages/backend/convex/*.test.ts`; run from `packages/backend` with `npx vitest run convex/<file>.test.ts`.
- Every public catalog read filters `status === "approved"` — the established leak-prevention pattern.
- Format before committing: `pnpm prettier --write <changed files>` (CI runs `format:check` first).
- Type checks mirror CI with `--skip-nx-cache`: `pnpm nx run backend:type-check --skip-nx-cache`, `pnpm nx run web:type-check --skip-nx-cache`.
- Convex codegen: after adding new Convex function files, `_generated/api.d.ts` must know them before `tsc` passes (Task 7). Tests do NOT need codegen (convex-test bundles via `import.meta.glob`).
- Known deviation from the spec (agreed): the list page ships **Newest-first only** — no "Top rated" sort select. Correct rating sort needs denormalized per-definition rating fields (sorting a paginated query by a computed aggregate is otherwise wrong or unbounded). Defer.

---

### Task 1: Public catalog DTO contracts

**Files:**

- Create: `packages/contracts/src/catalog/public.ts`
- Modify: `packages/contracts/src/index.ts` (add one export line)

No test project exists for `contracts` (pure types); verification is `tsc` via the backend/web checks in later tasks.

- [ ] **Step 1: Create the DTO module**

```ts
// packages/contracts/src/catalog/public.ts
// View DTOs for the UNAUTHENTICATED public catalog surfaces (/catalog, /catalog/$id). These are
// deliberately narrower than the member-facing views: no owner identities, no copy-level data,
// no member ids ever cross the wire to a logged-out visitor.

import type { PuzzleDifficulty } from "./views";

/** Aggregate availability over open copies whose OWNER'S PROFILE IS PUBLIC (no circle reachability —
 * there is no viewer). Each copy counts once under its priority swap type (trade→swap, lend, sale). */
export interface PublicAvailabilityView {
  total: number;
  byType: { swap: number; lend: number; sale: number };
}

/** One card in the public catalog list. `image` is the resolved box-art URL. */
export interface PublicCatalogCardView {
  _id: string;
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: PuzzleDifficulty;
  image: string | null;
  rating: { value: number; count: number };
  /** PublicAvailabilityView.total, denormalized for the card's "N to swap" badge. */
  availableToSwap: number;
}

/** The public catalog detail view — catalog facts + community aggregates, nothing member-level. */
export interface PublicDefinitionDetailView {
  definition: {
    title: string;
    description?: string;
    brand?: string;
    artist?: string;
    series?: string;
    pieceCount: number;
    image?: string;
    difficulty?: PuzzleDifficulty;
    categoryName?: string;
    tags: string[];
    shape?: "rectangular" | "panoramic" | "round" | "shaped";
    dimensions?: { width: number; height: number; unit: "cm" | "in" };
  };
  rating: {
    rating: number;
    count: number;
    /** index 0..4 == [5★,4★,3★,2★,1★] — matches the member-facing detail view. */
    breakdown: [number, number, number, number, number];
    percentages: [number, number, number, number, number];
  };
  stats: {
    communityOwners: number;
    totalCompletions: number;
    avgCompletionDays: number | null;
  };
  availability: PublicAvailabilityView;
}

/** A community review as shown on the public catalog page. `author` is null when the author's
 * profile is private — the UI renders a generic "A JigSwap member". */
export interface PublicPuzzleReviewView {
  id: string;
  author: { name: string; avatar: string | null } | null;
  text: string;
  rating: number | null;
  createdAt: number;
}
```

- [ ] **Step 2: Export it from the contracts barrel**

Find the existing catalog export line: `grep -n "catalog" packages/contracts/src/index.ts`. Next to `export * from "./catalog/views";` (or equivalent) add:

```ts
export * from "./catalog/public";
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm nx run backend:type-check --skip-nx-cache`
Expected: PASS (contracts are consumed by backend's tsconfig paths; no new errors).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/catalog/public.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): public catalog view DTOs"
```

---

### Task 2: Extract shared definition-aggregate helpers (pure refactor)

**Files:**

- Create: `packages/backend/convex/library/definitionAggregates.ts`
- Modify: `packages/backend/convex/library/getPuzzleDefinitionView.ts` (replace local helpers with imports)
- Guard: `packages/backend/convex/getPuzzleDefinitionView.test.ts` (existing — must stay green)

This is a behavior-preserving move so Tasks 3–5 can reuse the rating/completion/availability logic without duplicating it. The moved code is copied verbatim from `getPuzzleDefinitionView.ts` (lines 13–62 and the rating/completions blocks at lines 96–130 / 142–177).

- [ ] **Step 1: Run the existing guard test BEFORE the refactor**

Run: `cd packages/backend && npx vitest run convex/getPuzzleDefinitionView.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Create the helpers module**

```ts
// packages/backend/convex/library/definitionAggregates.ts
// Shared aggregate helpers over a puzzle DEFINITION, used by BOTH the auth-gated member detail
// (getPuzzleDefinitionView) and the unauthenticated public catalog reads. Moved verbatim from
// getPuzzleDefinitionView.ts so the two views can't drift on the shared math.

import type { CopyOfferSwapType } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";

const MS_PER_DAY = 86_400_000;

/** Round to 1 decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Whole-day solve duration: prefer (endDate - startDate) rounded to whole days; else fall back to
 * completionTimeMinutes / 1440 rounded; else null when neither is recorded. */
export const finishDaysOf = (c: {
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
}): number | null => {
  if (c.endDate != null) {
    return Math.round((c.endDate - c.startDate) / MS_PER_DAY);
  }
  if (c.completionTimeMinutes != null) {
    return Math.round(c.completionTimeMinutes / 1440);
  }
  return null;
};

/** A copy is "open" iff at least one exchange-availability flag is set (identical to browseOwnedPuzzles). */
export const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

/** Availability priority -> swapType: forTrade -> "swap", forLend -> "lend", forSale -> "sale". */
export const swapTypeOf = (copy: Doc<"ownedPuzzles">): CopyOfferSwapType => {
  if (copy.availability.forTrade) return "swap";
  if (copy.availability.forLend) return "lend";
  return "sale";
};

/** The adminCategories name is localized `{ en, nl }`; the detail pages want a single string (English).
 * Defensive against legacy/raw string shapes. */
export const categoryNameOf = (
  row: Doc<"adminCategories"> | null,
): string | undefined => {
  if (!row) return undefined;
  const name = row.name as unknown;
  if (typeof name === "string") return name;
  if (name && typeof name === "object" && "en" in name) {
    const en = (name as { en?: unknown }).en;
    if (typeof en === "string") return en;
  }
  return undefined;
};

export interface RatingBreakdown {
  rating: number;
  count: number;
  breakdown: [number, number, number, number, number];
  percentages: [number, number, number, number, number];
}

/** Community rating distribution over DEFINITION-level reviews (puzzleComments with a rating and
 * copyId == null). breakdown index 0..4 == [5★..1★]. */
export const ratingBreakdownOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<RatingBreakdown> => {
  const comments = await ctx.db
    .query("puzzleComments")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const ratedReviews = comments.filter(
    (c) => c.rating != null && c.copyId == null,
  );
  const breakdown: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let ratingSum = 0;
  for (const c of ratedReviews) {
    const r = c.rating as number;
    ratingSum += r;
    const bucket = 5 - r; // r=5 -> 0, r=1 -> 4
    if (bucket >= 0 && bucket <= 4) breakdown[bucket] += 1;
  }
  const ratingCount = ratedReviews.length;
  const pct = (n: number): number =>
    ratingCount > 0 ? Math.round((n / ratingCount) * 100) : 0;
  return {
    rating: ratingCount > 0 ? round1(ratingSum / ratingCount) : 0,
    count: ratingCount,
    breakdown,
    percentages: [
      pct(breakdown[0]),
      pct(breakdown[1]),
      pct(breakdown[2]),
      pct(breakdown[3]),
      pct(breakdown[4]),
    ],
  };
};

/** Completion aggregate for a definition: count of finished solves + average whole-day duration.
 * A solve is recorded against the definition (puzzleId) OR against a copy (ownedPuzzleId only);
 * both are counted, deduped by _id. `ownedCopies` is the definition's ownedPuzzles rows (the caller
 * already has them). */
export const completionStatsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
  ownedCopies: Doc<"ownedPuzzles">[],
): Promise<{ totalCompletions: number; avgCompletionDays: number | null }> => {
  const byDefinition = await ctx.db
    .query("completions")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const byCopy = (
    await Promise.all(
      ownedCopies.map((copy) =>
        ctx.db
          .query("completions")
          .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy._id))
          .collect(),
      ),
    )
  ).flat();
  const deduped = new Map<string, (typeof byDefinition)[number]>();
  for (const c of [...byDefinition, ...byCopy]) {
    deduped.set(c._id as unknown as string, c);
  }
  const completed = [...deduped.values()].filter((c) => c.isCompleted);
  const finishDaysList = completed
    .map(finishDaysOf)
    .filter((d): d is number => d != null);
  return {
    totalCompletions: completed.length,
    avgCompletionDays:
      finishDaysList.length > 0
        ? round1(
            finishDaysList.reduce((s, d) => s + d, 0) / finishDaysList.length,
          )
        : null,
  };
};

/** PUBLIC availability aggregate: open copies whose owner's profile is PUBLIC, each counted once
 * under its priority swap type. No circle reachability and no viewer exclusion — there is no
 * viewer. This count is intentionally NOT equal to the member-facing stats.availableToSwap (which
 * adds circle-shared copies and excludes the viewer's own copies); the asymmetry is by design per
 * the Phase 5 spec — do not "fix" it. Pass a shared `visibilityCache` when aggregating many
 * definitions in one request (the list page) so each owner is resolved once. */
export const publicAvailabilityOf = async (
  ctx: QueryCtx,
  ownedCopies: Doc<"ownedPuzzles">[],
  visibilityCache: Map<string, "public" | "private"> = new Map(),
): Promise<{
  total: number;
  byType: { swap: number; lend: number; sale: number };
}> => {
  const ownerIsPublic = async (ownerId: Id<"users">): Promise<boolean> => {
    const key = ownerId as unknown as string;
    let cached = visibilityCache.get(key);
    if (cached === undefined) {
      cached = await profileVisibilityOf(ctx, ownerId);
      visibilityCache.set(key, cached);
    }
    return cached === "public";
  };
  const byType = { swap: 0, lend: 0, sale: 0 };
  for (const copy of ownedCopies.filter(isOpen)) {
    if (await ownerIsPublic(copy.ownerId)) {
      byType[swapTypeOf(copy)] += 1;
    }
  }
  return { total: byType.swap + byType.lend + byType.sale, byType };
};
```

- [ ] **Step 3: Refactor `getPuzzleDefinitionView.ts` to import the helpers**

In `packages/backend/convex/library/getPuzzleDefinitionView.ts`:

1. Delete the local `MS_PER_DAY`, `round1`, `finishDaysOf`, `isOpen`, `swapTypeOf`, `categoryNameOf` definitions (lines 13–62).
2. Add to the imports:
   ```ts
   import {
     categoryNameOf,
     completionStatsOf,
     isOpen,
     ratingBreakdownOf,
     swapTypeOf,
   } from "./definitionAggregates";
   ```
3. Replace the rating block (the `// --- rating ...` comment through `const rating = {...};`, lines 96–130) with:
   ```ts
   const rating = await ratingBreakdownOf(ctx, args.puzzleId);
   ```
4. Replace the completions block (the `// --- completions ...` comment through the `avgCompletionDays` computation, lines 142–177) with:
   ```ts
   const { totalCompletions, avgCompletionDays } = await completionStatsOf(
     ctx,
     args.puzzleId,
     owned,
   );
   ```
5. In the returned `stats` object, replace `totalCompletions: completed.length` with `totalCompletions`.
6. Keep everything else (reachability gate, owner resolution, ownership) untouched — those are member-only concerns.

- [ ] **Step 4: Run the guard test again**

Run: `cd packages/backend && npx vitest run convex/getPuzzleDefinitionView.test.ts`
Expected: PASS — identical results to Step 1. If anything fails, the move was not verbatim; fix before proceeding.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm nx run backend:type-check --skip-nx-cache
pnpm prettier --write packages/backend/convex/library/definitionAggregates.ts packages/backend/convex/library/getPuzzleDefinitionView.ts
git add packages/backend/convex/library/
git commit -m "refactor(library): extract definition aggregate helpers for public catalog reuse"
```

---

### Task 3: `getPublicDefinitionView` (unauthenticated detail read) — TDD

**Files:**

- Create: `packages/backend/convex/catalog/getPublicDefinitionView.ts`
- Test: `packages/backend/convex/publicCatalog.test.ts` (new — shared by Tasks 3–6)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/backend/convex/publicCatalog.test.ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NOW = 1_000_000;

const mkUser = (
  ctx: MutationCtx,
  clerkId: string,
  name: string,
  extra: { shareAvatarPublicly?: boolean } = {},
) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
    username: clerkId,
    avatar: `https://avatars/${clerkId}.png`,
    location: "Utrecht",
    shareAvatarPublicly: extra.shareAvatarPublicly,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

const mkProfile = (
  ctx: MutationCtx,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  ctx.db.insert("profiles", {
    aggregateId: `prof-${memberId}`,
    memberId,
    displayName: "X",
    visibility,
    updatedAt: NOW,
  });

const mkCopy = (
  ctx: MutationCtx,
  slug: string,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
) =>
  ctx.db.insert("ownedPuzzles", {
    aggregateId: `copy-${slug}`,
    puzzleId,
    ownerId,
    condition: "good",
    availability,
    createdAt: NOW,
    updatedAt: NOW,
  });

// Seed: an approved + a pending definition, three owners (public/public/private profiles) with
// open + closed copies, and reviews by a public- and a private-profile author.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const pia = await mkUser(ctx, "clerk_pia", "Pia Public", {
      shareAvatarPublicly: true,
    });
    const paul = await mkUser(ctx, "clerk_paul", "Paul Public"); // no avatar consent
    const priya = await mkUser(ctx, "clerk_priya", "Priya Private");
    await mkProfile(ctx, pia, "public");
    await mkProfile(ctx, paul, "public");
    await mkProfile(ctx, priya, "private");

    const approved = await ctx.db.insert("puzzles", {
      aggregateId: "def-approved",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      difficulty: "hard",
      tags: ["nature"],
      searchableText: "mountain vista ravensburger",
      status: "approved",
      submittedBy: pia,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const pending = await ctx.db.insert("puzzles", {
      aggregateId: "def-pending",
      title: "Secret Ocean",
      brand: "Clementoni",
      pieceCount: 500,
      searchableText: "secret ocean clementoni",
      status: "pending",
      submittedBy: pia,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // Copies of the approved puzzle:
    //  pia (public):   open forTrade  -> counts as "swap"
    //  paul (public):  open forLend   -> counts as "lend"
    //  paul (public):  closed         -> not counted (but still an owner)
    //  priya (private): open forTrade -> NOT counted publicly
    await mkCopy(ctx, "pia-trade", approved, pia, {
      forTrade: true,
      forSale: false,
      forLend: false,
    });
    await mkCopy(ctx, "paul-lend", approved, paul, {
      forTrade: false,
      forSale: false,
      forLend: true,
    });
    await mkCopy(ctx, "paul-closed", approved, paul, {
      forTrade: false,
      forSale: false,
      forLend: false,
    });
    await mkCopy(ctx, "priya-trade", approved, priya, {
      forTrade: true,
      forSale: false,
      forLend: false,
    });

    // Definition-level reviews (copyId == null): one by a public profile, one by a private one.
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-pia",
      puzzleId: approved,
      authorId: pia,
      text: "Lovely gradient sky.",
      rating: 5,
      createdAt: NOW + 1,
    });
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-priya",
      puzzleId: approved,
      authorId: priya,
      text: "Tough edges!",
      rating: 3,
      createdAt: NOW + 2,
    });
    // A review on the PENDING puzzle must never surface publicly.
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-pending",
      puzzleId: pending,
      authorId: pia,
      text: "Should not leak.",
      rating: 4,
      createdAt: NOW + 3,
    });

    return { pia, paul, priya, approved, pending };
  });

describe("getPublicDefinitionView", () => {
  test("returns catalog facts + aggregates for an approved definition, unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    expect(view).not.toBeNull();
    expect(view?.definition.title).toBe("Mountain Vista");
    expect(view?.definition.brand).toBe("Ravensburger");
    expect(view?.definition.pieceCount).toBe(1000);
    // Rating over the two definition reviews: (5+3)/2 = 4.
    expect(view?.rating.rating).toBe(4);
    expect(view?.rating.count).toBe(2);
    // 3 distinct owners overall.
    expect(view?.stats.communityOwners).toBe(3);
  });

  test("availability counts only OPEN copies of PUBLIC-profile owners, with per-type breakdown", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    // pia's forTrade (swap) + paul's forLend (lend). priya's open copy is private-owner; paul's
    // closed copy is not open. NOTE: this intentionally differs from the member-facing count.
    expect(view?.availability).toEqual({
      total: 2,
      byType: { swap: 1, lend: 1, sale: 0 },
    });
  });

  test("returns null for a non-approved definition", async () => {
    const t = convexTest(schema, modules);
    const { pending } = await seed(t);

    expect(
      await t.query(
        api.catalog.getPublicDefinitionView.getPublicDefinitionView,
        { puzzleId: pending },
      ),
    ).toBeNull();
  });

  test("payload leaks no member identity or copy-level data", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("ownerId");
    expect(raw).not.toContain("Pia Public");
    expect(raw).not.toContain("Priya Private");
    expect(raw).not.toContain("clerk_");
    expect(raw).not.toContain("Utrecht");
    expect(raw).not.toContain("condition");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: FAIL — `api.catalog.getPublicDefinitionView` does not exist yet (convex-test raises "Could not find module"/undefined function reference).

- [ ] **Step 3: Implement the query**

```ts
// packages/backend/convex/catalog/getPublicDefinitionView.ts
import type { PublicDefinitionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import {
  categoryNameOf,
  completionStatsOf,
  publicAvailabilityOf,
  ratingBreakdownOf,
} from "../library/definitionAggregates";

// UNAUTHENTICATED catalog detail for the public /catalog/$id page. Approved-only (the standard
// catalog leak gate) and strictly member-free: catalog facts, the community rating breakdown,
// completion stats, and the PUBLIC availability aggregate — never owner identities, copy rows,
// prices, or locations. The availability number intentionally differs from the member-facing
// getPuzzleDefinitionView (no circle reachability, no viewer-own exclusion); see
// publicAvailabilityOf. Members never see this page — the web route redirects them to /puzzles/$id.
export const getPublicDefinitionView = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicDefinitionDetailView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return null;

    const image = puzzle.image
      ? ((await ctx.storage.getUrl(puzzle.image)) ?? undefined)
      : undefined;
    const categoryRow = puzzle.category
      ? await ctx.db.get(puzzle.category)
      : null;

    const rating = await ratingBreakdownOf(ctx, args.puzzleId);

    const owned = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();
    const communityOwners = new Set(
      owned.map((c) => c.ownerId as unknown as string),
    ).size;
    const availability = await publicAvailabilityOf(ctx, owned);
    const { totalCompletions, avgCompletionDays } = await completionStatsOf(
      ctx,
      args.puzzleId,
      owned,
    );

    return {
      definition: {
        title: puzzle.title,
        description: puzzle.description,
        brand: puzzle.brand,
        artist: puzzle.artist,
        series: puzzle.series,
        pieceCount: puzzle.pieceCount,
        image,
        difficulty: puzzle.difficulty,
        categoryName: categoryNameOf(categoryRow),
        tags: puzzle.tags ?? [],
        shape: puzzle.shape,
        dimensions: puzzle.dimensions,
      },
      rating,
      stats: { communityOwners, totalCompletions, avgCompletionDays },
      availability,
    };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: PASS (all 4 `getPublicDefinitionView` tests).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex/catalog/getPublicDefinitionView.ts packages/backend/convex/publicCatalog.test.ts
git add packages/backend/convex/catalog/getPublicDefinitionView.ts packages/backend/convex/publicCatalog.test.ts
git commit -m "feat(catalog): unauthenticated public definition view"
```

---

### Task 4: Public review projection + `listPublicPuzzleReviews` — TDD

**Files:**

- Modify: `packages/backend/convex/social/privacy.ts` (add `projectPublicAuthor`)
- Create: `packages/backend/convex/social/listPublicPuzzleReviews.ts`
- Test: `packages/backend/convex/publicCatalog.test.ts` (extend)

- [ ] **Step 1: Add the failing tests** (append to `publicCatalog.test.ts`)

```ts
describe("listPublicPuzzleReviews", () => {
  test("names public-profile authors, anonymizes private-profile authors", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const reviews = await t.query(
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
      { puzzleId: approved },
    );
    // Newest first: rev-priya (private author), then rev-pia (public author).
    expect(reviews).toHaveLength(2);
    expect(reviews[0].author).toBeNull(); // Priya: private profile -> "A JigSwap member"
    expect(reviews[0].text).toBe("Tough edges!");
    expect(reviews[1].author?.name).toBe("Pia Public");
    // Pia consented (shareAvatarPublicly: true) -> avatar included.
    expect(reviews[1].author?.avatar).toBe("https://avatars/clerk_pia.png");
  });

  test("withholds the avatar without shareAvatarPublicly consent, even for public profiles", async () => {
    const t = convexTest(schema, modules);
    const { approved, paul } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzleComments", {
        aggregateId: "rev-paul",
        puzzleId: approved,
        authorId: paul,
        text: "Great fit.",
        rating: 4,
        createdAt: NOW + 10,
      });
    });

    const reviews = await t.query(
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
      { puzzleId: approved },
    );
    const paulsReview = reviews.find((r) => r.text === "Great fit.");
    expect(paulsReview?.author?.name).toBe("Paul Public");
    expect(paulsReview?.author?.avatar).toBeNull();
  });

  test("returns [] for a non-approved definition (reviews must not leak)", async () => {
    const t = convexTest(schema, modules);
    const { pending } = await seed(t);

    expect(
      await t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
        { puzzleId: pending },
      ),
    ).toEqual([]);
  });

  test("payload never carries username/location/bio/member ids", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const raw = JSON.stringify(
      await t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
        { puzzleId: approved },
      ),
    );
    expect(raw).not.toContain("clerk_"); // usernames equal clerk ids in the seed
    expect(raw).not.toContain("Utrecht");
    expect(raw).not.toContain("authorId");
    expect(raw).not.toContain("email");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: the 4 new tests FAIL (module not found); the Task 3 tests still PASS.

- [ ] **Step 3: Add `projectPublicAuthor` to `social/privacy.ts`** (append at the end of the file)

```ts
/** The public projection of a review author: name + (consent-gated) avatar, or null. */
export type PublicAuthorView = { name: string; avatar: string | null } | null;

/**
 * UNAUTHENTICATED identity projection for public (logged-out, indexable) surfaces — the public
 * catalog's review authors. There is no viewer, so projectMemberIdentity's self/mutual-follower
 * reveals cannot apply: reveal iff the member's profile is PUBLIC, else null (the UI renders a
 * generic "A JigSwap member"). Deliberately far narrower than toMemberView — no username, bio,
 * location, or member id ever leaves the server for a public page, and the avatar additionally
 * requires the member's explicit `shareAvatarPublicly` consent (the existing flag for public
 * marketing surfaces).
 */
export const projectPublicAuthor = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<PublicAuthorView> => {
  const user = await ctx.db.get(memberId);
  if (!user) return null;
  if ((await profileVisibilityOf(ctx, memberId)) !== "public") return null;
  return {
    name: user.name,
    avatar: user.shareAvatarPublicly === true ? (user.avatar ?? null) : null,
  };
};
```

- [ ] **Step 4: Implement the query**

```ts
// packages/backend/convex/social/listPublicPuzzleReviews.ts
import type { PublicPuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { projectPublicAuthor } from "./privacy";

// UNAUTHENTICATED read of the community reviews on a catalog definition, for the public
// /catalog/$id page. Sibling of listPuzzleReviews (the auth-gated member read, which always names
// authors via toMemberView); this one projects each author through projectPublicAuthor instead —
// named iff their profile is public, null (rendered as "A JigSwap member") otherwise.
//
// Leak gates: reviews of a non-approved definition return [] (mirrors every public catalog read),
// and copy-scoped comments (copyId set) are excluded — community reviews only. Newest first.
export const listPublicPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicPuzzleReviewView[]> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return [];

    const rows = (
      await ctx.db
        .query("puzzleComments")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .order("desc")
        .collect()
    ).filter((row) => row.copyId == null);

    return Promise.all(
      rows.map(async (row): Promise<PublicPuzzleReviewView> => ({
        id: row.aggregateId ?? row._id,
        author: await projectPublicAuthor(ctx, row.authorId),
        text: row.text,
        rating: row.rating ?? null,
        createdAt: row.createdAt,
      })),
    );
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/privacy.ts packages/backend/convex/social/listPublicPuzzleReviews.ts packages/backend/convex/publicCatalog.test.ts
git add packages/backend/convex/social/ packages/backend/convex/publicCatalog.test.ts
git commit -m "feat(social): public review projection + unauthenticated review list"
```

---

### Task 5: `browsePublicCatalog` (paginated list with search/filters + card aggregates) — TDD

**Files:**

- Create: `packages/backend/convex/catalog/browsePublicCatalog.ts`
- Test: `packages/backend/convex/publicCatalog.test.ts` (extend)

- [ ] **Step 1: Add the failing tests** (append to `publicCatalog.test.ts`)

```ts
describe("browsePublicCatalog", () => {
  const firstPage = { numItems: 20, cursor: null };

  test("lists approved definitions only, newest first, with card aggregates", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const result = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage },
    );
    expect(result.page).toHaveLength(1); // pending stays hidden
    const card = result.page[0];
    expect(card.title).toBe("Mountain Vista");
    expect(card.rating).toEqual({ value: 4, count: 2 });
    expect(card.availableToSwap).toBe(2); // public-owner open copies only
  });

  test("search term restricts via the search index (approved-only)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const hit = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, searchTerm: "mountain" },
    );
    expect(hit.page.map((p) => p.title)).toEqual(["Mountain Vista"]);

    // The pending puzzle's terms must not surface.
    const miss = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, searchTerm: "secret ocean" },
    );
    expect(miss.page).toHaveLength(0);
  });

  test("brand and piece-count filters narrow the list", async () => {
    const t = convexTest(schema, modules);
    const { pia } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzles", {
        aggregateId: "def-small",
        title: "Tiny Meadow",
        brand: "Jumbo",
        pieceCount: 300,
        searchableText: "tiny meadow jumbo",
        status: "approved",
        submittedBy: pia,
        createdAt: NOW + 5,
        updatedAt: NOW + 5,
      });
    });

    const byBrand = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, brand: "Jumbo" },
    );
    expect(byBrand.page.map((p) => p.title)).toEqual(["Tiny Meadow"]);

    const byPieces = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, pieceMin: 1000, pieceMax: 1499 },
    );
    expect(byPieces.page.map((p) => p.title)).toEqual(["Mountain Vista"]);

    const under500 = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, pieceMax: 499 },
    );
    expect(under500.page.map((p) => p.title)).toEqual(["Tiny Meadow"]);
  });

  test("card payload leaks no owner or member data", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const raw = JSON.stringify(
      await t.query(api.catalog.browsePublicCatalog.browsePublicCatalog, {
        paginationOpts: firstPage,
      }),
    );
    expect(raw).not.toContain("ownerId");
    expect(raw).not.toContain("submittedBy");
    expect(raw).not.toContain("clerk_");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: the 4 new tests FAIL (module not found); previous 8 still PASS.

- [ ] **Step 3: Implement the query**

```ts
// packages/backend/convex/catalog/browsePublicCatalog.ts
import type { PublicCatalogCardView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import {
  publicAvailabilityOf,
  ratingBreakdownOf,
} from "../library/definitionAggregates";

// UNAUTHENTICATED paginated catalog list for the public /catalog page: approved definitions only
// (the standard leak gate), newest first, optionally narrowed by a search term (search index,
// status-filtered at the index), brand, and a piece-count range. Each page row is enriched with
// the card aggregates (rating summary + public availability count).
//
// Sort is newest-first ONLY: sorting by rating would require a denormalized per-definition rating
// (a computed aggregate can't order a paginated index scan) — deliberately deferred.
export const browsePublicCatalog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceMin: v.optional(v.number()),
    pieceMax: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<PublicCatalogCardView>> => {
    const term = args.searchTerm?.toLowerCase().trim() ?? "";

    // brand/piece narrowing shared by both branches (status is handled per-branch: at the search
    // index for the search branch, as a filter for the plain branch).
    const matchesFacets = (p: Doc<"puzzles">): boolean =>
      (args.brand === undefined || p.brand === args.brand) &&
      (args.pieceMin === undefined || p.pieceCount >= args.pieceMin) &&
      (args.pieceMax === undefined || p.pieceCount <= args.pieceMax);

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q.search("searchableText", term).eq("status", "approved"),
            )
            .filter((q) =>
              q.and(
                args.brand === undefined
                  ? q.eq(q.field("status"), "approved") // no-op placeholder keeps the AND non-empty
                  : q.eq(q.field("brand"), args.brand),
                args.pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), args.pieceMin),
                args.pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), args.pieceMax),
              ),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("puzzles")
            .order("desc") // newest first by _creationTime
            .filter((q) =>
              q.and(
                q.eq(q.field("status"), "approved"),
                args.brand === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.eq(q.field("brand"), args.brand),
                args.pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), args.pieceMin),
                args.pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), args.pieceMax),
              ),
            )
            .paginate(args.paginationOpts);

    // Belt-and-braces: the branches above already gate status/facets, but the enrichment below is
    // the last line of defence against a future filter regression leaking a pending row.
    const rows = result.page.filter(
      (p) => p.status === "approved" && matchesFacets(p),
    );

    // Shared owner-visibility cache so each distinct owner across the page resolves once.
    const visibilityCache = new Map<string, "public" | "private">();
    const page: PublicCatalogCardView[] = await Promise.all(
      rows.map(async (puzzle) => {
        const rating = await ratingBreakdownOf(ctx, puzzle._id);
        const owned = await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzle._id))
          .collect();
        const availability = await publicAvailabilityOf(
          ctx,
          owned,
          visibilityCache,
        );
        return {
          _id: puzzle._id,
          title: puzzle.title,
          brand: puzzle.brand,
          pieceCount: puzzle.pieceCount,
          difficulty: puzzle.difficulty,
          image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
          rating: { value: rating.rating, count: rating.count },
          availableToSwap: availability.total,
        };
      }),
    );

    return { ...result, page };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex/catalog/browsePublicCatalog.ts packages/backend/convex/publicCatalog.test.ts
git add packages/backend/convex/catalog/browsePublicCatalog.ts packages/backend/convex/publicCatalog.test.ts
git commit -m "feat(catalog): unauthenticated paginated public catalog browse"
```

---

### Task 6: `listSitemapEntries` — TDD

**Files:**

- Create: `packages/backend/convex/catalog/listSitemapEntries.ts`
- Test: `packages/backend/convex/publicCatalog.test.ts` (extend)

- [ ] **Step 1: Add the failing test** (append to `publicCatalog.test.ts`)

```ts
describe("listSitemapEntries", () => {
  test("returns approved definition ids + updatedAt only", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const entries = await t.query(
      api.catalog.listSitemapEntries.listSitemapEntries,
      {},
    );
    expect(entries).toEqual([{ id: approved, updatedAt: NOW }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts -t "listSitemapEntries"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the query**

```ts
// packages/backend/convex/catalog/listSitemapEntries.ts
import { query } from "../_generated/server";

// UNAUTHENTICATED feed for the /sitemap.xml server route: every approved definition's id +
// updatedAt (for <lastmod>). Catalog URLs ONLY — member profiles are deliberately not
// sitemap-listed (Phase 5 spec). A full collect() is fine at the current catalog scale; if the
// catalog ever grows past ~10k definitions, page this and stream the sitemap instead.
export const listSitemapEntries = query({
  args: {},
  handler: async (ctx): Promise<{ id: string; updatedAt: number }[]> => {
    const puzzles = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .collect();
    return puzzles.map((p) => ({ id: p._id, updatedAt: p.updatedAt }));
  },
});
```

- [ ] **Step 4: Run the full backend suite for this plan**

Run: `cd packages/backend && npx vitest run convex/publicCatalog.test.ts convex/getPuzzleDefinitionView.test.ts convex/catalogReads.test.ts`
Expected: PASS (all files — the two pre-existing files guard the refactor and the catalog conventions).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex/catalog/listSitemapEntries.ts packages/backend/convex/publicCatalog.test.ts
git add packages/backend/convex/catalog/listSitemapEntries.ts packages/backend/convex/publicCatalog.test.ts
git commit -m "feat(catalog): sitemap entries query"
```

---

### Task 7: Gateway wiring + Convex codegen

**Files:**

- Modify: `packages/gateway/src/operations.ts`
- Regenerate: `packages/backend/convex/_generated/api.d.ts`

- [ ] **Step 1: Add the gateway entries**

In `packages/gateway/src/operations.ts`, inside the `catalog: {` block (after `puzzleSuggestions:` around line 56), add:

```ts
    // Unauthenticated public-catalog reads (the /catalog pages; approved-only, member-free).
    publicBrowse: api.catalog.browsePublicCatalog.browsePublicCatalog,
    publicDefinitionView:
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
    sitemapEntries: api.catalog.listSitemapEntries.listSitemapEntries,
```

In the `social: {` block (next to the existing `listPuzzleReviews` entry — find it with `grep -n "listPuzzleReviews" packages/gateway/src/operations.ts`), add:

```ts
    listPublicPuzzleReviews:
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
```

- [ ] **Step 2: Regenerate the Convex API types**

Run: `cd packages/backend && npx convex codegen`
Expected: `_generated/api.d.ts` updates to include `catalog.browsePublicCatalog`, `catalog.getPublicDefinitionView`, `catalog.listSitemapEntries`, `social.listPublicPuzzleReviews`.

**Contingency (per repo memory):** `convex codegen` needs a configured deployment. If it fails with a deployment error, hand-edit `packages/backend/convex/_generated/api.d.ts`: add the four module entries following the exact pattern of their siblings (e.g. copy the `getPuzzleById` typeof-import line style for each new file).

- [ ] **Step 3: Type-check both ends**

Run: `pnpm nx run backend:type-check --skip-nx-cache && pnpm nx run web:type-check --skip-nx-cache`
Expected: PASS (web has no consumers yet; this proves the gateway wiring types resolve).

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write packages/gateway/src/operations.ts
git add packages/gateway/src/operations.ts packages/backend/convex/_generated/
git commit -m "feat(gateway): expose public catalog reads"
```

---

### Task 8: `DefinitionCard` web component

**Files:**

- Create: `apps/web/src/components/puzzles/definition-card.tsx`

Verified by `tsc` here and visually in Task 9's dev-server check. Do NOT reuse `PuzzleCard` (`ui/puzzle-card.tsx`) — it renders an owned-copy DTO with owner actions. Reuse `PuzzleCardShell` (the layout truth) with public-card badges.

- [ ] **Step 1: Create the component**

```tsx
// apps/web/src/components/puzzles/definition-card.tsx
"use client";

import { PuzzleCardShell } from "@/components/puzzles/puzzle-card-shell";
import { Badge } from "@/components/ui/badge";
import type { PublicCatalogCardView } from "@jigswap/contracts";
import { Star } from "lucide-react";
import { useTranslations } from "use-intl";

// The public catalog list card: box art (shell fallback gradient when unset), 2-line title,
// brand + mono piece count, difficulty pill (shell), star rating, and an outline "N to swap"
// badge ONLY when N > 0 — absence is the signal, never render "0 to swap". Whole card
// stretched-links to the public detail page. Copy-level badges (condition/availability flags)
// deliberately don't exist here — those are member concerns.
export function DefinitionCard({ card }: { card: PublicCatalogCardView }) {
  const t = useTranslations("publicCatalog");

  const badges = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {card.rating.count > 0 && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {card.rating.value} ({card.rating.count})
        </span>
      )}
      {card.availableToSwap > 0 && (
        <Badge variant="outline" className="text-xs">
          {t("toSwap", { count: card.availableToSwap })}
        </Badge>
      )}
    </div>
  );

  return (
    <PuzzleCardShell
      puzzle={{
        id: card._id,
        title: card.title,
        brand: card.brand,
        pieceCount: card.pieceCount,
        difficulty: card.difficulty,
        imageUrl: card.image,
      }}
      badges={badges}
      imageHref={`/catalog/${card._id}`}
    />
  );
}
```

- [ ] **Step 2: Commit** (type-check happens with the page in Task 9, where the locale key lands too)

```bash
pnpm prettier --write apps/web/src/components/puzzles/definition-card.tsx
git add apps/web/src/components/puzzles/definition-card.tsx
git commit -m "feat(web): public catalog definition card"
```

---

### Task 9: Public catalog list page + marketing nav + locales

**Files:**

- Create: `apps/web/src/routes/_public/catalog/index.tsx`
- Modify: `apps/web/src/components/marketing/header.tsx` (NAV array)
- Modify: `apps/web/src/components/marketing/footer.tsx` (explore column)
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`

- [ ] **Step 1: Add the locale strings**

Add to `apps/web/locales/en.json` AND `apps/web/locales/source.json` (identical content; source.json is the English source-of-truth mirror). Place the new top-level `publicCatalog` object alphabetically-ish near `puzzleDefinition`:

```json
"publicCatalog": {
  "title": "Puzzle catalogue",
  "subtitle": "Every puzzle the JigSwap community collects, swaps and lends.",
  "searchPlaceholder": "Search puzzles…",
  "allBrands": "All brands",
  "allPieces": "Any piece count",
  "piecesLt500": "Under 500 pieces",
  "pieces500": "500 – 999 pieces",
  "pieces1000": "1,000 – 1,499 pieces",
  "pieces1500": "1,500+ pieces",
  "toSwap": "{count} to swap",
  "loadMore": "Load more",
  "noResults": "No puzzles match \"{query}\"",
  "noResultsSub": "Try a brand name or fewer words",
  "clearSearch": "Clear search",
  "empty": "The catalogue is just getting started",
  "emptySub": "Members add puzzles every day — check back soon.",
  "joinCta": "Join JigSwap to request a swap",
  "logIn": "Log in",
  "availabilityTitle": "Available in the community",
  "copiesAvailableNow": "{count, plural, one {copy available to swap right now} other {copies available to swap right now}}",
  "joinToSeeWho": "Join to see who",
  "ownersHaveIt": "{count, plural, one {# member has this in their collection} other {# members have this in their collection}}",
  "chipSwap": "{count} swap",
  "chipLend": "{count} lend",
  "chipSale": "{count} sale",
  "statAvailable": "Available to swap",
  "statOwners": "Community owners",
  "statCompletions": "Times completed",
  "statAvgDays": "Avg. days to finish",
  "communityRating": "Community rating",
  "ratingsCount": "{count} ratings",
  "reviews": "Reviews",
  "noReviews": "No reviews yet.",
  "anonymousReviewer": "A JigSwap member",
  "logInToReview": "Log in to write a review",
  "notFound": "Puzzle not found",
  "notFoundSub": "This puzzle may have been removed from the catalogue."
}
```

In the `marketing.nav` object of both files, add:

```json
"catalog": "Browse puzzles"
```

Dutch (`apps/web/locales/nl.json`) — same keys:

```json
"publicCatalog": {
  "title": "Puzzelcatalogus",
  "subtitle": "Elke puzzel die de JigSwap-community verzamelt, ruilt en uitleent.",
  "searchPlaceholder": "Zoek puzzels…",
  "allBrands": "Alle merken",
  "allPieces": "Elk aantal stukjes",
  "piecesLt500": "Minder dan 500 stukjes",
  "pieces500": "500 – 999 stukjes",
  "pieces1000": "1.000 – 1.499 stukjes",
  "pieces1500": "1.500+ stukjes",
  "toSwap": "{count} te ruilen",
  "loadMore": "Meer laden",
  "noResults": "Geen puzzels gevonden voor \"{query}\"",
  "noResultsSub": "Probeer een merknaam of minder woorden",
  "clearSearch": "Zoekopdracht wissen",
  "empty": "De catalogus is net begonnen",
  "emptySub": "Leden voegen dagelijks puzzels toe — kom snel terug.",
  "joinCta": "Word lid van JigSwap om te ruilen",
  "logIn": "Inloggen",
  "availabilityTitle": "Beschikbaar in de community",
  "copiesAvailableNow": "{count, plural, one {exemplaar nu beschikbaar om te ruilen} other {exemplaren nu beschikbaar om te ruilen}}",
  "joinToSeeWho": "Word lid om te zien wie",
  "ownersHaveIt": "{count, plural, one {# lid heeft deze in de verzameling} other {# leden hebben deze in hun verzameling}}",
  "chipSwap": "{count} ruilen",
  "chipLend": "{count} lenen",
  "chipSale": "{count} kopen",
  "statAvailable": "Beschikbaar om te ruilen",
  "statOwners": "Eigenaren in de community",
  "statCompletions": "Keer gelegd",
  "statAvgDays": "Gem. dagen om te leggen",
  "communityRating": "Communitybeoordeling",
  "ratingsCount": "{count} beoordelingen",
  "reviews": "Reviews",
  "noReviews": "Nog geen reviews.",
  "anonymousReviewer": "Een JigSwap-lid",
  "logInToReview": "Log in om een review te schrijven",
  "notFound": "Puzzel niet gevonden",
  "notFoundSub": "Deze puzzel is mogelijk uit de catalogus verwijderd."
}
```

and in `marketing.nav`: `"catalog": "Puzzels bekijken"`.

- [ ] **Step 2: Add the nav entries**

`apps/web/src/components/marketing/header.tsx` — extend the `NAV` array (line 20), placing catalog after howItWorks:

```ts
const NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/catalog", key: "catalog" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;
```

`apps/web/src/components/marketing/footer.tsx` — in the explore column links array (around line 40), add after the howItWorks entry:

```ts
{ href: "/catalog", label: t("nav.catalog") },
```

- [ ] **Step 3: Create the list route**

```tsx
// apps/web/src/routes/_public/catalog/index.tsx
import { Link } from "@/compat/link";
import { EmptyState } from "@/components/library/empty-state";
import { DefinitionCard } from "@/components/puzzles/definition-card";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Search } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

type BrowseResult = FunctionReturnType<typeof gateway.catalog.publicBrowse>;

const PAGE_SIZE = 20;
// The default (unfiltered) first page — the loader prefetches EXACTLY these args so the
// initial render is SSR'd (same pattern as the home page's globalStatsQuery).
const defaultFirstPageQuery = convexQuery(gateway.catalog.publicBrowse, {
  paginationOpts: { numItems: PAGE_SIZE, cursor: null },
});

// Piece-count buckets from the spec: <500 / 500 / 1000 / 1500+.
const PIECE_BUCKETS = {
  lt500: { pieceMax: 499 },
  b500: { pieceMin: 500, pieceMax: 999 },
  b1000: { pieceMin: 1000, pieceMax: 1499 },
  b1500: { pieceMin: 1500 },
} as const;
type PieceBucket = keyof typeof PIECE_BUCKETS;

export const Route = createFileRoute("/_public/catalog/")({
  head: () => ({
    meta: [
      { title: "Puzzle catalogue — JigSwap" },
      {
        name: "description",
        content:
          "Browse the JigSwap community puzzle catalogue: ratings, reviews and swap availability for jigsaw puzzles.",
      },
      { property: "og:title", content: "Puzzle catalogue — JigSwap" },
      {
        property: "og:description",
        content:
          "Browse the JigSwap community puzzle catalogue: ratings, reviews and swap availability for jigsaw puzzles.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(defaultFirstPageQuery);
  },
  component: CatalogListPage,
});

function CatalogListPage() {
  const t = useTranslations("publicCatalog");
  const { convexClient } = Route.useRouteContext();

  // Toolbar state. `searchInput` is the raw keystrokes; `searchTerm` is the debounced value the
  // query actually uses.
  const [searchInput, setSearchInput] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [brand, setBrand] = React.useState<string | undefined>(undefined);
  const [bucket, setBucket] = React.useState<PieceBucket | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filterArgs = React.useMemo(
    () => ({
      ...(searchTerm.length >= 1 ? { searchTerm } : {}),
      ...(brand ? { brand } : {}),
      ...(bucket ? PIECE_BUCKETS[bucket] : {}),
    }),
    [searchTerm, brand, bucket],
  );

  // First page: a plain reactive query (SSR'd for the unfiltered default via the loader).
  const { data: firstPage } = useQuery(
    convexQuery(gateway.catalog.publicBrowse, {
      paginationOpts: { numItems: PAGE_SIZE, cursor: null },
      ...filterArgs,
    }),
  );

  // Older pages accumulate in local state; a filter change resets them.
  const [extraPages, setExtraPages] = React.useState<BrowseResult[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const filterKey = JSON.stringify(filterArgs);
  React.useEffect(() => {
    setExtraPages([]);
  }, [filterKey]);

  const { data: brands } = useQuery(convexQuery(gateway.catalog.allBrands, {}));

  const lastPage = extraPages.at(-1) ?? firstPage;
  const cards = [
    ...(firstPage?.page ?? []),
    ...extraPages.flatMap((p) => p.page),
  ];

  const loadMore = async () => {
    if (!lastPage || lastPage.isDone) return;
    setLoadingMore(true);
    try {
      const next = await convexClient.query(gateway.catalog.publicBrowse, {
        paginationOpts: {
          numItems: PAGE_SIZE,
          cursor: lastPage.continueCursor,
        },
        ...filterArgs,
      });
      setExtraPages((pages) => [...pages, next]);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-1">{t("subtitle")}</p>

      {/* Toolbar: search + brand + piece bucket. One row on >=sm, stacked on mobile. */}
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Select
          value={brand ?? "all"}
          onValueChange={(v) => setBrand(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={t("allBrands")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allBrands")}</SelectItem>
            {(brands ?? [])
              .filter((b): b is string => !!b)
              .map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={bucket ?? "all"}
          onValueChange={(v) =>
            setBucket(v === "all" ? undefined : (v as PieceBucket))
          }
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t("allPieces")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allPieces")}</SelectItem>
            <SelectItem value="lt500">{t("piecesLt500")}</SelectItem>
            <SelectItem value="b500">{t("pieces500")}</SelectItem>
            <SelectItem value="b1000">{t("pieces1000")}</SelectItem>
            <SelectItem value="b1500">{t("pieces1500")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      <div className="mt-8">
        {firstPage === undefined ? (
          <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          searchTerm ? (
            <EmptyState
              title={t("noResults", { query: searchTerm })}
              sub={t("noResultsSub")}
              action={
                <Button variant="ghost" onClick={clearSearch}>
                  {t("clearSearch")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("empty")} sub={t("emptySub")} />
          )
        ) : (
          <>
            <PuzzleViewProvider
              viewMode="grid"
              className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4"
            >
              {cards.map((card) => (
                <DefinitionCard key={card._id} card={card} />
              ))}
            </PuzzleViewProvider>
            {lastPage && !lastPage.isDone && (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Conversion tail for logged-out visitors (members get redirected off /catalog/$id anyway,
          and this static CTA is harmless if they browse the list). */}
      <div className="mt-12 flex justify-center">
        <Button variant="brand" asChild>
          <Link href="/sign-up">{t("joinCta")}</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Regenerate the route tree + verify in the dev server**

Run: `pnpm nx run web:dev --skip-nx-cache` in the background (starts on `:3001`; the router plugin writes `routeTree.gen.ts` on boot). Then:

Run: `curl -s http://localhost:3001/catalog | grep -o "Puzzle catalogue" | head -2`
Expected: `Puzzle catalogue` appears (SSR'd h1 + title).

Run: `curl -s http://localhost:3001/catalog | grep -c "description"`
Expected: ≥ 1 (meta description SSR'd).

Stop the dev server afterwards.

- [ ] **Step 5: Type-check, format, commit**

```bash
pnpm nx run web:type-check --skip-nx-cache
pnpm prettier --write apps/web/src/routes/_public/catalog/index.tsx apps/web/src/components/marketing/header.tsx apps/web/src/components/marketing/footer.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git add apps/web/src/routes/_public/catalog/ apps/web/src/components/marketing/ apps/web/locales/ apps/web/src/routeTree.gen.ts
git commit -m "feat(web): public puzzle catalog list page + marketing nav entry"
```

---

### Task 10: Public catalog detail page + bidirectional redirects + composer note

**Files:**

- Create: `apps/web/src/routes/_public/catalog/$id.tsx`
- Modify: `apps/web/src/routes/_dashboard/route.tsx` (unauthenticated `/puzzles/$id` → `/catalog/$id`)
- Modify: `apps/web/src/routes/_dashboard/puzzles/$id/index.tsx` (composer public note)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (one key: `puzzleDefinition.reviewPublicNote`)

- [ ] **Step 1: Create the detail route**

```tsx
// apps/web/src/routes/_public/catalog/$id.tsx
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { EmptyState } from "@/components/library/empty-state";
import {
  MemberAvatar,
  PuzzleCoverFallback,
  SectionHead,
  StarGlyph,
  Stat,
  difficultyClasses,
} from "@/components/puzzles/catalog-detail-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, MessageCircle, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

type View = NonNullable<
  FunctionReturnType<typeof gateway.catalog.publicDefinitionView>
>;
type PublicReview = FunctionReturnType<
  typeof gateway.social.listPublicPuzzleReviews
>[number];

const viewQuery = (id: string) =>
  convexQuery(gateway.catalog.publicDefinitionView, {
    puzzleId: id as Id<"puzzles">,
  });
const reviewsQuery = (id: string) =>
  convexQuery(gateway.social.listPublicPuzzleReviews, {
    puzzleId: id as Id<"puzzles">,
  });

export const Route = createFileRoute("/_public/catalog/$id")({
  // Members always get the richer dashboard page (own actions, per-copy list): the spec's
  // bidirectional redirect. The unauthenticated /puzzles/$id -> /catalog/$id half lives in
  // _dashboard/route.tsx.
  beforeLoad: ({ context, params }) => {
    if (context.userId) {
      throw redirect({ to: "/puzzles/$id", params: { id: params.id } });
    }
  },
  loader: async ({ context, params }) => {
    const [view] = await Promise.all([
      context.queryClient.ensureQueryData(viewQuery(params.id)),
      context.queryClient.ensureQueryData(reviewsQuery(params.id)),
    ]);
    return { view };
  },
  head: ({ loaderData }) => {
    const d = loaderData?.view?.definition;
    if (!d) return { meta: [{ title: "JigSwap" }] };
    const title = `${d.title} — JigSwap`;
    // English-only meta template: head() runs outside the intl render tree; acceptable for SEO.
    const description = `${d.title}${d.brand ? ` by ${d.brand}` : ""} — ${d.pieceCount.toLocaleString("en")}-piece jigsaw puzzle. Community rating, reviews and swap availability on JigSwap.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(d.image ? [{ property: "og:image", content: d.image }] : []),
      ],
    };
  },
  component: PublicPuzzlePage,
});

function PublicPuzzlePage() {
  const { id } = Route.useParams();
  const t = useTranslations("publicCatalog");
  const { data: view } = useQuery(viewQuery(id));

  if (view === undefined) return null; // loader-prefetched; only a hard refetch passes here
  if (view === null) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
        <EmptyState title={t("notFound")} sub={t("notFoundSub")} />
      </main>
    );
  }
  return <PublicPuzzleDetail view={view} puzzleId={id} />;
}

function swapChipClasses(type: "swap" | "lend" | "sale") {
  switch (type) {
    case "swap":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "lend":
      return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
    default:
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
  }
}

function PublicPuzzleDetail({
  view,
  puzzleId,
}: {
  view: View;
  puzzleId: string;
}) {
  const t = useTranslations("publicCatalog");
  const { definition, rating, stats, availability } = view;
  const topics = [
    ...(definition.categoryName ? [definition.categoryName] : []),
    ...definition.tags,
  ];
  const chips = (
    [
      ["swap", availability.byType.swap],
      ["lend", availability.byType.lend],
      ["sale", availability.byType.sale],
    ] as const
  ).filter(([, n]) => n > 0);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-6 py-10">
      {/* Hero — mirrors the dashboard detail skeleton, minus member actions. */}
      <section className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="bg-muted relative aspect-square w-full max-w-[300px] overflow-hidden rounded-2xl shadow-sm">
          {definition.image ? (
            <Image
              src={definition.image}
              alt={definition.title}
              fill
              className="object-cover"
            />
          ) : (
            <PuzzleCoverFallback />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold uppercase tracking-[0.18em]">
            {t("title")}
          </div>
          <h1 className="font-heading mt-2 text-3xl font-bold tracking-tight">
            {definition.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">
            {definition.brand ? `${definition.brand} · ` : ""}
            <span className="font-mono">
              {definition.pieceCount.toLocaleString()}
            </span>{" "}
            pieces
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            {rating.count > 0 && (
              <span className="flex items-center gap-1.5">
                <StarRating value={Math.round(rating.rating)} size="sm" />
                <span className="text-muted-foreground text-sm">
                  {rating.rating} ({rating.count})
                </span>
              </span>
            )}
            {definition.difficulty && (
              <Badge
                className={cn(
                  "rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold",
                  difficultyClasses(definition.difficulty),
                )}
              >
                {definition.difficulty}
              </Badge>
            )}
            {topics.map((topic, i) => (
              <span
                key={`${topic}-${i}`}
                className="border-border text-foreground inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              >
                {topic}
              </span>
            ))}
          </div>
          {definition.description && (
            <p className="text-foreground/90 mt-4 text-sm leading-relaxed">
              {definition.description}
            </p>
          )}
          {/* ONE primary CTA (spec): join, with returnTo back to this page. */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button variant="brand" asChild>
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("joinCta")}
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link
                href={`/sign-in?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("logIn")}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats strip — Available-to-swap FIRST (the hook); zero/absent stats are hidden, never
          rendered as dashes (spec). */}
      <div className="grid max-w-[760px] grid-cols-2 gap-y-6 sm:grid-cols-4">
        {availability.total > 0 && (
          <Stat value={availability.total} label={t("statAvailable")} />
        )}
        {stats.communityOwners > 0 && (
          <Stat
            value={stats.communityOwners}
            label={t("statOwners")}
            divided={availability.total > 0}
          />
        )}
        {stats.totalCompletions > 0 && (
          <Stat
            value={stats.totalCompletions}
            label={t("statCompletions")}
            divided
          />
        )}
        {stats.avgCompletionDays != null && stats.avgCompletionDays > 0 && (
          <Stat
            value={stats.avgCompletionDays}
            label={t("statAvgDays")}
            divided
          />
        )}
      </div>

      {/* Availability panel: aggregate only — no owner identities. Zero availability -> omit the
          panel; show the softer owners line instead when anyone owns it (spec). */}
      {availability.total > 0 ? (
        <section>
          <SectionHead
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={t("availabilityTitle")}
          />
          <div className="bg-jigsaw-primary/10 flex flex-wrap items-center gap-5 rounded-xl px-5 py-4">
            <div className="font-heading text-4xl font-bold leading-none">
              {availability.total}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t("copiesAvailableNow", { count: availability.total })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {chips.map(([type, n]) => (
                  <span
                    key={type}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      swapChipClasses(type),
                    )}
                  >
                    {t(
                      type === "swap"
                        ? "chipSwap"
                        : type === "lend"
                          ? "chipLend"
                          : "chipSale",
                      { count: n },
                    )}
                  </span>
                ))}
              </div>
            </div>
            {/* Three generic, non-identifying avatar circles: signals people without naming them. */}
            <div className="flex -space-x-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="bg-muted border-background text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full border-2"
                >
                  <UserRound className="h-4 w-4" />
                </span>
              ))}
            </div>
            <Button variant="brand" size="sm" asChild>
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
              >
                {t("joinToSeeWho")}
              </Link>
            </Button>
          </div>
        </section>
      ) : (
        stats.communityOwners > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("ownersHaveIt", { count: stats.communityOwners })}
          </p>
        )
      )}

      {/* Rating + reviews, two-column like the dashboard page. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section>
          <SectionHead icon={<StarGlyph />} title={t("communityRating")} />
          <div className="mb-3.5 flex items-end gap-3.5">
            <div className="font-heading text-foreground text-4xl font-bold leading-none">
              {rating.rating}
            </div>
            <div className="pb-0.5">
              <StarRating value={Math.round(rating.rating)} size="sm" />
              <div className="text-muted-foreground mt-1 text-xs">
                {t("ratingsCount", { count: rating.count })}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {[5, 4, 3, 2, 1].map((star, i) => (
              <div key={star} className="flex items-center gap-2.5">
                <span className="text-muted-foreground inline-flex w-7 items-center justify-end gap-0.5 text-xs">
                  {star}★
                </span>
                <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${rating.percentages[i]}%` }}
                  />
                </span>
                <span className="text-muted-foreground w-9 text-right font-mono text-xs">
                  {rating.percentages[i]}%
                </span>
              </div>
            ))}
          </div>
        </section>
        <PublicReviews puzzleId={puzzleId} />
      </div>
    </main>
  );
}

function PublicReviews({ puzzleId }: { puzzleId: string }) {
  const t = useTranslations("publicCatalog");
  const format = useFormatter();
  const { data: reviews } = useQuery(reviewsQuery(puzzleId));
  const list = reviews ?? [];
  const now = Date.now();

  return (
    <section>
      <SectionHead
        icon={<MessageCircle className="h-4 w-4" />}
        title={t("reviews")}
        meta={String(list.length)}
      />
      <div className="flex flex-col">
        {list.map((review, i) => (
          <PublicReviewRow
            key={review.id}
            review={review}
            relative={(ts) => format.relativeTime(new Date(ts), now)}
            last={i === list.length - 1}
          />
        ))}
        {list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noReviews")}</p>
        )}
      </div>
      {/* Read-only surface: in place of the composer, one muted line (spec). */}
      <p className="text-muted-foreground mt-4 text-sm">
        <Link
          href={`/sign-in?redirect_url=${encodeURIComponent(`/catalog/${puzzleId}`)}`}
          className="hover:underline"
        >
          {t("logInToReview")}
        </Link>
      </p>
    </section>
  );
}

function PublicReviewRow({
  review,
  relative,
  last,
}: {
  review: PublicReview;
  relative: (timestamp: number) => string;
  last: boolean;
}) {
  const t = useTranslations("publicCatalog");
  const name = review.author?.name ?? t("anonymousReviewer");
  return (
    <div className={cn("flex gap-3 py-3.5", !last && "border-border border-b")}>
      {review.author ? (
        <MemberAvatar name={review.author.name} avatar={review.author.avatar} />
      ) : (
        <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <UserRound className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              review.author
                ? "text-foreground"
                : "text-muted-foreground italic",
            )}
          >
            {name}
          </span>
          {review.rating != null && (
            <StarRating value={review.rating} size="sm" />
          )}
          <span className="text-muted-foreground text-xs">
            {relative(review.createdAt)}
          </span>
        </div>
        <p className="text-foreground/90 mt-1 text-sm leading-relaxed">
          {review.text}
        </p>
      </div>
    </div>
  );
}
```

Note on the sign-in/sign-up links: the app's Clerk routes are `sign-in.$.tsx` / `sign-up.$.tsx` and already consume a `redirect_url` search param (see `require-auth.ts`). Plain `href` strings with the query encoded are the same shape `requireAuth` throws.

- [ ] **Step 2: Unauthenticated `/puzzles/$id` → `/catalog/$id`**

In `apps/web/src/routes/_dashboard/route.tsx`, replace the `beforeLoad` line:

```ts
beforeLoad: ({ context, location }) => requireAuth({ context, location }),
```

with:

```ts
beforeLoad: ({ context, location }) => {
  // Public-catalog handoff (Phase 5 spec): an unauthenticated visit to a member puzzle page has a
  // public equivalent — send it there instead of the sign-in wall so member-shared puzzle links
  // work for everyone. All other dashboard paths keep the sign-in redirect.
  if (!context.userId) {
    const puzzleDetail = location.pathname.match(/^\/puzzles\/([^/]+)\/?$/);
    if (puzzleDetail) {
      throw redirect({ to: "/catalog/$id", params: { id: puzzleDetail[1] } });
    }
  }
  return requireAuth({ context, location });
},
```

and add `redirect` to the route file's `@tanstack/react-router` import.

- [ ] **Step 3: Composer public note on the member detail page**

In `apps/web/src/routes/_dashboard/puzzles/$id/index.tsx`, inside `ReviewsSection`'s composer block, directly after the `<StarRating ... label={t("rateOptional")} />` line, add:

```tsx
<p className="text-muted-foreground text-xs">{t("reviewPublicNote")}</p>
```

Add the key to `puzzleDefinition` in `en.json` + `source.json`:

```json
"reviewPublicNote": "Reviews also appear on the public puzzle catalogue."
```

and `nl.json`:

```json
"reviewPublicNote": "Reviews verschijnen ook in de openbare puzzelcatalogus."
```

- [ ] **Step 4: Verify the flows in the dev server**

Start `pnpm nx run web:dev --skip-nx-cache` in the background, then (unauthenticated):

Run: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:3001/puzzles/SOME_ID"` (grab a real approved id first: `cd packages/backend && npx convex run catalog/listAllPuzzles... ` is overkill — instead open `http://localhost:3001/catalog` output and grep an `/catalog/<id>` href: `curl -s http://localhost:3001/catalog | grep -o 'catalog/[a-z0-9]*' | head -1`).
Expected: `/puzzles/<id>` responds with a redirect (302/307) whose location is `/catalog/<id>`.

Run: `curl -s http://localhost:3001/catalog/<id> | grep -o "og:image\|og:title\|description" | sort -u`
Expected: `description`, `og:title` (and `og:image` when the puzzle has box art) present in the SSR output.

Stop the dev server.

- [ ] **Step 5: Type-check, format, commit**

```bash
pnpm nx run web:type-check --skip-nx-cache
pnpm prettier --write apps/web/src/routes/_public/catalog/ apps/web/src/routes/_dashboard/route.tsx "apps/web/src/routes/_dashboard/puzzles/\$id/index.tsx" apps/web/locales/
git add apps/web/src/routes/ apps/web/locales/ apps/web/src/routeTree.gen.ts
git commit -m "feat(web): public puzzle detail page, bidirectional redirects, composer public note"
```

---

### Task 11: robots.txt + sitemap.xml server routes

**Files:**

- Create: `apps/web/src/routes/robots[.]txt.ts`
- Create: `apps/web/src/routes/sitemap[.]xml.ts`

Both derive the origin from the incoming request (no hardcoded domain, no new env var). TanStack Start (v1.121+, installed: ^1.168) defines server handlers on `createFileRoute` via the `server.handlers` option; the bracket-escaped filenames map to the literal `/robots.txt` and `/sitemap.xml` paths.

- [ ] **Step 1: robots.txt route**

```ts
// apps/web/src/routes/robots[.]txt.ts
import { createFileRoute } from "@tanstack/react-router";

// Served dynamically (not a public/ static file) so the Sitemap line can carry the request's own
// origin — no hardcoded production domain in the repo. Private member teasers are excluded from
// crawling via their per-page noindex meta (Phase 1), not here.
export const Route = createFileRoute("/robots/txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = [
          "User-agent: *",
          "Allow: /",
          `Sitemap: ${origin}/sitemap.xml`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
```

NOTE: write the path string as whatever the router plugin generates for the file name `robots[.]txt.ts` — start the dev server once and let the plugin rewrite the `createFileRoute("...")` argument in place (it auto-corrects the literal); do not fight it by hand.

- [ ] **Step 2: sitemap.xml route**

```ts
// apps/web/src/routes/sitemap[.]xml.ts
import { gateway } from "@/gateway";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";

// Catalog URLs ONLY (Phase 5 spec): public member profiles are indexable but never sitemap-listed;
// private member teasers carry noindex. Data comes from the unauthenticated listSitemapEntries
// query via a plain HTTP client (same pattern as lib/require-admin.ts, minus auth).
export const Route = createFileRoute("/sitemap/xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const convex = new ConvexHttpClient(
          import.meta.env.VITE_CONVEX_URL as string,
        );
        const entries = await convex.query(gateway.catalog.sitemapEntries, {});
        const urls = [
          `  <url><loc>${origin}/catalog</loc></url>`,
          ...entries.map(
            (e) =>
              `  <url><loc>${origin}/catalog/${e.id}</loc><lastmod>${new Date(e.updatedAt).toISOString()}</lastmod></url>`,
          ),
        ].join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
```

**Contingency:** if `tsc` rejects the `server` route option, the installed Start version still uses the split server-route API — check `node_modules/@tanstack/react-start/dist` exports for `createServerFileRoute` and define `export const ServerRoute = createServerFileRoute().methods({ GET: ... })` in the same files instead; everything inside the handler is unchanged.

- [ ] **Step 3: Verify**

Start `pnpm nx run web:dev --skip-nx-cache` in the background (lets the plugin normalize the route literals), then:

Run: `curl -s http://localhost:3001/robots.txt`
Expected: the four robots lines, `Sitemap:` pointing at `http://localhost:3001/sitemap.xml`.

Run: `curl -s http://localhost:3001/sitemap.xml | head -5`
Expected: XML header + `<urlset` + a `/catalog` `<url>` entry (plus one per approved puzzle in the dev deployment).

Stop the dev server.

- [ ] **Step 4: Type-check, format, commit**

```bash
pnpm nx run web:type-check --skip-nx-cache
pnpm prettier --write "apps/web/src/routes/robots[.]txt.ts" "apps/web/src/routes/sitemap[.]xml.ts"
git add "apps/web/src/routes/robots[.]txt.ts" "apps/web/src/routes/sitemap[.]xml.ts" apps/web/src/routeTree.gen.ts
git commit -m "feat(web): robots.txt + catalog sitemap server routes"
```

---

### Task 12: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Backend suite**

Run: `cd packages/backend && npx vitest run`
Expected: PASS — the whole backend suite, including the pre-existing `getPuzzleDefinitionView.test.ts`, `catalogReads.test.ts`, `browseOwnedPuzzles.test.ts` (refactor guards) and the new `publicCatalog.test.ts` (13 tests).

- [ ] **Step 2: Type checks + lint, CI-mirrored**

Run: `pnpm nx run backend:type-check --skip-nx-cache && pnpm nx run web:type-check --skip-nx-cache && pnpm nx run web:lint --skip-nx-cache`
Expected: PASS. (Known noise: `routeTree.gen.ts` complaints resolve after the dev-server regeneration in Tasks 9–11; if they persist, restart the dev server once and re-run.)

- [ ] **Step 3: Format check**

Run: `pnpm prettier --check .`
Expected: clean. If not: `pnpm prettier --write` the listed files and amend the last commit.

- [ ] **Step 4: End-to-end smoke (dev server, logged out)**

Start `pnpm nx run web:dev --skip-nx-cache` in the background, then verify each:

1. `curl -s http://localhost:3001/catalog | grep -c "Puzzle catalogue"` → ≥ 1
2. `id=$(curl -s http://localhost:3001/catalog | grep -o 'catalog/[a-z0-9]\{20,\}' | head -1 | cut -d/ -f2)` then `curl -s http://localhost:3001/catalog/$id | grep -c "og:title"` → ≥ 1
3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/puzzles/$id` → 3xx (redirect to catalog)
4. `curl -s http://localhost:3001/robots.txt | grep -c Sitemap` → 1
5. `curl -s http://localhost:3001/sitemap.xml | grep -c "<urlset"` → 1
6. Marketing nav: `curl -s http://localhost:3001/about | grep -c 'href="/catalog"'` → ≥ 1

Stop the dev server. Report any failure with its output instead of claiming success.

- [ ] **Step 5: Wrap up**

The Phase 5 spec (`docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md`) rides along with this branch's first PR per repo convention — confirm it is committed. Then follow superpowers:finishing-a-development-branch.

---

## Self-review (performed at planning time)

- **Spec coverage:** routes + bidirectional redirects (T9/T10), nav entry (T9), list toolbar/grid/load-more/empty states (T9), definition card with conditional "N to swap" (T8), detail hero/single CTA/stats-hide-zero/availability panel with chips + generic avatars + zero-state owners line (T10), public availability aggregate with per-type breakdown + by-design asymmetry comment/test (T2/T3), public review projection with consent-gated avatar (T4), composer public note (T10), approved-only + optional-auth guard rails and leak tests (T3–T6), OG/description meta + robots + sitemap + SSR loaders (T9–T11). **Gaps, deliberate:** "Top rated" sort deferred (documented, header + T5 comment); meta descriptions are English-only (noted inline).
- **Placeholder scan:** no TBDs; the two framework-drift contingencies (convex codegen in T7, Start server-route API in T11) specify the exact alternative, not "figure it out".
- **Type consistency:** `PublicCatalogCardView.rating = {value, count}` (T1) matches T5's mapping from `ratingBreakdownOf` (`{rating, count}` → `{value: rating.rating, count: rating.count}`) and T8's `card.rating.value`; `publicAvailabilityOf(ctx, ownedCopies, cache?)` signature is identical at both call sites (T3 detail, T5 list); gateway names `publicBrowse`/`publicDefinitionView`/`sitemapEntries`/`listPublicPuzzleReviews` are used verbatim in T9/T10/T11.
