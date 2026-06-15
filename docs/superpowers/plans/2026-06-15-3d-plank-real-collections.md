# 3D Plank Rendering Real Collections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contained, bounded WebGL 3D plank (`PuzzlePlank3D`) that renders a member's real puzzle copies on a single shelf board, with the existing CSS `PuzzlePlank` as fallback, used on the dashboard "Your Shelf" and the profile shelf.

**Architecture:** New `apps/web/src/components/common/puzzle-plank-3d/` reusing the marketing scene's box renderer (`box.tsx`), box-art (`box-art.ts`), and palette (`palette.ts` `LIGHTING` + `resolveCssColor`). A pure `layoutRow` helper (unit-tested) positions the real boxes left→right in one row; `scene.tsx` renders a contained `<Canvas>` framed to that row; `index.tsx` orchestrates WebGL-detect / lazy-load / offscreen-pause / error-boundary with the CSS plank as the crossfade + fallback. One sequential intent (component → wiring); single worktree; atomic commits per task.

**Tech Stack:** React, `@react-three/fiber`, `@react-three/drei`, `three`, `maath/easing`, `next-themes`, Tailwind, Vitest (pure-logic unit test only).

**Reference files to read first (do NOT modify the marketing ones):** `apps/web/src/components/marketing/plank-3d/{index.tsx,scene.tsx,box.tsx,box-art.ts,palette.ts}` and `apps/web/src/components/common/puzzle-plank.tsx` (the CSS fallback + `PuzzlePlankBox` type).

---

## File Structure

- Create: `apps/web/src/components/common/puzzle-plank-3d/layout.ts` — pure `layoutRow`.
- Create: `apps/web/src/components/common/puzzle-plank-3d/layout.test.ts` — unit tests.
- Create: `apps/web/src/components/common/puzzle-plank-3d/scene.tsx` — bounded single-row `<Canvas>` scene (default export).
- Create: `apps/web/src/components/common/puzzle-plank-3d/index.tsx` — `PuzzlePlank3D` public component.
- Modify: `apps/web/src/components/marketing/plank-3d/palette.ts` — generalize `resolveHeadingFont`.
- Modify: `apps/web/src/components/dashboard-home/shelf-section.tsx` — swap to `PuzzlePlank3D` in a sized container.
- Modify: `apps/web/src/components/profile/shelf-section.tsx` — swap to `PuzzlePlank3D` in a sized container.

**Reused as-is (imported, not copied):** `box.tsx` (`PuzzleBox`, `PX`, `BOX_SCALE`, `BOX_DEPTH`, `BoxSlot`), `palette.ts` (`LIGHTING`, `resolveCssColor`). The app `PuzzlePlankBox` is structurally assignable to the marketing `PlankBox` that `PuzzleBox` expects.

**Verify with** (from `apps/web`): `pnpm vitest run <file>` and `pnpm type-check` (ignore pre-existing `routeTree.gen` route-path noise; only the changed files matter).

---

## Task 1: `layoutRow` pure helper + tests (TDD)

**Files:** Create `layout.ts`, `layout.test.ts` in `apps/web/src/components/common/puzzle-plank-3d/`.

`layoutRow` converts an ordered box list into centered world-space x-positions on one row. World scale matches `box.tsx`: a box of `width` CSS-px occupies `width * PX * BOX_SCALE` world units (`PX = 1/100`, `BOX_SCALE = 0.74`). Default width when unset is 116 (same default as `PuzzleBox`). Use a fixed world gap between boxes. The row is centered on x=0.

- [ ] **Step 1: Write the failing test** — `layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GAP, layoutRow } from "./layout";
import { BOX_SCALE, PX } from "@/components/marketing/plank-3d/box";

const w = (px: number) => px * PX * BOX_SCALE;

describe("layoutRow", () => {
  it("returns no slots and zero width for an empty list", () => {
    expect(layoutRow([])).toEqual({ slots: [], rowWidth: 0 });
  });

  it("centers a single box on x=0", () => {
    const { slots, rowWidth } = layoutRow([{ width: 116 }]);
    expect(slots).toHaveLength(1);
    expect(slots[0].x).toBeCloseTo(0, 6);
    expect(rowWidth).toBeCloseTo(w(116), 6);
  });

  it("defaults missing width to 116", () => {
    expect(layoutRow([{}])[0 as never]).toBeUndefined(); // guard: result is an object, not array
    const { rowWidth } = layoutRow([{}]);
    expect(rowWidth).toBeCloseTo(w(116), 6);
  });

  it("lays out two boxes left->right, centered, separated by GAP", () => {
    const { slots, rowWidth } = layoutRow([{ width: 100 }, { width: 100 }]);
    const wb = w(100);
    expect(rowWidth).toBeCloseTo(wb * 2 + GAP, 6);
    // centered: total span = 2*wb + GAP; first center at -(span/2)+wb/2
    expect(slots[0].x).toBeCloseTo(-(wb + GAP) / 2, 6);
    expect(slots[1].x).toBeCloseTo((wb + GAP) / 2, 6);
    expect(slots[1].x - slots[0].x).toBeCloseTo(wb + GAP, 6);
  });
});
```

