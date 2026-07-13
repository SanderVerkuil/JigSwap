# Publisher vs. Brand vs. Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional free-text `publisher` field to puzzle definitions (the company: Jumbo, Ravensburger), narrowing `brand` to mean the product line (Jan van Haasteren, Wasgij), with a one-time allowlist migration that moves known publisher names out of `brand`.

**Architecture:** JigSwap is an Nx monorepo: `packages/domain` (pure DDD aggregates + use cases, vitest `.spec.ts`), `packages/backend` (Convex functions; adapters wrap the domain; tests are `.test.ts` at `convex/` root using convex-test), `packages/contracts` (view DTO types), `packages/gateway` (maps web calls to Convex functions), `apps/web` (TanStack Router + React). The `puzzles` table doubles as catalog definitions and pending submissions. Search runs over a derived `searchableText` column materialised on every domain save — publisher must join that projection and the migration must recompute it.

**Tech Stack:** TypeScript, Convex, Zod, vitest, convex-test, use-intl (3 locale files), Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-07-13-publisher-brand-series-design.md`

**Conventions that bite (from project memory):**

- Run tests/CI mirrors with `--skip-nx-cache` (Nx cache hides fresh failures).
- Run `pnpm prettier --write <changed files>` before every commit (CI `format:check` runs first).
- New Convex function **files** need a hand-edit to `packages/backend/convex/_generated/api.d.ts` (codegen needs a deployment we don't have in worktrees). Changed args of existing functions need nothing.
- Never name a backend local `use[A-Z]*` (trips react-hooks lint).
- `apps/web` typecheck may emit pre-existing `routeTree.gen` noise — ignore only that.

**Semantics being implemented** (repeat for every task): `publisher` = company (Jumbo, Ravensburger, Falcon). `brand` = product line (Jan van Haasteren, Wasgij); empty when the line IS the company. `series` = line within a brand (Original/Mystery/Junior). `artist` unchanged. Everything free text.

---

### Task 1: Domain — searchable-text helper + `publisher` on the aggregate

**Files:**

- Create: `packages/domain/src/catalog/domain/puzzle-searchable-text.ts`
- Modify: `packages/domain/src/catalog/domain/puzzle-definition.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`
- Modify: `packages/domain/src/catalog/application/ports/in/submit-puzzle-definition.port.ts` (add `readonly publisher?: string;` next to the existing `brand` line ~21)
- Modify: `packages/domain/src/catalog/application/use-cases/submit-puzzle-definition.ts`
- Modify: `packages/domain/src/catalog/application/use-cases/proposal-baseline.ts`
- Test: `packages/domain/src/catalog/domain/puzzle-definition.spec.ts` (extend existing)
- Test: `packages/domain/src/catalog/application/use-cases/proposal-baseline.spec.ts` (extend existing)

- [ ] **Step 1: Write failing tests** in `puzzle-definition.spec.ts`. Follow the file's existing helpers for building a definition (there are existing submit/update/searchableText tests — mirror their style; e.g. if there is a `submitValid()`/props helper, reuse it):

```ts
// In the submit() describe block:
test("carries publisher through submit()", () => {
  const result = PuzzleDefinition.submit({
    ...validSubmitProps(), // whatever fixture the file already uses
    brand: "Jan van Haasteren",
    publisher: "Jumbo",
  });
  expect(result.isOk).toBe(true);
  expect(result.value.toState().publisher).toBe("Jumbo");
});

// In the update() describe block:
test("update() patches publisher and leaves it alone when omitted", () => {
  const definition = /* existing fixture with publisher: undefined */;
  const patched = definition.update({ publisher: "Jumbo" }, new Date());
  expect(patched.isOk).toBe(true);
  expect(definition.toState().publisher).toBe("Jumbo");
  definition.update({ title: "New title" }, new Date());
  expect(definition.toState().publisher).toBe("Jumbo"); // omitted ⇒ unchanged
});

// In the searchableText describe block:
test("searchableText includes publisher", () => {
  const definition = /* fixture with title "Roadworks", publisher "Jumbo", brand "Jan van Haasteren" */;
  expect(definition.searchableText()).toContain("Jumbo");
  expect(definition.searchableText()).toContain("Jan van Haasteren");
});
```

And in `proposal-baseline.spec.ts`, mirror the existing per-field baseline test (see the `brand` case at `proposal-baseline.ts:17`) for `publisher`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/domain vitest run puzzle-definition proposal-baseline`
Expected: FAIL — `publisher` does not exist on the types.

- [ ] **Step 3: Implement.** Create `packages/domain/src/catalog/domain/puzzle-searchable-text.ts`:

