# Add-Puzzle Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the two add-puzzle flows to match the Claude Design handoff — `/my-puzzles/add` as a unified "find-or-create → add to library" screen (import zone, catalog + instance fields, cover colour, tags, notes, sticky live preview), and `/puzzles/add` as a contribute-only catalog form in the same visual language.

**Architecture:** New presentational components under `apps/web/src/components/add-puzzle/` built with the app's Tailwind v4 theme tokens + shadcn primitives (NOT the handoff's inline styles). Flow A composes existing gateway ops only (`catalog.createPuzzle` → `library.createOwned` → `library.updateSharing`), reusing the already-built `usePuzzleImport`/`extractFromUrl` import feature. Dedup is a frontend "same or different?" confirmation. No backend/schema changes (verified: acquiring an own _pending_ definition is allowed).

**Tech Stack:** TanStack Start + React, Tailwind v4 (`@theme inline`), shadcn/ui, react-hook-form + zod, lucide-react, convex/react, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-add-puzzle-redesign-design.md`
**Visual reference (verbatim handoff):** `docs/superpowers/design-reference/add-puzzle/addpuzzle.jsx` (+ `tokens/`). Implementers SHOULD open this for exact layout/spacing/structure, then translate to app idioms.

---

## Conventions

- Run from worktree root. Tests: `pnpm exec vitest run apps/web`. Web typecheck: `pnpm --filter @jigswap/web exec tsc --noEmit` (NOTE: ~39 pre-existing `routeTree.gen` errors are expected — only ensure you add no new ones outside that pattern; the nx `build` target generates `routeTree.gen` so `pnpm exec nx run @jigswap/web:type-check` is clean). **Before every commit run `pnpm exec prettier --write <changed files>`** — CI's first gate is `format:check`.
- Theme: Tailwind v4. Brand utilities exist: `bg-primary`/`text-primary-foreground` (violet), `bg-jigsaw-secondary` (green #19c316), `text-jigsaw-warning` (#f59e0b), `bg-jigsaw-primary`, `text-jigsaw-puzzle` (#ec4899). Built-in Tailwind colors (`amber-400`, `orange-500`, `emerald-500`, `red-500`) are available. Surfaces: `bg-card`, `bg-muted`, `bg-background`, `border-border`, `text-foreground`, `text-muted-foreground`. Radius: `rounded-md/lg/xl`, `rounded-full`.
- shadcn primitives in `apps/web/src/components/ui/`: `Button` (variants `default|outline|ghost|secondary|destructive|link|brand`; use `default` for primary CTAs, `outline`/`ghost` for secondary), `Input`, `Textarea`, `Badge` (`default|secondary|outline|destructive`), `Label`, `Card*`.
- Icons: `lucide-react` — `Link`, `Link2`, `Sparkles`, `CircleCheck`, `Check`, `Plus`, `X`, `Upload`, `Loader2`.

## File Structure

New (`apps/web/src/components/add-puzzle/`): `add-puzzle-schema.ts`, `add-puzzle-mappers.ts` (+`.test.ts`), `section-divider.tsx`, `segmented-pills.tsx`, `availability-chips.tsx`, `piece-count-field.tsx`, `cover-colour-field.tsx`, `tag-input.tsx`, `live-preview-card.tsx`, `import-zone.tsx`, `match-confirm.tsx`, `add-puzzle-layout.tsx`, `index.ts`.
Modify: `apps/web/src/routes/_dashboard/my-puzzles/add.tsx` (Flow A), `apps/web/src/routes/_dashboard/puzzles/add.tsx` (Flow B), `apps/web/src/styles/globals.css` (2 tint tokens), `apps/web/locales/{en,nl,source}.json`.
Reuse: `apps/web/src/components/puzzle-import/{use-puzzle-import,draft-to-form-defaults}.ts`.

---

## Task 1: Brand tint tokens

**Files:** Modify `apps/web/src/styles/globals.css`

The design uses violet/green _tint_ surfaces (import zone bg, selected chip bg) that aren't named tokens yet. Add two, derived from existing brand hues.

- [ ] **Step 1: Add tokens** — inside the existing `:root { ... }` block, after the `--jigsaw-*` declarations, add:

```css
/* Brand tint surfaces for forms/chips (Add-Puzzle redesign) */
--jigsaw-primary-tint: color-mix(in oklab, var(--jigsaw-primary) 9%, white);
--jigsaw-secondary-tint: color-mix(
  in oklab,
  var(--jigsaw-secondary) 14%,
  white
);
```

And in the `.dark { ... }` block add:

```css
--jigsaw-primary-tint: color-mix(
  in oklab,
  var(--jigsaw-primary) 22%,
  var(--card)
);
--jigsaw-secondary-tint: color-mix(
  in oklab,
  var(--jigsaw-secondary) 22%,
  var(--card)
);
```

In the `@theme inline { ... }` block, after `--color-jigsaw-*` mappings add:

```css
--color-jigsaw-primary-tint: var(--jigsaw-primary-tint);
--color-jigsaw-secondary-tint: var(--jigsaw-secondary-tint);
```

- [ ] **Step 2: Verify build picks them up**

Run: `pnpm exec nx run @jigswap/web:build`
Expected: builds clean (utilities `bg-jigsaw-primary-tint` / `bg-jigsaw-secondary-tint` now available).

- [ ] **Step 3: Format + commit**

```bash
pnpm exec prettier --write apps/web/src/styles/globals.css
git add apps/web/src/styles/globals.css
git commit -m "feat(web): add brand tint tokens for add-puzzle forms"
```

---

## Task 2: Schema + mappers (pure, TDD)

**Files:** Create `apps/web/src/components/add-puzzle/add-puzzle-schema.ts`, `add-puzzle-mappers.ts`, `add-puzzle-mappers.test.ts`

The Flow A form adds instance fields (condition, availability, notes, coverColor) to the catalog fields. Conditions: the design shows 4 pills but the backend enum is `new_sealed|like_new|good|fair|poor`. Map the 4 design labels → backend values.

- [ ] **Step 1: Write the schema**

```ts
// apps/web/src/components/add-puzzle/add-puzzle-schema.ts
import { z } from "zod";