(Delete the stray `expect(...).toBeUndefined()` guard line if it complicates — it only documents that the return is an object. Keep the rest.)

- [ ] **Step 2: Run it, expect FAIL** — `cd apps/web && pnpm vitest run src/components/common/puzzle-plank-3d/layout.test.ts` → cannot resolve `./layout`.

- [ ] **Step 3: Implement `layout.ts`:**

```ts
import { BOX_SCALE, PX } from "@/components/marketing/plank-3d/box";
import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";

/** World-space gap between neighbouring boxes on the shelf row. */
export const GAP = 0.12;

export interface RowSlot {
  /** World-space x of the box center. */
  x: number;
}

export interface RowLayout {
  slots: RowSlot[];
  /** Total world width spanned by the boxes + gaps. */
  rowWidth: number;
}

/** World width of one box from its CSS-pixel width (matches box.tsx scaling). */
function boxWorldWidth(box: PuzzlePlankBox): number {
  return (box.width ?? 116) * PX * BOX_SCALE;
}

/**
 * Lay boxes out in a single row, centered on x=0, left→right in list order,
 * separated by GAP. Deterministic; no randomness. Pure.
 */
export function layoutRow(boxes: PuzzlePlankBox[]): RowLayout {
  if (boxes.length === 0) return { slots: [], rowWidth: 0 };
  const widths = boxes.map(boxWorldWidth);
  const rowWidth = widths.reduce((a, b) => a + b, 0) + GAP * (boxes.length - 1);
  const slots: RowSlot[] = [];
  let cursor = -rowWidth / 2;
  for (const wb of widths) {
    slots.push({ x: cursor + wb / 2 });
    cursor += wb + GAP;
  }
  return { slots, rowWidth };
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit:** `git add` the two files; message `feat(web): add layoutRow helper for the 3D puzzle plank`.

---

## Task 2: Generalize `resolveHeadingFont` in the marketing palette

**Files:** Modify `apps/web/src/components/marketing/plank-3d/palette.ts`.

`resolveHeadingFont` hard-codes `--font-mk-heading`; the app component needs `--font-heading`. Add an optional param, keeping the default backward-compatible.

- [ ] **Step 1: Edit.** Replace:

```ts
export function resolveHeadingFont(scope: HTMLElement): string {
  const v = getComputedStyle(scope)
    .getPropertyValue("--font-mk-heading")
    .trim();
  return v || "system-ui, sans-serif";
}
```

with:

```ts
export function resolveHeadingFont(
  scope: HTMLElement,
  varName = "--font-mk-heading",
): string {
  const v = getComputedStyle(scope).getPropertyValue(varName).trim();
  return v || "system-ui, sans-serif";
}
```

- [ ] **Step 2: Type-check** (`cd apps/web && pnpm type-check`) — no new error in `palette.ts` or its marketing caller (`marketing/plank-3d/index.tsx`, which still calls it with one arg).

- [ ] **Step 3: Commit:** `git add apps/web/src/components/marketing/plank-3d/palette.ts`; message `refactor(web): let resolveHeadingFont take a custom CSS var name`.

---

## Task 3: Bounded single-row scene (`scene.tsx`)

**Files:** Create `apps/web/src/components/common/puzzle-plank-3d/scene.tsx`.

Adapt the marketing `scene.tsx` down to a **contained single row**. Read the marketing `scene.tsx` for the reusable idioms (`Parallax`, `transformSafeEvents`, `FirstFrame`, `ContactShadows`, the `Lights` damping). Differences from marketing:

- **No fog, no endless span, no repeat, no multi-row, no size jitter, no per-box spotlights.** One row of the real boxes.
- A single shelf board mesh sized to `rowWidth + margin`.
- Camera **cover-fits the row** (frame the row's bounding width and the max box height) with a small headroom, looking at the row center; slight downward gaze and the same `SHELF_YAW`-style gentle yaw is OPTIONAL — keep a small fixed yaw (e.g. `-12°`) so boxes read as 3D, but no parallax-driven rotation beyond the reused `Parallax` (reduced-motion → off).
- Props interface:

```tsx
export interface PlankSceneProps {
  boxes: PuzzlePlankBox[];
  /** Pre-resolved per-box colors, parallel to boxes. */
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  theme: "light" | "dark";
  reducedMotion: boolean;
  visible: boolean;
  onFirstFrame: () => void;
  eventSource: React.RefObject<HTMLDivElement | null>;
}
```

Implementation requirements (the specialist writes the three.js; these are the contracts):

- Default-export a `PlankScene(props: PlankSceneProps)` returning a `<Canvas>` with `dpr={[1, 2]}`, `frameloop={visible ? "always" : "never"}`, `gl={{ alpha: true, antialias: true }}`, transparent background, `eventSource`/`events` from the reused `transformSafeEvents`, `resize={{ offsetSize: true }}` — exactly like marketing.
- Use `LIGHTING[theme]` for lights (reuse the marketing `Lights` damping component or a trimmed copy) — but **no fog** and **no `Haze`**.
- An `Arrangement` inner component that reads `useThree().size`, calls `layoutRow(boxes)` for slot x-positions and `rowWidth`, computes camera distance to cover-fit (frame height = `maxBoxWorldHeight + headroom`, min visible width so a 1–2 box row isn't hugely zoomed), positions the camera, and renders:
  - one shelf board `mesh` (`boxGeometry` sized `[rowWidth + 0.4, SHELF_THICKNESS, SHELF_DEPTH]`, `meshStandardMaterial` `color={LIGHTING[theme].shelfColor}`), reusing `SHELF_THICKNESS=0.14`, `SHELF_DEPTH=0.6` constants;
  - `boxes.map((box, i) => <PuzzleBox box={box} slot={{ x: slots[i].x, c1: resolved[i].c1, c2: resolved[i].c2 }} index={i} headingFont={headingFont} sizeScale={1} />)`;
  - a single `ContactShadows` under the row (`scale={rowWidth + 1}`, `opacity={LIGHTING[theme].shadowOpacity}`);
  - wrap the group in the reused `Parallax` (enabled `!reducedMotion`) and a fixed parent yaw rotation (`[0, -12°, 0]`).
- A `FirstFrame` calling `onFirstFrame()` on the first `useFrame`.
- Box max world height: cover boxes default to `width/1.4`, no-cover to `box.height ?? 144`, times `PX * BOX_SCALE` (mirror `box.tsx`); compute the max over the row for framing.

- [ ] **Step 1: Read** the marketing `scene.tsx`, `box.tsx`, and `layout.ts` (Task 1).
- [ ] **Step 2: Write** `scene.tsx` per the contracts above.
- [ ] **Step 3: Type-check** — no error references `scene.tsx`.
- [ ] **Step 4: Commit:** `git add apps/web/src/components/common/puzzle-plank-3d/scene.tsx`; message `feat(web): bounded single-row 3D scene for the puzzle plank`.

---

## Task 4: `PuzzlePlank3D` orchestrator (`index.tsx`)

**Files:** Create `apps/web/src/components/common/puzzle-plank-3d/index.tsx`.

Adapt the marketing `index.tsx` orchestration to a contained widget with the **CSS `PuzzlePlank` as fallback**. Read the marketing `index.tsx` first.

Contracts:

```tsx
export function PuzzlePlank3D({ boxes }: { boxes: PuzzlePlankBox[] }) { ... }
```

- Reuse the marketing patterns verbatim where possible: `supportsWebGL()`, `usePrefersReducedMotion()`, the `SceneBoundary` render-nothing error boundary, `React.lazy(() => import("./scene"))`, the `IntersectionObserver` visibility pause, `useTheme()` → `"light" | "dark"`.
- Container `<div ref={container} style={{ position: "relative", width: "100%", height: "100%" }} aria-hidden>` — it fills the parent (the parent page owns the height, Task 5).
- **CSS fallback layer:** render `<PuzzlePlank boxes={boxes} />` (from `@/components/common/puzzle-plank`) absolutely centered, `opacity: sceneReady ? 0 : 1` with a `.45s` transition — shown until the scene's first frame; remains (scene never mounts) when WebGL is unavailable or on boundary error. (No marketing `JigPlank`; this is the app plank.)
- **Color resolution:** on mount / theme change, resolve each box's `c1`/`c2` via `resolveCssColor(box.c1 ?? "var(--jigsaw-primary)", el)` / `resolveCssColor(box.c2 ?? "var(--jigsaw-primary)", el)` against `container.current`, and `resolveHeadingFont(el, "--font-heading")`. Store `resolved` parallel to `boxes`. Skip until `mounted && container` like marketing.
- **Scene layer:** when `mounted && resolved !== null`, render the lazy `PlankScene` inside `<SceneBoundary><React.Suspense fallback={null}>…` in an absolutely-positioned full-fill div with `opacity: sceneReady ? 1 : 0` transition and `pointerEvents: "none"`, passing `boxes`, `resolved`, `headingFont`, `theme`, `reducedMotion`, `visible`, `onFirstFrame={() => setSceneReady(true)}`, `eventSource={container}`.
- Empty `boxes` → render nothing (callers already guard, but be safe).

- [ ] **Step 1: Read** the marketing `index.tsx`.
- [ ] **Step 2: Write** `index.tsx` per the contracts.
- [ ] **Step 3: Type-check** — no error references `index.tsx`.
- [ ] **Step 4: Commit:** `git add apps/web/src/components/common/puzzle-plank-3d/index.tsx`; message `feat(web): PuzzlePlank3D orchestrator with CSS-plank fallback`.

---

## Task 5: Wire into dashboard + profile shelves

**Files:** Modify `apps/web/src/components/dashboard-home/shelf-section.tsx` and `apps/web/src/components/profile/shelf-section.tsx`.

Swap the CSS `<PuzzlePlank>` for `<PuzzlePlank3D>` inside a **sized container** (the 3D canvas needs a defined height; this also takes over ②'s "shorter on mobile" plank intent). Keep the existing box mapping. Heights: mobile `h-[300px]`, desktop `md:h-[360px]` — a contained block matching the plank footprint.

- [ ] **Step 1: Dashboard.** In `dashboard-home/shelf-section.tsx`, add import `import { PuzzlePlank3D } from "@/components/common/puzzle-plank-3d";`. Replace the plank block:

```tsx
<div className="min-w-0 overflow-x-auto px-2 pt-3 pb-3 md:pt-6 md:pb-5">
  <PuzzlePlank
    boxes={owned.slice(0, 5).map((copy, i) => toPlankBox(copy, i, isMobile))}
  />
