# Profile Plank Physics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> ⚠️ **This feature is purely interactive and CANNOT be browser-verified in this environment.** Build it defensively (it degrades to the static ③ scene / CSS plank) and TDD the pure helpers; the runtime behavior MUST be verified by the user.

**Goal:** Make the profile shelf's 3D plank physically interactive (Rapier) — boxes rest under gravity, collide, and can be grabbed/dragged/thrown by mouse + touch — as an opt-in, isolated layer that leaves ③'s static scene (dashboard + reduced-motion + fallback) untouched.

**Architecture:** New `@react-three/rapier`. A new `scene-physics.tsx` sibling to ③'s `scene.tsx`, selected by `PuzzlePlank3D` only when `interactive && !reducedMotion && WebGL`. The shared `PuzzleBox` gains a backward-compatible `anchored` prop so a `RigidBody` can own each box transform. Pure drag/throw math is unit-tested; rapier wiring is specialist work. Single worktree, atomic commit per task.

**Tech Stack:** `@react-three/rapier`, `@react-three/fiber` 9, `three` 0.184, React, Vitest.

**Reference files to READ first:** `apps/web/src/components/common/puzzle-plank-3d/{scene.tsx,index.tsx,layout.ts}` (③, the base) and `apps/web/src/components/marketing/plank-3d/box.tsx` (the `PuzzleBox` + scaling constants). The physics scene mirrors `scene.tsx`'s `Lights`/`Arrangement` framing/`ContactShadows`/shelf, adding rapier.

**Verify:** `cd apps/web && pnpm vitest run <file>` for the pure helpers; `pnpm type-check` (ignore `routeTree.gen` noise). NO dev server / browser here.

---

## Task 1: Add the Rapier dependency

**Files:** `apps/web/package.json` (+ lockfile).

- [ ] **Step 1:** Add `"@react-three/rapier": "^2.1.0"` to `dependencies` (a 2.x release compatible with fiber 9 / three 0.184). From `apps/web`, run `pnpm install`. If a peer-dep conflict surfaces, pick the latest 2.x that resolves and note the version.
- [ ] **Step 2:** Confirm it resolves: `pnpm why @react-three/rapier` lists a single version; `pnpm type-check` still runs.
- [ ] **Step 3: Commit:** `chore(web): add @react-three/rapier for the interactive plank`.

---

## Task 2: `boxWorldSize` helper + `anchored` prop on `PuzzleBox` (TDD for the helper)

**Files:** modify `apps/web/src/components/marketing/plank-3d/box.tsx`; create `box-size.test.ts` beside it; update `apps/web/src/components/common/puzzle-plank-3d/scene.tsx` to reuse the helper.

`PuzzleBox` self-positions at `[slot.x, h/2, 0]`. Physics needs a parent `RigidBody` to own the transform with the visual at local origin, plus the box's world `{w,h}` to size a collider.

- [ ] **Step 1: Failing test** `box-size.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boxWorldSize, BOX_SCALE, PX } from "./box";

describe("boxWorldSize", () => {
  it("derives width and height from a no-cover box", () => {
    const { w, h } = boxWorldSize({ width: 116, height: 144 }, 1);
    expect(w).toBeCloseTo(116 * PX * BOX_SCALE, 6);
    expect(h).toBeCloseTo(144 * PX * BOX_SCALE, 6);
  });
  it("uses width/1.4 for a cover box height", () => {
    const { h } = boxWorldSize({ width: 140, cover: "x.jpg" }, 1);
    expect(h).toBeCloseTo((140 / 1.4) * PX * BOX_SCALE, 6);
  });
  it("applies sizeScale and defaults width to 116", () => {
    const { w } = boxWorldSize({}, 2);
    expect(w).toBeCloseTo(116 * PX * BOX_SCALE * 2, 6);
  });
});
```

Run → FAIL (no `boxWorldSize`).

- [ ] **Step 2: Implement in `box.tsx`.** Export a pure helper mirroring the existing inline math (the component currently computes `widthPx`, `worldScale = PX*BOX_SCALE*sizeScale`, `w`, and the default height `box.cover ? widthPx/1.4 : (box.height ?? 144)`):

```ts
import type { PlankBox } from "@/components/marketing/plank";

/** World-space {w,h} of a box's front face (pre-aspect-correction), mirroring the
 *  scaling PuzzleBox applies. Used by the bounded scene's framing and the physics
 *  scene's colliders so they never drift from the visual size. */
export function boxWorldSize(
  box: Pick<PlankBox, "width" | "height" | "cover">,
  sizeScale = 1,
): { w: number; h: number } {
  const widthPx = box.width ?? 116;
  const worldScale = PX * BOX_SCALE * sizeScale;
  const hPx = box.cover ? widthPx / 1.4 : (box.height ?? 144);
  return { w: widthPx * worldScale, h: hPx * worldScale };
}
```