// Backend Convex condition enum (library.createOwned).
export const CONDITION_VALUES = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
] as const;
export type ConditionValue = (typeof CONDITION_VALUES)[number];

// The four condition pills shown in the design, in order, each mapped to a backend value.
export const CONDITION_OPTIONS: ReadonlyArray<{
  label: string;
  value: ConditionValue;
}> = [
  { label: "Excellent", value: "like_new" },
  { label: "Good", value: "good" },
  { label: "Fair", value: "fair" },
  { label: "Poor", value: "poor" },
];

export const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy", dot: "bg-jigsaw-secondary" },
  { value: "medium", label: "Medium", dot: "bg-amber-400" },
  { value: "hard", label: "Hard", dot: "bg-orange-500" },
  { value: "expert", label: "Expert", dot: "bg-red-500" },
] as const;

export const PIECE_PRESETS = [300, 500, 750, 1000, 1500, 2000] as const;

export const COVER_SWATCHES = [
  "var(--jigsaw-primary)",
  "var(--jigsaw-secondary)",
  "var(--jigsaw-puzzle)",
  "var(--jigsaw-warning)",
  "#f97316", // orange-500
  "var(--jig-violet-700, #3a3f76)",
  "#0d680c", // green-700
  "#db2777", // pink-500
] as const;

// Flow A: add-to-library form (catalog + instance fields).
export const addToLibrarySchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  brand: z.string().min(1, "Brand is required").max(50),
  pieceCount: z.number().int().gte(1, "Piece count is required"),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  condition: z.enum(CONDITION_VALUES),
  availability: z.object({
    forTrade: z.boolean(),
    forLend: z.boolean(),
    forSale: z.boolean(),
  }),
  coverColor: z.string(),
  tags: z.array(z.string()),
  notes: z.string().max(1000).optional(),
  ean: z.string().optional(),
  upc: z.string().optional(),
});
export type AddToLibraryData = z.infer<typeof addToLibrarySchema>;
```

- [ ] **Step 2: Write the failing mapper test**

```ts
// apps/web/src/components/add-puzzle/add-puzzle-mappers.test.ts
import { describe, expect, it } from "vitest";
import {
  availabilityToSharing,
  hasAnyAvailability,
} from "./add-puzzle-mappers";

describe("availabilityToSharing", () => {
  it("maps availability flags to an updateSharing arg object with visibility visible", () => {
    expect(
      availabilityToSharing("copy1", {
        forTrade: true,
        forLend: false,
        forSale: true,
      }),
    ).toEqual({
      copyId: "copy1",
      visibility: "visible",
      forTrade: true,
      forLend: false,
      forSale: true,
    });
  });
});