```ts
// The searchable-fields projection shared by the aggregate (every save) and the one-shot
// publisher migration (which recomputes the column outside a full aggregate load).
export interface PuzzleSearchableParts {
  readonly title: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly tags?: readonly string[];
}

export const puzzleSearchableText = (parts: PuzzleSearchableParts): string =>
  [
    parts.title,
    parts.brand,
    parts.publisher,
    parts.artist,
    parts.series,
    ...(parts.tags ?? []),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
```

In `puzzle-definition.ts`:

1. Add `readonly publisher?: string;` right after the `brand` line in ALL THREE interfaces: `SubmitPuzzleDefinitionProps` (line ~25), `PuzzleDefinitionChanges` (line ~43), `PuzzleDefinitionState` (line ~62).
2. In `submit()`'s state literal, add `publisher: props.publisher,` after `brand: props.brand,` (line ~112).
3. In `update()`'s state merge, add `publisher: changes.publisher ?? this.state.publisher,` after the `brand` line (line ~221).
4. Replace the body of `searchableText()` with a delegation (add the import at top):

```ts
import { puzzleSearchableText } from "./puzzle-searchable-text";
// ...
  searchableText(): string {
    return puzzleSearchableText(this.state);
  }
```

In `domain/index.ts`, add (alphabetical position, after `puzzle-import-draft`... actually after `puzzle-definition`):

```ts
export * from "./puzzle-searchable-text";
```

In `use-cases/submit-puzzle-definition.ts`, pass `publisher: cmd.publisher,` after `brand: cmd.brand,` (line ~48). In the port file, add `readonly publisher?: string;` to `SubmitPuzzleDefinitionCommand` after `brand`.

In `use-cases/proposal-baseline.ts`, add after the `brand` line (line 17):

```ts
    publisher: changes.publisher !== undefined ? state.publisher : undefined,
```

- [ ] **Step 4: Run domain tests**

Run: `pnpm nx test @jigswap/domain --skip-nx-cache`
Expected: PASS (all, not just the new ones).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/domain/src/catalog
git add packages/domain
git commit -m "feat(domain): publisher field on PuzzleDefinition + shared searchable-text projection"
```

---

### Task 2: Domain — known-publishers matcher

**Files:**

- Create: `packages/domain/src/catalog/domain/known-publishers.ts`
- Create: `packages/domain/src/catalog/domain/known-publishers.spec.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Write the failing test** `known-publishers.spec.ts`:

```ts
import { describe, expect, test } from "vitest";
import { matchKnownPublisher } from "./known-publishers";

describe("matchKnownPublisher", () => {
  test("matches case-insensitively and returns canonical casing", () => {
    expect(matchKnownPublisher("ravensburger")).toBe("Ravensburger");
    expect(matchKnownPublisher("JUMBO")).toBe("Jumbo");
  });

  test("trims surrounding whitespace", () => {
    expect(matchKnownPublisher("  Falcon ")).toBe("Falcon");
  });

  test("returns undefined for product lines and unknowns", () => {
    expect(matchKnownPublisher("Jan van Haasteren")).toBeUndefined();
    expect(matchKnownPublisher("Wasgij")).toBeUndefined();
    expect(matchKnownPublisher("")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --dir packages/domain vitest run known-publishers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `known-publishers.ts`:

```ts
// Publisher companies (not product lines) for the one-shot brand→publisher migration and any
// future guidance UI. "Brand" values matching one of these are really the puzzle's PUBLISHER;
// lines like "Jan van Haasteren" or "Wasgij" are deliberately absent. Extend before re-running
// the migration — matching is exact (case-insensitive), never fuzzy.
const KNOWN_PUBLISHERS = [
  "Jumbo",
  "Ravensburger",
  "Falcon",
  "Schmidt",
  "Heye",
  "Clementoni",
  "Educa",
  "Trefl",
  "King",
  "Castorland",
  "Eurographics",
  "Gibsons",
] as const;

// The canonical publisher name for a raw brand value, or undefined when the value is not a
// known publisher company.
export const matchKnownPublisher = (brand: string): string | undefined => {
  const needle = brand.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  return KNOWN_PUBLISHERS.find((name) => name.toLowerCase() === needle);
};
```

Add `export * from "./known-publishers";` to `domain/index.ts` (alphabetical, after `is-private-ip`).

- [ ] **Step 4: Run tests**

Run: `pnpm nx test @jigswap/domain --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/domain/src/catalog/domain
git add packages/domain
git commit -m "feat(domain): known-publishers allowlist matcher for the brand→publisher migration"
```

---

### Task 3: Backend + contracts — schema, adapters, mutations, read views

**Files:**

- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/catalog/adapters/mapper.ts`
- Modify: `packages/backend/convex/catalog/submitPuzzleDefinition.ts`
- Modify: `packages/backend/convex/catalog/updatePuzzleDefinition.ts`
- Modify: `packages/backend/convex/catalog/proposeDefinitionChange.ts`
- Modify: `packages/backend/convex/catalog/proposalReadModel.ts`
- Modify: `packages/backend/convex/catalog/mappers.ts`
- Modify: `packages/backend/convex/catalog/getPublicDefinitionView.ts`
- Modify: `packages/contracts/src/catalog/views.ts`
- Modify: `packages/contracts/src/catalog/public.ts`
- Test: `packages/backend/convex/catalogMutations.test.ts` (extend)