</div>
```

with:

```tsx
<div className="min-w-0">
  <PuzzlePlank3D
    boxes={owned.slice(0, 5).map((copy, i) => toPlankBox(copy, i, isMobile))}
  />
</div>
```

and wrap the grid's plank column height: the `PuzzlePlank3D` parent must have height. Put the height on the immediate wrapper:

```tsx
<div className="h-[300px] min-w-0 md:h-[360px]">
  <PuzzlePlank3D
    boxes={owned.slice(0, 5).map((copy, i) => toPlankBox(copy, i, isMobile))}
  />
</div>
```

(Remove the now-unneeded `overflow-x-auto px-2 pt-3 pb-3 md:pt-6 md:pb-5` — the 3D canvas is self-contained. Keep `toPlankBox(..., isMobile)`: width still drives box size in `layoutRow`/`PuzzleBox`.) Leave the `PuzzlePlank` import in place ONLY if still referenced elsewhere in the file; if not, remove the now-unused import.

- [ ] **Step 2: Profile.** In `profile/shelf-section.tsx`, add the same import. Replace:

```tsx
<div className="min-w-0 overflow-x-auto px-2 pt-6 pb-6">
  <PuzzlePlank boxes={boxes} />
</div>
```

with:

```tsx
<div className="h-[300px] min-w-0 md:h-[360px]">
  <PuzzlePlank3D boxes={boxes} />