describe("hasAnyAvailability", () => {
  it("is true when at least one flag is set", () => {
    expect(
      hasAnyAvailability({ forTrade: false, forLend: true, forSale: false }),
    ).toBe(true);
    expect(
      hasAnyAvailability({ forTrade: false, forLend: false, forSale: false }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm exec vitest run apps/web/src/components/add-puzzle/add-puzzle-mappers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement mappers**

```ts
// apps/web/src/components/add-puzzle/add-puzzle-mappers.ts
export interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export const hasAnyAvailability = (a: Availability): boolean =>
  a.forTrade || a.forLend || a.forSale;

// Shape matches gateway.library.updateSharing args.
export const availabilityToSharing = (copyId: string, a: Availability) => ({
  copyId,
  visibility: "visible" as const,
  forTrade: a.forTrade,
  forLend: a.forLend,
  forSale: a.forSale,
});
```

- [ ] **Step 5: Run — expect PASS**, then format + commit

```bash
pnpm exec vitest run apps/web/src/components/add-puzzle/add-puzzle-mappers.test.ts
pnpm exec prettier --write apps/web/src/components/add-puzzle/add-puzzle-schema.ts apps/web/src/components/add-puzzle/add-puzzle-mappers.ts apps/web/src/components/add-puzzle/add-puzzle-mappers.test.ts
git add apps/web/src/components/add-puzzle
git commit -m "feat(web): add-puzzle schema + availability/sharing mappers"
```

---

## Task 3: SectionDivider

**Files:** Create `apps/web/src/components/add-puzzle/section-divider.tsx`

Labelled hairline divider ("or enter the details yourself", "cover & extras"). Ref: `addpuzzle.jsx` `Divider` (lines 237-244).

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/section-divider.tsx
export const SectionDivider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3.5">
    <span className="h-px flex-1 bg-border" />
    <span className="text-xs uppercase tracking-[0.06em] whitespace-nowrap text-muted-foreground">
      {label}
    </span>
    <span className="h-px flex-1 bg-border" />
  </div>
);
```

- [ ] **Step 2: Typecheck (nx) + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/section-divider.tsx
git add apps/web/src/components/add-puzzle/section-divider.tsx
git commit -m "feat(web): add SectionDivider"
```

---

## Task 4: SegmentedPills

**Files:** Create `apps/web/src/components/add-puzzle/segmented-pills.tsx`

Single-select pill row with optional leading colour dot (Difficulty, Condition). Ref: `addpuzzle.jsx` `Segmented` (lines 36-51). Selected pill: `bg-primary text-primary-foreground`; unselected: `bg-card border text-foreground`. Dot uses a Tailwind bg class (from `DIFFICULTY_OPTIONS[].dot`); white when selected.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/segmented-pills.tsx
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  dot?: string; // tailwind bg-* class for the leading dot
}

export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={[
              "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold cursor-pointer border transition-colors",
              on
                ? "bg-primary text-primary-foreground border-transparent"
                : "bg-card text-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {o.dot && (
              <span
                className={[
                  "size-2.5 rounded-[3px]",
                  on ? "bg-white" : o.dot,
                ].join(" ")}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/segmented-pills.tsx
git add apps/web/src/components/add-puzzle/segmented-pills.tsx
git commit -m "feat(web): add SegmentedPills"
```

---

## Task 5: AvailabilityChips

**Files:** Create `apps/web/src/components/add-puzzle/availability-chips.tsx`

Multi-select chips (For Trade / For Lend / For Sale). Ref: `addpuzzle.jsx` `ChipMulti` (lines 52-65). Active: green tint (`bg-jigsaw-secondary-tint`, `text-jigsaw-secondary`, green border) + Check icon; inactive: card bg + Plus icon.

- [ ] **Step 1: Implement** — operate on the `Availability` object from `add-puzzle-mappers`:

```tsx
// apps/web/src/components/add-puzzle/availability-chips.tsx
import { Check, Plus } from "lucide-react";
import type { Availability } from "./add-puzzle-mappers";

const CHIPS: ReadonlyArray<{ key: keyof Availability; label: string }> = [
  { key: "forTrade", label: "For Trade" },
  { key: "forLend", label: "For Lend" },
  { key: "forSale", label: "For Sale" },
];

export function AvailabilityChips({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (v: Availability) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map(({ key, label }) => {
        const on = value[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...value, [key]: !on })}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold cursor-pointer border transition-colors",
              on
                ? "bg-jigsaw-secondary-tint text-jigsaw-secondary border-jigsaw-secondary/40"
                : "bg-card text-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {on ? (
              <Check className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/availability-chips.tsx
git add apps/web/src/components/add-puzzle/availability-chips.tsx
git commit -m "feat(web): add AvailabilityChips"
```

---

## Task 6: PieceCountField

**Files:** Create `apps/web/src/components/add-puzzle/piece-count-field.tsx`

Numeric `Input` + preset chips (300/500/750/1000/1500/2000). Ref: `addpuzzle.jsx` lines 145-152. Value is a `number | undefined`; presets set the number; a selected preset chip gets the violet tint.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/piece-count-field.tsx
import { Input } from "@/components/ui/input";
import { PIECE_PRESETS } from "./add-puzzle-schema";

export function PieceCountField({
  value,
  onChange,
  id,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value ?? ""}
        placeholder="1000"
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {PIECE_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              "rounded-full border px-2.5 py-1 font-mono text-xs cursor-pointer transition-colors",
              value === n
                ? "bg-jigsaw-primary-tint text-primary border-border"
                : "bg-card text-muted-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/piece-count-field.tsx
git add apps/web/src/components/add-puzzle/piece-count-field.tsx
git commit -m "feat(web): add PieceCountField"
```

---

## Task 7: CoverColourField

**Files:** Create `apps/web/src/components/add-puzzle/cover-colour-field.tsx`

Swatch row + dashed "Upload photo". Ref: `addpuzzle.jsx` lines 169-179. Selected swatch (when no uploaded file) gets a ring. Emits the chosen colour and (when uploaded) the `File`.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/cover-colour-field.tsx
import { Upload } from "lucide-react";
import { COVER_SWATCHES } from "./add-puzzle-schema";

export function CoverColourField({
  color,
  hasPhoto,
  onColor,
  onPhoto,
}: {
  color: string;
  hasPhoto: boolean;
  onColor: (c: string) => void;
  onPhoto: (file: File) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {COVER_SWATCHES.map((c) => {
        const selected = color === c && !hasPhoto;
        return (
          <button
            key={c}
            type="button"
            aria-label="cover colour"
            onClick={() => onColor(c)}
            style={{
              background: `linear-gradient(140deg, ${c}, color-mix(in oklab, ${c}, black 30%))`,
            }}
            className={[
              "size-9 rounded-md cursor-pointer shadow-[0_0_0_1px_var(--border)]",
              selected ? "ring-2 ring-foreground" : "ring-2 ring-transparent",
            ].join(" ")}
          />
        );
      })}
      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3.5 text-sm font-semibold text-muted-foreground hover:bg-accent">
        <Upload className="size-3.5" /> Upload photo
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhoto(file);
          }}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/cover-colour-field.tsx
git add apps/web/src/components/add-puzzle/cover-colour-field.tsx
git commit -m "feat(web): add CoverColourField"
```

---

## Task 8: TagInput

**Files:** Create `apps/web/src/components/add-puzzle/tag-input.tsx`

Chip tag editor — Enter adds, Backspace on empty removes last, X removes a chip. Ref: `addpuzzle.jsx` lines 181-190.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/tag-input.tsx
import { X } from "lucide-react";
import { useState } from "react";

export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, "");
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-jigsaw-primary-tint py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-primary"
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="inline-flex cursor-pointer"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length ? "" : "landscape, ocean, calm…"}
        className="min-w-[120px] flex-1 border-none bg-transparent px-0.5 py-0.5 text-sm text-foreground outline-none"
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/tag-input.tsx
git add apps/web/src/components/add-puzzle/tag-input.tsx
git commit -m "feat(web): add TagInput"
```

---

## Task 9: LivePreviewCard + readiness checklist

**Files:** Create `apps/web/src/components/add-puzzle/live-preview-card.tsx`

A lightweight presentational card driven by plain props (NOT the gateway-typed PuzzleCards). Cover = uploaded photo URL if present, else a gradient from `coverColor`. Shows "Available" badge when `available`, title, brand, piece count, difficulty badge, and View/Add buttons (non-functional in preview). Plus a readiness checklist. Ref: `addpuzzle.jsx` preview column (lines 206-228) + `PuzzleCard` in `screens.jsx`.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/add-puzzle/live-preview-card.tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export interface LivePreviewProps {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  coverColor: string;
  coverPhotoUrl?: string;
  available: boolean;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export function LivePreviewCard(props: LivePreviewProps) {
  const cover = props.coverPhotoUrl
    ? {
        backgroundImage: `url(${props.coverPhotoUrl})`,
        backgroundSize: "cover",
      }
    : {
        background: `linear-gradient(150deg, ${props.coverColor}, color-mix(in oklab, ${props.coverColor}, black 35%))`,
      };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative aspect-square w-full" style={cover}>
        {props.available && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-jigsaw-secondary px-2.5 py-1 text-xs font-semibold text-white">
            <span className="size-1.5 rounded-full bg-white" /> Available
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-4">
          <div className="font-semibold text-white">
            {props.title || "Your puzzle title"}
          </div>
          <div className="text-sm text-white/80">{props.brand || "Brand"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="text-sm">
          <span className="font-semibold">{props.pieceCount ?? 0}</span> pieces
        </span>
        {props.difficulty && (
          <Badge variant="outline">{DIFFICULTY_LABEL[props.difficulty]}</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <Button variant="outline" size="sm" type="button" disabled>
          View
        </Button>
        <Button size="sm" type="button" disabled>
          Add
        </Button>
      </div>
    </div>
  );
}

export function ReadinessChecklist({
  items,
}: {
  items: ReadonlyArray<{ ok: boolean; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
      {items.map((c) => (
        <div
          key={c.label}
          className={[
            "flex items-center gap-2.5 text-sm",
            c.ok ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex size-[18px] items-center justify-center rounded-full",
              c.ok ? "bg-jigsaw-secondary text-white" : "bg-muted",
            ].join(" ")}
          >
            {c.ok && <Check className="size-3" />}
          </span>
          {c.label}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/live-preview-card.tsx
git add apps/web/src/components/add-puzzle/live-preview-card.tsx
git commit -m "feat(web): add LivePreviewCard + ReadinessChecklist"
```

---

## Task 10: ImportZone + MatchConfirm

**Files:** Create `apps/web/src/components/add-puzzle/import-zone.tsx`, `apps/web/src/components/add-puzzle/match-confirm.tsx`

Restyle the existing import feature into the violet-tinted card (Ref: `addpuzzle.jsx` lines 106-131), reusing `usePuzzleImport` (`@/components/puzzle-import/use-puzzle-import`) and `ImportedDraft`/`ImportedMatch`. On a ready draft it calls `onDraft`; on a match it surfaces `MatchConfirm` (the "we found 'X' — same or different?" banner) which calls `onUseMatch(match)` or `onIgnoreMatch()`.

- [ ] **Step 1: Implement `match-confirm.tsx`**

```tsx
// apps/web/src/components/add-puzzle/match-confirm.tsx
import { Button } from "@/components/ui/button";
import type { ImportedMatch } from "@/components/puzzle-import/use-puzzle-import";

export function MatchConfirm({
  match,
  onUse,
  onIgnore,
}: {
  match: ImportedMatch;
  onUse: () => void;
  onIgnore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <span className="text-sm">
        We found{" "}
        <strong>
          {match.title}
          {match.brand ? ` · ${match.brand}` : ""} · {match.pieceCount} pieces
        </strong>{" "}
        already — is this the same puzzle?
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onUse}>
          Use this one
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onIgnore}>
          No, it&apos;s different
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `import-zone.tsx`**

```tsx
// apps/web/src/components/add-puzzle/import-zone.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  usePuzzleImport,
  type ImportedDraft,
  type ImportedMatch,
} from "@/components/puzzle-import/use-puzzle-import";
import { CircleCheck, Link, Link2, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

export function ImportZone({
  onDraft,
  onMatch,
}: {
  onDraft: (draft: ImportedDraft) => void;
  onMatch: (match: ImportedMatch) => void;
}) {
  const t = useTranslations("puzzles");
  const { state, run } = usePuzzleImport();
  const [url, setUrl] = useState("");

  // Stable callback refs so the prefill effect never captures stale closures.
  const onDraftRef = useRef(onDraft);
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    onDraftRef.current = onDraft;
    onMatchRef.current = onMatch;
  });

  const draftKey = state.status === "ready" ? state.draft.sourceUrl : null;
  const matchKey =
    state.status === "ready" ? (state.match?.puzzleId ?? null) : null;
  useEffect(() => {
    if (state.status !== "ready") return;
    if (state.match) onMatchRef.current(state.match);
    else onDraftRef.current(state.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, matchKey]);

  return (
    <section className="rounded-xl border border-primary/25 bg-jigsaw-primary-tint p-5">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="inline-flex size-[30px] items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Link className="size-4" />
        </span>
        <span className="font-heading text-lg font-bold">
          {t("importFromUrl")}
        </span>
      </div>
      <p className="mb-3 ml-10 text-sm text-foreground/80">
        {t("importUrlBlurb")}
      </p>
      <div className="ml-10 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) void run(url.trim());
            }}
            placeholder="https://www.ravensburger.com/…"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          onClick={() => url.trim() && run(url.trim())}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t("importFetching")}
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> {t("importFetch")}
            </>
          )}
        </Button>
      </div>
      <div className="ml-10 mt-2 min-h-[18px]">
        {state.status === "ready" && !state.match && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-jigsaw-secondary">
            <CircleCheck className="size-3.5" /> {t("importImported")}
          </span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-muted-foreground">
            {t("importFailed")}
          </span>
        )}
      </div>
    </section>
  );
}
```

> Note: this duplicates the prefill/effect logic of the existing `PuzzleImportBar` but in the design's styling. The match banner (`MatchConfirm`) is rendered by the host screen (Task 12), not here, so the host controls the find-or-create branch.

- [ ] **Step 3: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/import-zone.tsx apps/web/src/components/add-puzzle/match-confirm.tsx
git add apps/web/src/components/add-puzzle/import-zone.tsx apps/web/src/components/add-puzzle/match-confirm.tsx
git commit -m "feat(web): add ImportZone + MatchConfirm"
```

---

## Task 11: AddPuzzleLayout + barrel

**Files:** Create `apps/web/src/components/add-puzzle/add-puzzle-layout.tsx`, `apps/web/src/components/add-puzzle/index.ts`

Two-column responsive shell: form (`minmax(0,1fr)`) + 332px sticky aside, max-w 1080; single column under `lg`. Ref: `addpuzzle.jsx` lines 101-102, 206-207.

- [ ] **Step 1: Implement layout**

```tsx
// apps/web/src/components/add-puzzle/add-puzzle-layout.tsx
import type { ReactNode } from "react";

export function AddPuzzleLayout({
  form,
  preview,
}: {
  form: ReactNode;
  preview: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1080px] grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_332px]">
      <div className="flex flex-col gap-8">{form}</div>
      <aside className="flex flex-col gap-3.5 lg:sticky lg:top-2">
        {preview}
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Barrel**

```ts
// apps/web/src/components/add-puzzle/index.ts
export * from "./add-puzzle-layout";
export * from "./add-puzzle-mappers";
export * from "./add-puzzle-schema";
export * from "./availability-chips";
export * from "./cover-colour-field";
export * from "./import-zone";
export * from "./live-preview-card";
export * from "./match-confirm";
export * from "./piece-count-field";
export * from "./section-divider";
export * from "./segmented-pills";
export * from "./tag-input";
```

- [ ] **Step 3: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/components/add-puzzle/add-puzzle-layout.tsx apps/web/src/components/add-puzzle/index.ts
git add apps/web/src/components/add-puzzle/add-puzzle-layout.tsx apps/web/src/components/add-puzzle/index.ts
git commit -m "feat(web): add AddPuzzleLayout + barrel"
```

---

## Task 12: Flow A — rebuild `/my-puzzles/add`

**Files:** Modify `apps/web/src/routes/_dashboard/my-puzzles/add.tsx` (full rewrite of the component body; keep the `Route` export + `validateSearch`)

Compose the new components into the unified screen. State: a single `form` object (title, brand, pieceCount, difficulty, condition, availability, coverColor, coverFile, tags, notes, ean, upc) + `selectedDefinitionId` (set when the user confirms a match) + `pendingMatch` (for the MatchConfirm banner). Build the page from `AddPuzzleLayout`.

**Submit ("Add to Library") logic** — verbatim:

```tsx
const handleAdd = async () => {
  setSubmitting(true);
  try {
    // 1. Resolve the catalog definition id (existing match or create new).
    let definitionId = selectedDefinitionId;
    if (!definitionId) {
      let imageId: Id<"_storage"> | undefined;
      if (form.coverFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": form.coverFile.type },
          body: form.coverFile,
        });
        if (!res.ok) throw new Error("Image upload failed");
        const { storageId } = await res.json();
        imageId = storageId;
      }
      definitionId = (await createPuzzle({
        title: form.title,
        brand: form.brand || undefined,
        pieceCount: form.pieceCount!,
        difficulty: form.difficulty,
        tags: form.tags,
        ean: form.ean || undefined,
        upc: form.upc || undefined,
        image: imageId,
      })) as string;
    }

    // 2. Acquire a copy of that definition.
    const copyId = (await createOwned({
      puzzleDefinitionId: definitionId,
      condition: form.condition,
      notes: form.notes || undefined,
    })) as string;

    // 3. Apply availability if any chip is on.
    if (hasAnyAvailability(form.availability)) {
      await updateSharing(availabilityToSharing(copyId, form.availability));
    }

    toast.success(t("puzzleAdded"));
    router.push("/puzzles");
  } catch (error) {
    console.error("Add to library failed:", error);
    toast.error(t("puzzleCreationFailed"));
  } finally {
    setSubmitting(false);
  }
};
```

Hooks: `createPuzzle = useMutation(gateway.catalog.createPuzzle)`, `createOwned = useMutation(gateway.library.createOwned)`, `updateSharing = useMutation(gateway.library.updateSharing)`, `generateUploadUrl = useMutation(gateway.library.generateUploadUrl)`, `importImage = useAction(gateway.catalog.importPuzzleImage)` (for an imported remote cover, mirror the existing route's pattern: if no `coverFile` but the import provided a remote image URL, call `importImage({ url })` for the storage id).

**Import / find-existing wiring:**

- `<ImportZone onDraft={applyDraft} onMatch={(m) => setPendingMatch(m)} />`. `applyDraft(draft)` fills `form` via the existing `draftToFormDefaults` mapping (adapt to the new `form` shape) and stores the draft's remote `imageUrl` for step-1 image handling.
- When `pendingMatch` is set, render `<MatchConfirm match={pendingMatch} onUse={() => { setSelectedDefinitionId(pendingMatch.aggregateId ?? null); /* prefill title/brand/pieces from match */ setPendingMatch(null); }} onIgnore={() => setPendingMatch(null)} />` directly under the ImportZone.
- A typed search box (reuse `gateway.catalog.puzzleSuggestions` + `gateway.catalog.myContributedPuzzles` like the current route) may surface existing puzzles → selecting one sets `selectedDefinitionId` + prefills. (Keep this lightweight; the import+EAN path is primary.)

**Form column** (in order, with `SectionDivider`s): ImportZone (+ MatchConfirm), divider "or enter the details yourself", Title (`Input`), Brand+PieceCount grid (`Input` + `PieceCountField`), Difficulty (`SegmentedPills` w/ `DIFFICULTY_OPTIONS`), Condition (`SegmentedPills` mapping `CONDITION_OPTIONS`), Availability (`AvailabilityChips`), divider "cover & extras", `CoverColourField`, `TagInput`, Notes (`Textarea`), footer buttons (`Add to Library` [disabled until title&&brand&&pieceCount], `Save & Add Another`, `Cancel`).

**Preview column:** "LIVE PREVIEW" label, `<LivePreviewCard ... />` fed from `form` (+ `coverPhotoUrl` from an object URL of `coverFile` or the import's remote image), caption, `<ReadinessChecklist items={[{ok:!!form.title.trim(),label:t("checkTitle")},{ok:!!form.brand.trim(),label:t("checkBrand")},{ok:!!form.pieceCount,label:t("checkPieces")},{ok:hasAnyAvailability(form.availability),label:t("checkAvailability")}]} />`.

- [ ] **Step 1: Rewrite the component** following the above (read the current file first; preserve the `Route`/`validateSearch`/`puzzleId`-from-URL behaviour by treating an incoming `puzzleId` as a pre-selected definition → fetch via `gateway.catalog.puzzleById` and set `selectedDefinitionId` + prefill).

- [ ] **Step 2: Typecheck (nx, generates routes) — clean for this file**

Run: `pnpm exec nx run @jigswap/web:type-check`
Expected: no errors in `my-puzzles/add.tsx`.

- [ ] **Step 3: Format + commit**

```bash
pnpm exec prettier --write apps/web/src/routes/_dashboard/my-puzzles/add.tsx
git add apps/web/src/routes/_dashboard/my-puzzles/add.tsx
git commit -m "feat(web): rebuild /my-puzzles/add as unified add-to-library screen"
```

---

## Task 13: Flow B — restyle `/puzzles/add` (contribute-only)

**Files:** Modify `apps/web/src/routes/_dashboard/puzzles/add.tsx`

Same visual shell + components, **trimmed**: ImportZone (+ MatchConfirm linking out to `/my-puzzles/add?puzzleId=…` on a match, as today), Title, Brand+PieceCount, Difficulty, divider "cover & extras", CoverColour, Tags — **no Condition/Availability/Notes**, **no acquire**. Submit = `createPuzzle(...)` only → `toast.success(t("puzzleSubmittedForReview"))` → `router.push("/puzzles")`. Preview column shows the same `LivePreviewCard` but with `available={false}` and a checklist of `[Title, Brand, Piece count]` only.

- [ ] **Step 1: Rewrite the component** reusing the Task 3-11 components and the existing image-upload path (File → `generateUploadUrl`; imported remote image → `importPuzzleImage`).

- [ ] **Step 2: Typecheck + format + commit**

```bash
pnpm exec nx run @jigswap/web:type-check
pnpm exec prettier --write apps/web/src/routes/_dashboard/puzzles/add.tsx
git add apps/web/src/routes/_dashboard/puzzles/add.tsx
git commit -m "feat(web): restyle /puzzles/add as contribute-only screen"
```

---

## Task 14: i18n keys

**Files:** Modify `apps/web/locales/{en,nl,source}.json`

Add to the `"puzzles"` namespace (en + source identical English; nl Dutch). Reuse existing `importFromUrl`, `importFetch`, `importFetching`, `importFailed`. Add the new ones:

`en.json` / `source.json`:

```json
"importUrlBlurb": "Paste a link from Ravensburger, Gibsons, Amazon or another shop and we'll fill in the details for you.",
"importImported": "Imported — review the details below and save.",
"addToLibrary": "Add to Library",
"saveAndAddAnother": "Save & Add Another",
"contributePuzzle": "Contribute a Puzzle",
"coverColour": "Cover Colour",
"coverColourHint": "No box photo yet? Pick a colour for the placeholder cover.",
"checkTitle": "Title",
"checkBrand": "Brand",
"checkPieces": "Piece count",
"checkAvailability": "Availability",
"livePreview": "Live preview",
"livePreviewCaption": "This is how your puzzle will appear in your library and to the community.",
"addReadyHint": "Add a title, brand and piece count to continue."
```

`nl.json` (Dutch equivalents):

```json
"importUrlBlurb": "Plak een link van Ravensburger, Gibsons, Amazon of een andere winkel en wij vullen de details voor je in.",
"importImported": "Geïmporteerd — controleer de details hieronder en sla op.",
"addToLibrary": "Aan bibliotheek toevoegen",
"saveAndAddAnother": "Opslaan en nog een toevoegen",
"contributePuzzle": "Een puzzel bijdragen",
"coverColour": "Omslagkleur",
"coverColourHint": "Nog geen doosfoto? Kies een kleur voor de placeholder.",
"checkTitle": "Titel",
"checkBrand": "Merk",
"checkPieces": "Aantal stukjes",
"checkAvailability": "Beschikbaarheid",
"livePreview": "Live voorbeeld",
"livePreviewCaption": "Zo verschijnt je puzzel in je bibliotheek en voor de community.",
"addReadyHint": "Voeg een titel, merk en aantal stukjes toe om verder te gaan."
```

- [ ] **Step 1: Add keys to all three files.**
- [ ] **Step 2: Validate + commit**

```bash
node -e "['en','nl','source'].forEach(f=>require('./apps/web/locales/'+f+'.json'))"
git add apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git commit -m "i18n: add-puzzle redesign strings (en, nl, source)"
```

---

## Task 15: Full verification

**Files:** none

- [ ] **Step 1:** `pnpm exec prettier --check .` → clean (fix with `--write` if not).
- [ ] **Step 2:** `pnpm exec nx run-many -t lint type-check test build arch-check --parallel=4` → all pass (this is exactly CI; `build` generates `routeTree.gen` so route type-check is clean; lint warnings OK, 0 errors).
- [ ] **Step 3:** `pnpm exec vitest run apps/web` → green (incl. the mapper test).
- [ ] **Step 4: Manual smoke (dev):** start the app against dev Convex. On `/my-puzzles/add`: (a) paste a real store URL → import fills fields + preview updates live + "Imported" note; (b) when import/search finds an existing catalog puzzle → MatchConfirm appears → "Use this one" skips creation; (c) fill condition/availability/cover colour/tags/notes → "Add to Library" creates the def (if new), acquires a copy, sets sharing, lands in /puzzles; (d) readiness checklist ticks as fields fill. On `/puzzles/add`: contribute-only path creates a pending definition with no copy. Verify mobile (single column).
- [ ] **Step 5:** `git add -A && git commit -m "chore: add-puzzle redesign verification fixes"` (only if fixes were needed).

---

## Self-review notes (addressed)

- **Spec coverage:** import zone (T10), find-existing + frontend dedup confirm (T10 MatchConfirm + T12 wiring), catalog+instance fields (T4-8,T12), cover colour placeholder (T7, cosmetic — not persisted per spec), live preview + checklist (T9,T12), two flows (T12 Flow A, T13 Flow B), token mapping (T1 + existing utilities), backend composition create→acquire→sharing (T12, verified own-pending acquire), i18n (T14). Instance custom photos explicitly out of scope (spec).
- **Type consistency:** `Availability` (T2) consumed by `AvailabilityChips` (T5) + `availabilityToSharing`/`hasAnyAvailability` (T2) used in T12; `CONDITION_OPTIONS`→`ConditionValue` (T2) feeds Condition pills + `createOwned.condition` (T12); `ImportedDraft`/`ImportedMatch` (existing hook) flow ImportZone (T10) → screens (T12/T13); `LivePreviewProps` (T9) fed from `form` (T12/T13).
- **Known deviation:** Condition shows 4 design pills mapped to backend values (`like_new/good/fair/poor`); `new_sealed` is not surfaced (acceptable v1 — note in T2). Cover colour is cosmetic-only (spec).
- **Risk cleared:** acquire-against-own-pending verified allowed (domain `acquire-copy.ts` + tests), so no backend changes.