All edits are the same mechanical move: **add a `publisher` line immediately after the existing `brand` line**, matching its exact optionality style. `editChangeProposal.ts` needs nothing — it reuses `proposalFieldArgs`/`toChanges` from `proposeDefinitionChange.ts`. No `_generated/api.d.ts` edit here (no new module; arg changes flow through `typeof` imports).

- [ ] **Step 1: Write failing tests** in `catalogMutations.test.ts`. Extend the existing `"submits as pending, materialises searchableText..."` test (line ~102): add `publisher: "Jumbo"` to the mutation args, then extend its row assertions:

```ts
expect(row?.publisher).toBe("Jumbo");
expect(row?.searchableText).toContain("Jumbo");
```

And add a new test to the `catalog.updatePuzzleDefinition` describe block, mirroring the file's existing update test structure (submit as alice, then update as alice):

```ts
test("patches publisher and re-materialises searchableText", async () => {
  const t = convexTest(schema, modules);
  await seedMember(t);
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Roadworks", brand: "Jan van Haasteren", pieceCount: 1000 },
  );
  await asAlice(t).mutation(
    api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
    { puzzleDefinitionId: id as string, publisher: "Jumbo" },
  );
  const row = await puzzleRow(t, id as string);
  expect(row?.publisher).toBe("Jumbo");
  expect(row?.searchableText).toContain("Jumbo");
  expect(row?.brand).toBe("Jan van Haasteren"); // untouched
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache -- catalogMutations`
(If nx arg-forwarding doesn't filter, run `pnpm --dir packages/backend vitest run catalogMutations`.)
Expected: FAIL — validator rejects unknown `publisher` arg / `row.publisher` type error.

- [ ] **Step 3: Implement**, file by file:

`schema.ts` — two spots:

1. In the `proposalFields` object (line ~10), after `brand: v.optional(v.string()),` add `publisher: v.optional(v.string()),`.
2. In the `puzzles` table (line ~97), after `brand: v.optional(v.string()),` add `publisher: v.optional(v.string()),`. After `.index("by_brand", ["brand"])` (line ~160) add `.index("by_publisher", ["publisher"])`.

`catalog/adapters/mapper.ts` — in `toDomain` add `publisher: row.publisher,` after `brand: row.brand,` (line 33); in `toRow` add `publisher: state.publisher,` after `brand: state.brand,` (line 62).

`catalog/submitPuzzleDefinition.ts` — add `publisher: v.optional(v.string()),` to `args` after `brand` (line 26); pass `publisher: args.publisher,` in the `submit({...})` call after `brand: args.brand,` (line 76).

`catalog/updatePuzzleDefinition.ts` — add `publisher: v.optional(v.string()),` to `args` after `brand` (line 26); add `publisher: args.publisher,` to the `changes` literal after `brand: args.brand,` (line 93).

`catalog/proposeDefinitionChange.ts` — three spots: `proposalFieldArgs` gets `publisher: v.optional(v.string()),` after `brand` (line 23); the `ProposalFieldArgs` type gets `publisher?: string;` after `brand` (line 61); `toChanges` gets `publisher: args.publisher,` after `brand: args.brand,` (line 86).

`catalog/proposalReadModel.ts` — in `currentFieldsFor`'s return, after the `brand` line (line 44):

```ts
    publisher: changes.publisher !== undefined ? puzzle.publisher : undefined,
```

`catalog/mappers.ts` — in `toPuzzleDefinitionView` add `publisher: row.publisher,` after `brand: row.brand,` (line 21). Leave `toPuzzleSummaryView` alone (cards don't show publisher).

`catalog/getPublicDefinitionView.ts` — in the returned `definition` object add `publisher: puzzle.publisher,` after `brand: puzzle.brand,` (line 50).

`packages/contracts/src/catalog/views.ts` — in `PuzzleDefinitionView` add `publisher?: string;` after `brand?: string;` (line 24). Leave `PuzzleSummaryView` and `AdminPuzzleDefinitionRowView` alone.

`packages/contracts/src/catalog/public.ts` — in `PublicDefinitionDetailView.definition` add `publisher?: string;` after `brand?: string;` (line 32). Leave `PublicCatalogCardView` alone.

- [ ] **Step 4: Run backend tests + typecheck**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache && pnpm nx type-check @jigswap/backend --skip-nx-cache`
Expected: PASS. (The full suite must stay green — the schema change is additive so existing seeds still validate.)

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/contracts/src
git add packages/backend packages/contracts
git commit -m "feat(backend): publisher field through schema, catalog mutations, proposals and read views"
```

---

### Task 4: Backend — one-shot brand→publisher migration

**Files:**

- Create: `packages/backend/convex/catalog/migratePublishers.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-edit — codegen needs a deployment)
- Test: `packages/backend/convex/migratePublishers.test.ts` (new, at `convex/` root per convention)

- [ ] **Step 1: Write the failing test** `migratePublishers.test.ts`. Copy the harness preamble (imports, `modules` glob, a member seeder) from `catalogMutations.test.ts`, but call the INTERNAL mutation via `internal` (import `{ internal }` from `./_generated/api`) — mirror how `catalogBackfill.test.ts` invokes `catalog/backfillCategories` if it differs:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed a bare puzzles row (legacy-style write, no aggregate) with the given brand/publisher.
const seedPuzzle = (
  t: ReturnType<typeof convexTest>,
  fields: { title: string; brand?: string; publisher?: string },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const submittedBy = await ctx.db.insert("users", {
      clerkId: `clerk_${fields.title}`,
      email: `${fields.title}@example.com`,
      name: fields.title,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("puzzles", {
      title: fields.title,
      brand: fields.brand,
      publisher: fields.publisher,
      pieceCount: 1000,
      searchableText: [fields.title, fields.brand].filter(Boolean).join(" "),
      status: "approved",
      submittedBy,
      createdAt: now,
      updatedAt: now,
    });
  });

describe("catalog.migratePublishers", () => {
  test("dry run reports moves without writing", async () => {
    const t = convexTest(schema, modules);
    const id = await seedPuzzle(t, { title: "Alpine", brand: "ravensburger" });
    const report = await t.mutation(internal.catalog.migratePublishers.run, {});
    expect(report.moved).toBe(1);
    expect(report.changes[0]).toEqual({
      title: "Alpine",
      from: "ravensburger",
      to: "Ravensburger",
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.brand).toBe("ravensburger"); // untouched: dryRun defaults to true
    expect(row?.publisher).toBeUndefined();
  });

  test("real run moves known publishers, clears brand, recomputes searchableText", async () => {
    const t = convexTest(schema, modules);
    const moved = await seedPuzzle(t, {
      title: "Alpine",
      brand: "ravensburger",
    });
    const line = await seedPuzzle(t, {
      title: "Roadworks",
      brand: "Jan van Haasteren",
    });
    const already = await seedPuzzle(t, {
      title: "Ocean",
      brand: "Jumbo",
      publisher: "Jumbo",
    });

    const report = await t.mutation(internal.catalog.migratePublishers.run, {
      dryRun: false,
    });
    expect(report.moved).toBe(1);

    const movedRow = await t.run(async (ctx) => ctx.db.get(moved));
    expect(movedRow?.publisher).toBe("Ravensburger");
    expect(movedRow?.brand).toBeUndefined();
    expect(movedRow?.searchableText).toContain("Ravensburger");
    expect(movedRow?.searchableText).toContain("Alpine");

    const lineRow = await t.run(async (ctx) => ctx.db.get(line));
    expect(lineRow?.brand).toBe("Jan van Haasteren"); // not a publisher: untouched

    const alreadyRow = await t.run(async (ctx) => ctx.db.get(already));
    expect(alreadyRow?.brand).toBe("Jumbo"); // has publisher already: skipped (idempotent)
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --dir packages/backend vitest run migratePublishers`
Expected: FAIL — `internal.catalog.migratePublishers` does not exist.

- [ ] **Step 3: Implement** `catalog/migratePublishers.ts`:

```ts
import { matchKnownPublisher, puzzleSearchableText } from "@jigswap/domain";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot migration for the publisher/brand split: `brand` values that are really publisher
// COMPANIES (per the domain known-publishers allowlist) move to the new `publisher` column and
// `brand` is cleared; product lines ("Jan van Haasteren", "Wasgij") and unknowns are untouched.
// searchableText is recomputed via the same domain projection the aggregate uses, so a search
// for "ravensburger" keeps matching after the value leaves `brand`.
// Idempotent: rows that already carry a publisher are skipped.
// Run manually (dry run FIRST, eyeball `changes`, then for real):
//   npx convex run catalog/migratePublishers:run
//   npx convex run catalog/migratePublishers:run '{"dryRun": false}'
export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true; // safe by default
    const puzzles = await ctx.db.query("puzzles").collect();

    const changes: Array<{ title: string; from: string; to: string }> = [];
    for (const puzzle of puzzles) {
      if (!puzzle.brand || puzzle.publisher) continue;
      const publisher = matchKnownPublisher(puzzle.brand);
      if (!publisher) continue;

      changes.push({ title: puzzle.title, from: puzzle.brand, to: publisher });
      if (dryRun) continue;

      await ctx.db.patch(puzzle._id, {
        brand: undefined, // Convex patch semantics: undefined REMOVES the field
        publisher,
        searchableText: puzzleSearchableText({
          title: puzzle.title,
          publisher,
          artist: puzzle.artist,
          series: puzzle.series,
          tags: puzzle.tags,
        }),
      });
    }
    return { dryRun, total: puzzles.length, moved: changes.length, changes };
  },
});
```

**Hand-edit `_generated/api.d.ts`** (new module file ⇒ codegen won't pick it up in a worktree): mirror the existing `catalog/backfillCategories` entry exactly — add the type import near its import line:

```ts
import type * as catalog_migratePublishers from "../catalog/migratePublishers.js";
```

(match the existing import path style in the file — `.js` suffix or not) and add to the modules mapping object, next to `"catalog/backfillCategories"`:

```ts
"catalog/migratePublishers": typeof catalog_migratePublishers;
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test @jigswap/backend --skip-nx-cache`
Expected: PASS, including both new migration tests.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex
git add packages/backend
git commit -m "feat(backend): one-shot brand→publisher migration with dry-run default"
```

**Note for the final PR description:** the migration must be run manually against each deployment after deploy — dry run first (`npx convex run catalog/migratePublishers:run`), inspect `changes`, then `'{"dryRun": false}'`.

---

### Task 5: Locales — publisher keys in en/nl/source

**Files:**

- Modify: `apps/web/locales/en.json`
- Modify: `apps/web/locales/nl.json`
- Modify: `apps/web/locales/source.json`

Apply the SAME structural edits to all three files (source.json mirrors en.json values — copy the English strings; check its existing structure to confirm).

- [ ] **Step 1: `forms.puzzle-form` namespace** (en.json line ~1985). After the `"brand"` object, add a sibling `"publisher"` object, and update brand's placeholder:

en.json / source.json:

```json
"brand": {
  "label": "Brand",
  "placeholder": "e.g. Jan van Haasteren, Wasgij"
},
"publisher": {
  "label": "Publisher",
  "placeholder": "e.g. Jumbo, Ravensburger"
},
```

nl.json:

```json
"brand": {
  "label": "Merk",
  "placeholder": "bijv. Jan van Haasteren, Wasgij"
},
"publisher": {
  "label": "Uitgever",
  "placeholder": "bijv. Jumbo, Ravensburger"
},
```

(The `publisher.label` key also automatically fixes the `ChangedFieldChips` label for publisher proposal diffs — it renders `tf("<key>.label")` generically.)

- [ ] **Step 2: `puzzles` namespace** (the add pages read `t("fieldBrand")`, `t("fieldBrandPlaceholder")`, `t("checkBrand")`, `t("addReadyHint")` — find these keys in each file and add siblings / update):

en.json / source.json additions next to `fieldBrand`:

```json
"fieldPublisher": "Publisher",
"fieldPublisherPlaceholder": "e.g. Jumbo, Ravensburger",
"brandOptionalHint": "The product line, like Jan van Haasteren or Wasgij. Leave empty when it's the same as the publisher.",
"checkPublisher": "Publisher",
```

Update existing values:

```json
"fieldBrandPlaceholder": "e.g. Jan van Haasteren, Wasgij",
"addReadyHint": "Fill in title, publisher, and piece count to continue.",
```

nl.json equivalents:

```json
"fieldPublisher": "Uitgever",
"fieldPublisherPlaceholder": "bijv. Jumbo, Ravensburger",
"brandOptionalHint": "De productlijn, zoals Jan van Haasteren of Wasgij. Laat leeg als die hetzelfde is als de uitgever.",
"checkPublisher": "Uitgever",
"fieldBrandPlaceholder": "bijv. Jan van Haasteren, Wasgij",
"addReadyHint": "Vul titel, uitgever en aantal stukjes in om verder te gaan."
```

(Adapt the exact nl `addReadyHint` phrasing to the current nl value's style — look at the existing string and swap merk→uitgever consistently.)

- [ ] **Step 3: Verify JSON is valid and keys consistent**

Run: `node -e "['en','nl','source'].forEach(l => JSON.parse(require('fs').readFileSync('apps/web/locales/'+l+'.json','utf8')) && console.log(l,'ok'))"`
Expected: `en ok`, `nl ok`, `source ok`.

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write apps/web/locales
git add apps/web/locales
git commit -m "feat(web): publisher locale strings; brand narrowed to product line"
```

---

### Task 6: Web — contribute page (`/puzzles/add`)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/puzzles/add.tsx`

New key-info layout: Title → [Publisher (required) | Piece count] → [Brand (optional, with hint) | Series] → Difficulty. Series MOVES out of the advanced collapsible (user request: series is key info); artist stays advanced.

- [ ] **Step 1: Implement.**

1. `FormState` (line ~51): add `publisher: string;` after `brand: string;`. `DEFAULT_FORM`: add `publisher: "",`.
2. `applyDraft` (line ~130): leave draft.brand → brand mapping as is (scraped drafts stay brand-only per spec; the user fills publisher manually).
3. `contribute` mutationFn `createPuzzle({...})` args (line ~178): add `publisher: form.publisher || undefined,` after the `brand` line.
4. `handleContribute` guard (line ~211) and `isReady` (line ~216): replace `form.brand.trim()` with `form.publisher.trim()`:

```ts
const isReady =
  !!form.title.trim() && !!form.publisher.trim() && !!form.pieceCount;
```

5. Replace the "Brand + Piece Count" grid (lines ~259–280) with two grids — Publisher+PieceCount, then Brand+Series (Series JSX moves up from the advanced section; delete it there and keep Artist alone in its grid):

```tsx
{
  /* Publisher + Piece Count */
}
<div className="grid grid-cols-2 gap-4">
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="cp-publisher">{t("fieldPublisher")}</Label>
    <Input
      id="cp-publisher"
      value={form.publisher}
      onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))}
      placeholder={t("fieldPublisherPlaceholder")}
    />
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="cp-pieces">{t("fieldPieceCount")}</Label>
    <PieceCountField
      id="cp-pieces"
      value={form.pieceCount}
      onChange={(n) => setForm((f) => ({ ...f, pieceCount: n }))}
    />
  </div>
</div>;

{
  /* Brand (product line) + Series — both optional */
}
<div className="grid grid-cols-2 gap-4">
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="cp-brand">
      {t("fieldBrand")}{" "}
      <span className="text-xs font-normal text-muted-foreground">
        {t("optional")}
      </span>
    </Label>
    <Input
      id="cp-brand"
      value={form.brand}
      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
      placeholder={t("fieldBrandPlaceholder")}
    />
    <p className="text-xs text-muted-foreground">{t("brandOptionalHint")}</p>
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="cp-series">{tf("series.label")}</Label>
    <Input
      id="cp-series"
      value={form.series}
      onChange={(e) => setForm((f) => ({ ...f, series: e.target.value }))}
      placeholder={tf("series.placeholder")}
    />
  </div>
</div>;
```

In the advanced collapsible, the old "Artist + Series" grid becomes Artist only (keep the grid wrapper with one child, or drop to a single full-width field — match the Model Number single-field pattern above it). 6. `LivePreviewCard` (line ~562): `brand={form.brand || form.publisher}` (the card shows one maker line; fall back to publisher when no line). 7. `ReadinessChecklist` (line ~575): change the brand item to `{ ok: !!form.publisher.trim(), label: t("checkPublisher") }`.

- [ ] **Step 2: Verify**

Run: `pnpm nx type-check @jigswap/web --skip-nx-cache && pnpm nx lint @jigswap/web --skip-nx-cache`
Expected: PASS (ignore only pre-existing routeTree.gen noise, if any).

- [ ] **Step 3: Commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/puzzles/add.tsx
git add apps/web
git commit -m "feat(web): contribute form asks publisher (required) + brand/series as key info"
```

---

### Task 7: Web — quick-add page (`/my-puzzles/add/new`)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/my-puzzles/add/new.tsx`

Same field treatment as Task 6, plus the prefill paths and a deliberate `isReady` fix.

- [ ] **Step 1: Implement.**

1. `FormState`/`DEFAULT_FORM` (lines ~67/92): add `publisher: string;` / `publisher: "",` after brand.
2. Definition prefill from `?puzzleId` (line ~161): in the `setForm` call add `publisher: specificPuzzle.publisher ?? "",` after the brand line (available on `PuzzleDefinitionView` since Task 3).
3. `applyDraft` (line ~206): unchanged (draft stays brand-only).
4. `MatchConfirm` `onUse` (line ~537): matched suggestions (`ImportedMatch`) don't carry publisher — leave the setForm as is; the isReady change below keeps submit unblocked.
5. `buildCreatePuzzleArgs` (line ~250): add `publisher: form.publisher || undefined,` after the brand line.
6. Guards and readiness (lines ~315, ~320, ~325): a selected existing definition must not be gated on definition fields (fixes a pre-existing quirk where a matched definition without a brand blocked submit):

```ts
const definitionReady =
  !!selectedDefinitionId ||
  (!!form.title.trim() && !!form.publisher.trim() && !!form.pieceCount);

const handleAdd = () => {
  if (!definitionReady) return;
  submitPuzzle.mutate({ andAnother: false });
};

const handleSaveAndAddAnother = () => {
  if (!definitionReady) return;
  submitPuzzle.mutate({ andAnother: true });
};

// In copy mode the definition is fixed, so only the copy fields gate submit.
const isReady = isCopyMode ? !!selectedDefinitionId : definitionReady;
```

(This is safe: every definition-field `onChange` already calls `setSelectedDefinitionId(null)`.) 7. Form fields (lines ~567–592): same restructure as Task 6 but with the `ap-` id prefix and the extra `setSelectedDefinitionId(null)` in each new field's onChange (publisher, brand, series — copy the existing brand onChange pattern). Layout: [Publisher | Piece count], then [Brand+hint | Series]. Remove Series from the advanced "Artist + Series" grid, leaving Artist. 8. Chosen-definition panel (line ~362) and `LivePreviewCard` (line ~898): where brand renders, fall back to publisher: `{specificPuzzle?.brand ?? specificPuzzle?.publisher ?? form.brand}` for the panel line (keep the surrounding conditional in sync: `(specificPuzzle?.brand || specificPuzzle?.publisher || form.brand)`), and `brand={(specificPuzzle?.brand || specificPuzzle?.publisher) ?? (form.brand || form.publisher)}` for the preview. 9. `ReadinessChecklist` (line ~913): brand item → `{ ok: !!form.publisher.trim(), label: t("checkPublisher") }`.

- [ ] **Step 2: Verify**

Run: `pnpm nx type-check @jigswap/web --skip-nx-cache && pnpm nx lint @jigswap/web --skip-nx-cache`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/my-puzzles/add/new.tsx
git add apps/web
git commit -m "feat(web): quick-add asks publisher (required) + optional brand/series"
```

---

### Task 8: Web — suggest-edit, admin edit forms, proposal diff

**Files:**

- Modify: `apps/web/src/components/suggest-edit/proposal-diff.ts`
- Modify: `apps/web/src/components/suggest-edit/definition-fields.tsx`
- Modify: `apps/web/src/components/forms/puzzle-form/puzzle-form-schema.ts`
- Modify: `apps/web/src/components/admin/moderation/edit-approve-dialog.tsx`
- Test: `apps/web/src/components/suggest-edit/proposal-diff.test.ts` (extend)

- [ ] **Step 1: Write failing tests** in `proposal-diff.test.ts`, mirroring the file's existing brand cases (read them first and copy their fixture style):

```ts
test("publisher round-trips: view → form, changed value → args, unchanged → omitted", () => {
  const view = { ...baseView, publisher: "Jumbo" }; // reuse the file's base fixture
  const form = formFromView(view);
  expect(form.publisher).toBe("Jumbo");

  expect(
    buildProposalArgs(view, { ...form, publisher: "Jumbo" }, []),
  ).toBeNull();

  const args = buildProposalArgs(
    view,
    { ...form, publisher: "Ravensburger" },
    [],
  );
  expect(args).toEqual({ publisher: "Ravensburger" });
});

test("overlayProposal prefers the stored publisher change", () => {
  const base = formFromView({ ...baseView, publisher: "Jumbo" });
  const overlaid = overlayProposal(
    base,
    { publisher: "Falcon" },
    undefined,
    [],
  );
  expect(overlaid.publisher).toBe("Falcon");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --dir apps/web vitest run proposal-diff`
Expected: FAIL — `publisher` missing from the types.

- [ ] **Step 3: Implement `proposal-diff.ts`** — add publisher after every brand occurrence:
- `ProposalTargetView`: `readonly publisher?: string;`
- `ProposalFormState`: `publisher: string;`
- `StoredProposalChanges`: `publisher?: string;`
- `ProposalArgs`: `publisher?: string;`
- `formFromView`: `publisher: view.publisher ?? "",`
- `overlayProposal`: `publisher: changes.publisher ?? base.publisher,`
- `buildProposalArgs` initial args object: `publisher: textChange(form.publisher, view.publisher),`

- [ ] **Step 4: Implement `definition-fields.tsx`** — find the Brand input (it renders `tf("brand.label")` with `id={`${idPrefix}-brand`}`) and add a Publisher input beside/above it following the exact same `Input`+`Label`+`set("publisher", ...)` pattern with `id={`${idPrefix}-publisher`}`, label `tf("publisher.label")`, placeholder `tf("publisher.placeholder")`. Match how brand/artist fields are grouped in that file (keep the layout consistent — if brand sits in a 2-col grid, put publisher in the same grid).

- [ ] **Step 5: Implement `puzzle-form-schema.ts`** (reused by the admin edit-approve dialog for validation) — after the `brand` field add:

```ts
  publisher: z
    .string()
    .max(50, "Publisher must be less than 50 characters")
    .optional(),
```

- [ ] **Step 6: Implement `edit-approve-dialog.tsx`** — it `pick`s fields from the shared zod schema (line ~47 `brand: true`), builds defaults (line ~59 `brand: submission.brand ?? ""`), renders a brand FormField (line ~141), and submits via the update mutation. Add publisher to each: the pick (`publisher: true,`), the defaults (`publisher: submission.publisher ?? "",` — the submission row is a `puzzles` doc so the field exists), a FormField cloned from the brand one using `tForm("publisher.label")`/`tForm("publisher.placeholder")`, and the mutation call payload (find where `brand` is passed on submit and add `publisher` the same way, including any `|| undefined` normalisation).

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --dir apps/web vitest run proposal-diff && pnpm nx type-check @jigswap/web --skip-nx-cache && pnpm nx lint @jigswap/web --skip-nx-cache`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm prettier --write apps/web/src/components
git add apps/web
git commit -m "feat(web): publisher in suggest-edit and admin definition edit flows"
```

---

### Task 9: Web — detail displays + full verification

**Files:**

- Modify: `apps/web/src/routes/_public/catalog/$id.tsx`
- Modify: `apps/web/src/components/details/puzzle-detail/puzzle-detail-header.tsx`
- Modify: `apps/web/src/components/admin/moderation/submission-detail.tsx`

Display rule everywhere: brand first, then publisher, dot-separated — "Jan van Haasteren · Jumbo · 1000 pieces".

- [ ] **Step 1: Public catalog detail** (`$id.tsx` line ~152). Replace:

```tsx
{
  definition.brand ? `${definition.brand} · ` : "";
}
```

with:

```tsx
{
  [definition.brand, definition.publisher]
    .filter(Boolean)
    .map((part) => `${part} · `)
    .join("");
}
```

Also line ~69 (SEO description): change `${d.brand ? ` by ${d.brand}` : ""}` to prefer the line but fall back to the company: `${d.brand || d.publisher ? ` by ${d.brand ?? d.publisher}` : ""}`.

- [ ] **Step 2: Dashboard copy detail header** (`puzzle-detail-header.tsx` line ~30). The component renders `puzzle.puzzle.brand` under the title. First trace the `puzzle` prop's type to its contract (it is a library/legacy view — check whether `puzzle.puzzle` is typed as a raw `Doc<"puzzles">`-shaped view or a contracts type in `packages/contracts/src/library/views.ts`). If the type carries `publisher` already (raw row), just render; if it's a contracts view with an explicit `brand?: string`, add `publisher?: string` beside it and add the field in the corresponding backend read mapper (grep the view type name in `packages/backend/convex` to find where brand is copied). Then replace the brand paragraph with:

```tsx
{
  (puzzle.puzzle.brand || puzzle.puzzle.publisher) && (
    <p className="text-lg text-muted-foreground">
      {[puzzle.puzzle.brand, puzzle.puzzle.publisher]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}
```

- [ ] **Step 3: Admin submission detail** (`submission-detail.tsx` line ~112) — same pattern: `{submission.brand && `${submission.brand} · `}` becomes the filter/join form above with `submission.publisher`. Same type-tracing rule as Step 2 if `submission` is a contracts view rather than a row.

- [ ] **Step 4: Full CI mirror**

Run: `pnpm nx run-many -t lint type-check test --skip-nx-cache`
Expected: everything green (only pre-existing `routeTree.gen` web-typecheck noise tolerated).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src
git add apps/web packages
git commit -m "feat(web): show publisher alongside brand on detail views"
```

---

## Out of scope (do NOT do)

- Curated publisher/brand entities, autocomplete, or a publisher catalog filter.
- Denormalized brand caches: `ownedPuzzles.snapshot`, `puzzleImportCache.draft`, completion-log fields, `toPuzzleSummaryView`, cards. All stay brand-only.
- The legacy unused `apps/web/src/components/forms/puzzle-form/` UI components (`puzzle-form-content.tsx`, `puzzle-form-root.tsx` — no route renders them). Only `puzzle-form-schema.ts` changes (Task 8) because the admin dialog reuses it.
- Renaming the stored `brand` column or backfilling anything besides the allowlist migration.
- Running the migration against a real deployment (manual post-deploy step, noted in Task 4).
