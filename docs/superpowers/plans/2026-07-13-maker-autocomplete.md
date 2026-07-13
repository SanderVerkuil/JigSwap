# Brand/Publisher/Series Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free-text autocomplete for publisher/brand/series on all four puzzle-definition forms, fed by distinct approved catalog values (publisher additionally seeded from the domain allowlist).

**Architecture:** Two new Convex catalog reads follow the existing `getAllBrands` distinct-over-index pattern; a single presentational `SuggestInput` (shadcn `Command`-in-`Popover` wrapped around the existing `Input`) replaces the plain inputs; pages fetch suggestion lists once via `convexQuery` and filter client-side with a pure tested helper.

**Tech Stack:** Convex (`convex-helpers` stream distinct), shadcn `command.tsx`/`popover.tsx` (already present), TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-maker-autocomplete-design.md`

**Branch:** `feat/maker-autocomplete`, stacked on `feat/publisher-brand-series` (PR targets that branch; retarget to main after PR #56 merges).

**Conventions:** TDD; `pnpm prettier --write` changed files before every commit; nx with `--skip-nx-cache`; backend test target is `coverage`; single test file via `cd <package> && pnpm vitest run <name>` (NOT `pnpm --dir`); new Convex function files need hand-edits to `packages/backend/convex/_generated/api.d.ts` (no deployment in worktrees); commits end with a blank line then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Domain — export the KNOWN_PUBLISHERS list

**Files:**

- Modify: `packages/domain/src/catalog/domain/known-publishers.ts`
- Test: `packages/domain/src/catalog/domain/known-publishers.spec.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to the existing `describe` in `known-publishers.spec.ts` (file uses `it`):

```ts
it("exposes the allowlist for suggestion seeding", () => {
  expect(KNOWN_PUBLISHERS).toContain("Jumbo");
  expect(KNOWN_PUBLISHERS).toContain("Ravensburger");
  expect(KNOWN_PUBLISHERS.length).toBeGreaterThanOrEqual(12);
});
```