</div>
```

Remove the now-unused `PuzzlePlank` import if nothing else uses it.

- [ ] **Step 3: Type-check** — no error references either shelf-section. Confirm no unused-import lint error for `PuzzlePlank`.

- [ ] **Step 4: Commit:** `git add` both shelf-section files; message `feat(web): render dashboard + profile shelves with the 3D plank`.

---

## Final verification

- [ ] `cd apps/web && pnpm vitest run src/components/common/puzzle-plank-3d/layout.test.ts` → PASS.
- [ ] `cd apps/web && pnpm type-check` → no errors referencing any new/changed file (ignore `routeTree.gen` noise).
- [ ] Prettier: `npx prettier --write` the new + changed files; commit any delta.
- [ ] Manual/user (browser unavailable here): dashboard + profile shelves show real puzzles as 3D boxes on a board; WebGL-off or scene error falls back to the CSS plank; reduced-motion disables parallax; no horizontal overflow; mobile shorter than desktop.

## Self-review notes

- **Spec coverage:** new component (Tasks 1,3,4) + palette tweak (2) + dashboard & profile wiring (5) + `layoutRow` unit test (1) all map to spec sections. Sizing handled in Task 5.
- **Reused-not-duplicated:** `PuzzleBox`, `box-art`, `LIGHTING`, `resolveCssColor` imported from marketing `plank-3d`; only `resolveHeadingFont` is (backward-compatibly) generalized.
- **Type consistency:** `PuzzlePlankBox` flows through `layoutRow` (Task 1), `PlankScene` props (Task 3), `PuzzlePlank3D` (Task 4), and both call sites (Task 5).