Refactor `PuzzleBox` to use `boxWorldSize` for its initial `w`/`defaultHPx` (no behavior change). Run → PASS.

- [ ] **Step 3: Add the `anchored` prop.** Add `anchored = true` to `PuzzleBox`'s props. When `true`, keep today's `<group position={[slot.x, baseY, 0]} rotation={[0, yaw, 0]}>`. When `false`, render `<group position={[0, 0, 0]} rotation={[0, 0, 0]}>` (the parent `RigidBody` owns world transform; the mesh stays centered at local origin so a centered cuboid collider matches). `slot.c1/c2`/art are unchanged. Default `true` preserves ③ + the marketing hero exactly.

- [ ] **Step 4:** Update `scene.tsx`'s `boxWorldHeight` to delegate to `boxWorldSize(box).h` (DRY; no behavior change). `pnpm type-check` clean for `box.tsx`/`scene.tsx`.

- [ ] **Step 5: Commit:** `feat(web): boxWorldSize helper + anchored prop on PuzzleBox`.

---

## Task 3: Pure drag/throw math + tests (TDD)

**Files:** create `apps/web/src/components/common/puzzle-plank-3d/drag-math.ts` + `drag-math.test.ts`.

Two pure helpers the drag hook will use (kept pure so they're the testable core of the otherwise-untestable interaction):

- [ ] **Step 1: Failing tests** `drag-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampThrowVelocity, MAX_THROW_SPEED } from "./drag-math";

describe("clampThrowVelocity", () => {
  it("passes through a slow throw unchanged", () => {
    expect(clampThrowVelocity([1, 0, -1])).toEqual([1, 0, -1]);
  });
  it("scales an over-fast throw down to MAX_THROW_SPEED, preserving direction", () => {
    const v = clampThrowVelocity([0, 0, -100]);
    expect(Math.hypot(...v)).toBeCloseTo(MAX_THROW_SPEED, 5);
    expect(v[2]).toBeLessThan(0); // same direction
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(0);
  });
  it("returns zero for a zero vector (no divide-by-zero)", () => {
    expect(clampThrowVelocity([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `drag-math.ts`:**

```ts
export type Vec3 = [number, number, number];

/** Cap a throw so a flick can't launch a box across the scene; preserves direction. */
export const MAX_THROW_SPEED = 6;

export function clampThrowVelocity(v: Vec3): Vec3 {
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (speed === 0 || speed <= MAX_THROW_SPEED) return v;
  const k = MAX_THROW_SPEED / speed;
  return [v[0] * k, v[1] * k, v[2] * k];
}
```

Run → PASS.

- [ ] **Step 3: Commit:** `feat(web): pure drag/throw helpers for the interactive plank`.

(The pointer→world-on-drag-plane projection stays inline in the hook — it depends on the live three.js camera/raycaster and isn't purely unit-testable; `clampThrowVelocity` is the extracted testable core.)

---

## Task 4: `scene-physics.tsx` — the interactive scene (specialist)

**Files:** create `apps/web/src/components/common/puzzle-plank-3d/scene-physics.tsx`.

Default-export `PlankScenePhysics(props: PlankSceneProps)` (same props as ③'s scene). READ ③'s `scene.tsx` and reuse its `Lights`, the `Arrangement` camera cover-fit math, `ContactShadows`, and shelf board. Add rapier:

- Wrap the world in `<Physics gravity={[0, -9.81, 0]} paused={!props.visible || props.reducedMotion}>` (never simulate offscreen). Import from `@react-three/rapier`.
- **Bake the fixed yaw into the CAMERA**, not a rotating group — physics bodies live in world space. (Set the camera position/lookAt so the shelf reads at the same ~12° as ③, or place the camera at the yawed position; do NOT wrap bodies in a rotated group.)
- **Fixed colliders:** shelf board as `<RigidBody type="fixed">` (cuboid matching the board), a fixed ground plane just below the shelf, and low invisible walls (left/right/back/front, derived from `rowWidth` + `maxBoxH`) to contain thrown boxes.
- **Dynamic boxes:** for each box, a `<RigidBody type="dynamic" position={[slots[i].x, h/2, 0]} colliders={false}>` containing `<PuzzleBox … anchored={false} />` and `<CuboidCollider args={[w/2, h/2, BOX_DEPTH/2]} />` (use `boxWorldSize` for `w`,`h`; `BOX_DEPTH` from box.tsx). Tune `restitution` (~0.1), `friction` (~0.8), `linearDamping`/`angularDamping` (small) so boxes settle and stack without jitter. Give each `RigidBody` a ref for the drag hook (Task 5).
- `FirstFrame` → `onFirstFrame` for the crossfade (as ③).

- [ ] **Step 1:** Read ③'s `scene.tsx`, `box.tsx`, `layout.ts`, and the `@react-three/rapier` API (`Physics`, `RigidBody`, `CuboidCollider`, `RapierRigidBody` ref type, `setNextKinematicTranslation`, `setBodyType`/`setLinvel`).
- [ ] **Step 2:** Write `scene-physics.tsx` per the contract; wire the drag hook from Task 5.
- [ ] **Step 3:** `pnpm type-check` — no error referencing `scene-physics.tsx`.
- [ ] **Step 4: Commit:** `feat(web): rapier-based interactive plank scene`.

---

## Task 5: Box drag hook (specialist)

**Files:** create `apps/web/src/components/common/puzzle-plank-3d/use-box-drag.ts` (or inline in scene-physics if simpler).

Grab-drag-throw on the dynamic bodies (pointer events unify mouse + touch):

- On **pointer-down** on a box mesh: `setPointerCapture`; switch that body to `kinematicPosition` (`setBodyType`); record grab offset and a drag plane (parallel to the camera, through the grab point).
- On **pointer-move**: raycast the pointer onto the drag plane (use the canvas's existing `transformSafeEvents` raycaster), and `setNextKinematicTranslation` to follow; push `(pos, time)` into a small ring buffer for release velocity.
- On **pointer-up**: switch back to `dynamic`; compute velocity from the last two buffered samples, run it through `clampThrowVelocity`, `setLinvel`; release capture.
- **Touch vs page scroll:** set the canvas `touch-action: none` only WHILE a box is grabbed (so the ② document-scroll shell still scrolls when not dragging); restore on release.

- [ ] **Step 1:** Implement; use `clampThrowVelocity` (Task 3).
- [ ] **Step 2:** `pnpm type-check` clean.
- [ ] **Step 3: Commit:** `feat(web): grab/drag/throw interaction for the plank` (may be folded into Task 4's commit if implemented inline — then skip).

---

## Task 6: Orchestrator opt-in + scene selection

**Files:** modify `apps/web/src/components/common/puzzle-plank-3d/index.tsx`.

- [ ] **Step 1:** Add `interactive?: boolean` to `PuzzlePlank3D`. Choose the lazy scene: `interactive && !reducedMotion && supportsWebGL()` → `React.lazy(() => import("./scene-physics"))`; else the existing `./scene`. Keep both behind the same `SceneBoundary`, color resolution, `IntersectionObserver`, and CSS fallback.
- [ ] **Step 2:** When the physics scene is active, the `<Canvas>` must accept pointer events (drag) — set the canvas/container `pointerEvents: "auto"` for the physics path; keep `"none"` for the static path. (If the canvas style lives in the scene module, pass a flag or set it there.)
- [ ] **Step 3:** `pnpm type-check` clean.
- [ ] **Step 4: Commit:** `feat(web): PuzzlePlank3D interactive opt-in (physics scene selection)`.

---

## Task 7: Profile wiring

**Files:** modify `apps/web/src/components/profile/shelf-section.tsx`.

- [ ] **Step 1:** Pass `interactive` to the profile's `<PuzzlePlank3D … interactive />`. The dashboard's stays without it (static). Curated boxes from ④ flow in unchanged.
- [ ] **Step 2:** `pnpm type-check` clean; `npx prettier --write` all changed/new files.
- [ ] **Step 3: Commit:** `feat(web): make the profile plank interactive`.

---

## Final verification

- [ ] Pure-helper tests pass (`box-size.test.ts`, `drag-math.test.ts`).
- [ ] `apps/web` type-check clean for all changed files; prettier clean.
- [ ] ③'s static `scene.tsx` and the marketing hero are unchanged in behavior (the `anchored` default is `true`; dashboard plank has no `interactive`).
- [ ] **⚠️ MANDATORY user runtime check (cannot be done here):** profile boxes rest on the shelf; mouse + touch grab/drag/throw works; boxes don't fall through the shelf or fly offscreen; the page still scrolls when not dragging a box; reduced-motion shows the static shelf; mobile perf is acceptable. Expect a tuning iteration after this.

## Self-review notes

- **Spec coverage:** dependency (T1) · box anchoring + size helper (T2) · pure drag/throw math (T3) · physics scene (T4) · drag hook (T5) · orchestrator opt-in (T6) · profile wiring (T7). Degradation + dashboard-untouched preserved via the `interactive` gate + default `anchored=true`.
- **Type consistency:** `boxWorldSize(box, sizeScale)` used by scene framing + physics colliders; `clampThrowVelocity: Vec3→Vec3`; `PlankSceneProps` shared by both scenes; `interactive?: boolean` threaded index→profile only.
- **Isolation:** all rapier usage confined to `scene-physics.tsx` + `use-box-drag.ts`; `scene.tsx` and `box.tsx`'s default path untouched, so a physics failure degrades (SceneBoundary → CSS plank) without affecting the dashboard or marketing hero.