and add `KNOWN_PUBLISHERS` to the import from `./known-publishers`.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/domain && pnpm vitest run known-publishers`
Expected: FAIL — `KNOWN_PUBLISHERS` is not exported.

- [ ] **Step 3: Implement** — in `known-publishers.ts`, change `const KNOWN_PUBLISHERS = [` to `export const KNOWN_PUBLISHERS = [` and extend its doc comment's first line to note the second consumer: publisher autocomplete seeding (`getAllPublishers`).

- [ ] **Step 4: Run tests**

Run: `pnpm nx test @jigswap/domain --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/domain/src/catalog/domain
git add packages/domain
git commit -m "feat(domain): export KNOWN_PUBLISHERS for suggestion seeding"
```

---

### Task 2: Backend — getAllPublishers + getAllSeries queries

**Files:**

- Create: `packages/backend/convex/catalog/getAllPublishers.ts`
- Create: `packages/backend/convex/catalog/getAllSeries.ts`
- Modify: `packages/contracts/src/catalog/views.ts` (next to `BrandView`, line ~101)
- Modify: `packages/gateway/src/operations.ts` (next to `allBrands`/`allTags`, lines ~53-54)
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-edit, two new modules)
- Test: `packages/backend/convex/makerSuggestions.test.ts` (new, at `convex/` root)

- [ ] **Step 1: Write failing tests** `makerSuggestions.test.ts`. Copy the harness preamble style from `catalogMutations.test.ts` (convexTest, `modules` glob). Seed rows directly with `t.run` (no auth needed — these are public reads):

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed one puzzles row; only maker fields + status vary per test.
const seedPuzzle = (
  t: ReturnType<typeof convexTest>,
  fields: {
    title: string;
    brand?: string;
    publisher?: string;
    series?: string;
    status?: "pending" | "approved" | "rejected" | "disabled";
  },
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
      series: fields.series,
      pieceCount: 1000,
      status: fields.status ?? "approved",
      submittedBy,
      createdAt: now,
      updatedAt: now,
    });
  });

describe("catalog.getAllPublishers", () => {
  test("merges the allowlist with distinct approved values, deduped case-insensitively", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, { title: "A", publisher: "jumbo" }); // dupes allowlist "Jumbo"
    await seedPuzzle(t, { title: "B", publisher: "Goliath" }); // not in allowlist
    await seedPuzzle(t, { title: "C", publisher: "Sneaky", status: "pending" }); // excluded

    const publishers = await t.query(
      api.catalog.getAllPublishers.getAllPublishers,
      {},
    );

    expect(publishers).toContain("Jumbo"); // canonical casing wins over "jumbo"
    expect(publishers).not.toContain("jumbo");
    expect(publishers).toContain("Ravensburger"); // allowlist present without data
    expect(publishers).toContain("Goliath"); // data value outside the allowlist
    expect(publishers).not.toContain("Sneaky"); // pending never leaks
    expect([...publishers]).toEqual(
      [...publishers].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("catalog.getAllSeries", () => {
  test("scopes to the given brand and falls back to all series", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, { title: "W1", brand: "Wasgij", series: "Mystery" });
    await seedPuzzle(t, { title: "W2", brand: "Wasgij", series: "Original" });
    await seedPuzzle(t, {
      title: "J1",
      brand: "Jan van Haasteren",
      series: "Junior",
    });
    await seedPuzzle(t, {
      title: "P1",
      brand: "Wasgij",
      series: "Hidden",
      status: "pending",
    });

    const scoped = await t.query(api.catalog.getAllSeries.getAllSeries, {
      brand: "Wasgij",
    });
    expect(scoped.sort()).toEqual(["Mystery", "Original"]); // no Junior, no pending Hidden

    const all = await t.query(api.catalog.getAllSeries.getAllSeries, {});
    expect(all.sort()).toEqual(["Junior", "Mystery", "Original"]);

    // Unknown maker: scoped list is empty -> fall back to all series.
    const fallback = await t.query(api.catalog.getAllSeries.getAllSeries, {
      brand: "Ravensburger",
    });
    expect(fallback.sort()).toEqual(["Junior", "Mystery", "Original"]);
  });

  test("scopes by publisher when no brand is given", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, {
      title: "R1",
      publisher: "Ravensburger",
      series: "Krypt",
    });
    await seedPuzzle(t, { title: "J1", publisher: "Jumbo", series: "Junior" });

    const scoped = await t.query(api.catalog.getAllSeries.getAllSeries, {
      publisher: "Ravensburger",
    });
    expect(scoped).toEqual(["Krypt"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && pnpm vitest run makerSuggestions`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Contracts + gateway.** In `packages/contracts/src/catalog/views.ts`, after the `BrandView` alias add:

```ts
/** A distinct publisher (company) name suggestion from the Catalog + curated allowlist. */
export type PublisherView = string;

/** A distinct series name suggestion from the Catalog. */
export type SeriesView = string;
```

In `packages/gateway/src/operations.ts`, after the `allTags` line add:

```ts
    allPublishers: api.catalog.getAllPublishers.getAllPublishers,
    allSeries: api.catalog.getAllSeries.getAllSeries,
```

- [ ] **Step 4: Implement `getAllPublishers.ts`:**

```ts
import { KNOWN_PUBLISHERS } from "@jigswap/domain";
import type { PublisherView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: publisher suggestions for the definition forms. Distinct publisher values over
// the by_publisher index (approved puzzles only, matching every sibling catalog read) MERGED with
// the domain's curated known-publishers allowlist, so suggestions are useful before any data
// carries a publisher. Case-insensitive dedupe; the allowlist's canonical casing wins.
export const getAllPublishers = query({
  args: {},
  handler: async (ctx): Promise<PublisherView[]> => {
    const rows = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_publisher", (q) => q)
      // filterWith (not .filter, which streams reject) is applied before distinct.
      .filterWith(async (p) => p.status === "approved")
      .distinct(["publisher"])
      .collect();

    const byLower = new Map<string, string>();
    for (const name of KNOWN_PUBLISHERS) byLower.set(name.toLowerCase(), name);
    for (const row of rows) {
      const value = row.publisher;
      if (!value) continue;
      if (!byLower.has(value.toLowerCase()))
        byLower.set(value.toLowerCase(), value);
    }
    return [...byLower.values()].sort((a, b) => a.localeCompare(b));
  },
});
```

- [ ] **Step 5: Implement `getAllSeries.ts`:**

```ts
import type { SeriesView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: series suggestions for the definition forms, scoped to the maker the member
// already entered so a Wasgij puzzle suggests Wasgij series, not Jan van Haasteren ones.
// Scope precedence: brand, else publisher, else (or when the scoped list is empty) ALL distinct
// series. Approved puzzles only, matching every sibling catalog read.
export const getAllSeries = query({
  args: {
    brand: v.optional(v.string()),
    publisher: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SeriesView[]> => {
    // Scoped path: one maker's puzzles are few, so collect + dedupe in JS.
    if (args.brand || args.publisher) {
      const rows = args.brand
        ? await ctx.db
            .query("puzzles")
            .withIndex("by_brand", (q) => q.eq("brand", args.brand))
            .collect()
        : await ctx.db
            .query("puzzles")
            .withIndex("by_publisher", (q) => q.eq("publisher", args.publisher))
            .collect();
      const scoped = [
        ...new Set(
          rows
            .filter((p) => p.status === "approved")
            .map((p) => p.series)
            .filter((s): s is string => !!s),
        ),
      ].sort((a, b) => a.localeCompare(b));
      if (scoped.length > 0) return scoped;
      // Unknown maker (or no series recorded for it yet): fall through to the global list.
    }

    const rows = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_series", (q) => q)
      // filterWith (not .filter, which streams reject) is applied before distinct.
      .filterWith(async (p) => p.status === "approved")
      .distinct(["series"])
      .collect();
    return rows
      .map((row) => row.series)
      .filter((s): s is string => !!s)
      .sort((a, b) => a.localeCompare(b));
  },
});
```

- [ ] **Step 6: Hand-edit `_generated/api.d.ts`** — mirror the existing `catalog/getAllBrands` registration exactly, in alphabetical order:

```ts
import type * as catalog_getAllPublishers from "../catalog/getAllPublishers.js";
import type * as catalog_getAllSeries from "../catalog/getAllSeries.js";
```

and in the modules map:

```ts
"catalog/getAllPublishers": typeof catalog_getAllPublishers;
"catalog/getAllSeries": typeof catalog_getAllSeries;
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm nx run @jigswap/backend:coverage --skip-nx-cache && pnpm nx run @jigswap/backend:type-check --skip-nx-cache && pnpm nx run @jigswap/contracts:type-check --skip-nx-cache`
Expected: PASS including the three new tests.

- [ ] **Step 8: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/contracts/src packages/gateway/src
git add packages
git commit -m "feat(backend): publisher and scoped series suggestion queries"
```

---

### Task 3: Web — filterSuggestions helper + SuggestInput component

**Files:**

- Create: `apps/web/src/components/add-puzzle/filter-suggestions.ts`
- Create: `apps/web/src/components/add-puzzle/filter-suggestions.test.ts`
- Create: `apps/web/src/components/add-puzzle/suggest-input.tsx`
- Modify: `apps/web/src/components/add-puzzle/index.ts` (export both)

- [ ] **Step 1: Write the failing helper test** `filter-suggestions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterSuggestions } from "./filter-suggestions";

const POOL = ["Jumbo", "Ravensburger", "Jan van Haasteren", "Wasgij"];

describe("filterSuggestions", () => {
  it("matches case-insensitive substrings", () => {
    expect(filterSuggestions(POOL, "jum")).toEqual(["Jumbo"]);
    expect(filterSuggestions(POOL, "AAS")).toEqual(["Jan van Haasteren"]);
  });

  it("returns everything (minus exact value) for an empty query", () => {
    expect(filterSuggestions(POOL, "")).toEqual(POOL);
  });

  it("excludes the exact current value, case-insensitively", () => {
    expect(filterSuggestions(POOL, "jumbo")).toEqual([]);
    expect(filterSuggestions(POOL, "Wasgij")).toEqual([]);
  });

  it("trims the query before matching", () => {
    expect(filterSuggestions(POOL, "  jum ")).toEqual(["Jumbo"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run filter-suggestions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filter-suggestions.ts`:**

```ts
// Client-side matching for SuggestInput: the suggestion pools are small distinct-value lists
// fetched once per form, so a case-insensitive substring filter is enough — no server search.
// The exact current value is excluded (suggesting what's already typed helps nobody).
export const filterSuggestions = (
  suggestions: readonly string[],
  value: string,
): string[] => {
  const query = value.trim().toLowerCase();
  return suggestions.filter((s) => {
    const lower = s.toLowerCase();
    if (lower === query) return false;
    return query.length === 0 || lower.includes(query);
  });
};
```

- [ ] **Step 4: Run helper tests**

Run: `cd apps/web && pnpm vitest run filter-suggestions`
Expected: PASS (4/4).

- [ ] **Step 5: Implement `suggest-input.tsx`.** Purely presentational; input stays the source of truth; suggestions never block free text:

```tsx
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useState } from "react";
import { filterSuggestions } from "./filter-suggestions";

// A free-text Input with an optional suggestion dropdown (publisher/brand/series fields).
// Selecting a suggestion just calls onChange with it — any typed value stays valid, so this
// is a drop-in Input replacement, not a select. Pure presentation: the caller owns the value
// and fetches the suggestion pool.
export interface SuggestInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
}

export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
}: SuggestInputProps) {
  const [focused, setFocused] = useState(false);
  const matches = filterSuggestions(suggestions, value).slice(0, 8);
  const open = focused && matches.length > 0;

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // Delay so a click on a CommandItem lands before the popover unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        // Keep keystrokes in the input: the popover must never steal focus.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {matches.map((suggestion) => (
                <CommandItem
                  key={suggestion}
                  value={suggestion}
                  onSelect={() => {
                    onChange(suggestion);
                    setFocused(false);
                  }}
                >
                  {suggestion}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

IMPORTANT implementation checks (adjust to what the repo's shadcn versions actually export — read the files):

- `popover.tsx` must export `PopoverAnchor`; if it doesn't, add the one-line re-export of `PopoverPrimitive.Anchor` following the file's existing pattern.
- If `--radix-popover-trigger-width` doesn't track the anchor width with `PopoverAnchor`, use `w-[var(--radix-popover-anchor-width)]` (check the Radix docs/behavior; pick whichever renders a dropdown matching the input's width).

- [ ] **Step 6: Export from `add-puzzle/index.ts`** — add `export { SuggestInput } from "./suggest-input";` and `export { filterSuggestions } from "./filter-suggestions";` following the file's existing export style.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm nx run @jigswap/web:type-check --skip-nx-cache && pnpm nx run @jigswap/web:lint --skip-nx-cache`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm prettier --write apps/web/src/components/add-puzzle
git add apps/web
git commit -m "feat(web): SuggestInput free-text combobox + suggestion filter helper"
```

---

### Task 4: Web — wire the two add pages

**Files:**

- Modify: `apps/web/src/routes/_dashboard/puzzles/add.tsx`
- Modify: `apps/web/src/routes/_dashboard/my-puzzles/add/new.tsx`

Both pages currently render plain `<Input>`s for publisher (`cp-publisher`/`ap-publisher`), brand (`cp-brand`/`ap-brand`), and series (`cp-series`/`ap-series`).

- [ ] **Step 1: Fetch the suggestion pools** in each page component (alongside the existing queries; both already import `convexQuery` and `useQuery` — `puzzles/add.tsx` imports `useMutation` from TanStack, add `useQuery`; `my-puzzles/add/new.tsx` already has both):

```ts
const { data: publisherSuggestions } = useQuery(
  convexQuery(gateway.catalog.allPublishers, {}),
);
const { data: brandSuggestions } = useQuery(
  convexQuery(gateway.catalog.allBrands, {}),
);
const { data: seriesSuggestions } = useQuery(
  convexQuery(gateway.catalog.allSeries, {
    brand: form.brand.trim() || undefined,
    publisher: form.publisher.trim() || undefined,
  }),
);
```

(`puzzles/add.tsx` also needs `convexQuery` added to its `@convex-dev/react-query` import.)

- [ ] **Step 2: Swap the three inputs for `SuggestInput`** (import it from `@/components/add-puzzle`, which both pages already import from). Keep ids, placeholders, labels, hints, and onChange BEHAVIOR identical — on the quick-add page every definition-field change must keep calling `setSelectedDefinitionId(null)`. Example for quick-add publisher (brand/series analogous):

```tsx
<SuggestInput
  id="ap-publisher"
  value={form.publisher}
  onChange={(value) => {
    setSelectedDefinitionId(null);
    setForm((f) => ({ ...f, publisher: value }));
  }}
  suggestions={publisherSuggestions ?? []}
  placeholder={t("fieldPublisherPlaceholder")}
/>
```

Contribute-page fields keep their simpler `setForm`-only onChange. `allBrands` returns `(string | undefined)[]` (`BrandView[]`) — pass `brandSuggestions?.filter((b): b is string => !!b) ?? []`.

- [ ] **Step 3: Typecheck + lint + web tests**

Run: `pnpm nx run @jigswap/web:type-check --skip-nx-cache && pnpm nx run @jigswap/web:lint --skip-nx-cache && cd apps/web && pnpm vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/puzzles/add.tsx apps/web/src/routes/_dashboard/my-puzzles/add/new.tsx
git add apps/web
git commit -m "feat(web): maker autocomplete on both add forms"
```

---

### Task 5: Web — suggest-edit fields + both edit pages + admin dialog

**Files:**

- Modify: `apps/web/src/components/suggest-edit/definition-fields.tsx`
- Modify: `apps/web/src/routes/_dashboard/puzzles/$id/suggest-edit.tsx`
- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/edit.tsx`
- Modify: `apps/web/src/components/admin/moderation/edit-approve-dialog.tsx`

- [ ] **Step 1: `definition-fields.tsx`** — add three optional props to `PuzzleDefinitionFieldsProps`, defaulting to empty (component stays usable without them):

```ts
  publisherSuggestions?: readonly string[];
  brandSuggestions?: readonly string[];
  seriesSuggestions?: readonly string[];
```

Swap the publisher/brand/series `<Input>`s for `<SuggestInput>` (import from `@/components/add-puzzle`, which the file already imports from), keeping `id={`${idPrefix}-…`}`, `tf(...)` labels/placeholders, and the `set("field", value)` writes:

```tsx
<SuggestInput
  id={`${idPrefix}-publisher`}
  value={form.publisher}
  onChange={(value) => set("publisher", value)}
  suggestions={publisherSuggestions ?? []}
  placeholder={tf("publisher.placeholder")}
/>
```

- [ ] **Step 2: Both pages rendering `PuzzleDefinitionFields`** (`suggest-edit.tsx` line ~238, `admin/puzzles/$puzzleId/edit.tsx` line ~175) — fetch the three pools exactly as in Task 4 Step 1 (series scoped by `form.brand`/`form.publisher` from each page's `ProposalFormState`), and pass:

```tsx
publisherSuggestions={publisherSuggestions ?? []}
brandSuggestions={brandSuggestions?.filter((b): b is string => !!b) ?? []}
seriesSuggestions={seriesSuggestions ?? []}
```

- [ ] **Step 3: `edit-approve-dialog.tsx`** — it renders react-hook-form `FormField`s for brand and publisher (no series). Fetch `allPublishers` + `allBrands` in the dialog component, and inside each `FormField`'s `render`, replace the `<Input {...field} placeholder={...} />` with:

```tsx
<SuggestInput
  id={field.name}
  value={field.value ?? ""}
  onChange={field.onChange}
  suggestions={publisherSuggestions ?? []} // or filtered brandSuggestions for the brand field
  placeholder={tForm("publisher.placeholder")}
/>
```

(Keep the `FormControl`/`FormLabel` wrappers as they are.)

- [ ] **Step 4: Typecheck + lint + full web tests**

Run: `pnpm nx run @jigswap/web:type-check --skip-nx-cache && pnpm nx run @jigswap/web:lint --skip-nx-cache && cd apps/web && pnpm vitest run`
Expected: PASS (proposal-diff suite untouched and green).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/components apps/web/src/routes
git add apps/web
git commit -m "feat(web): maker autocomplete in suggest-edit and admin edit flows"
```

---

### Task 6: Verify + stacked PR

- [ ] **Step 1: Full CI mirror**

Run: `pnpm nx run-many -t lint type-check test --skip-nx-cache && pnpm nx run @jigswap/backend:coverage --skip-nx-cache && pnpm prettier --check . 2>&1 | grep -v .clerk`
Expected: all green; no format warnings outside gitignored `.clerk`.

- [ ] **Step 2: Push and open the STACKED PR**

```bash
git push -u origin feat/maker-autocomplete
gh pr create --base feat/publisher-brand-series --title "feat(web): autocomplete for publisher/brand/series" --body "..."
```

PR body must note: stacked on #56 (retarget to main after it merges, per the repo's stacked-PR flow); suggestion sources (allowlist + approved distinct values); series scoping with fallback; free text everywhere preserved.

## Out of scope (do NOT do)

- Artist/tags autocomplete, fuzzy search, ranking, debouncing, curated entity tables.
- Any change to the migration or the `getAllBrands` query itself.
