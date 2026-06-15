# Rigid-body physics on the profile plank

**Date:** 2026-06-15
**Status:** Approved (design) — autonomous build per "continue until everything is completed"; scope (full rigid-body physics) pre-decided. **⚠️ This sub-project is purely interactive and CANNOT be verified in this environment (no browser/WebGL). It is designed to degrade safely; it WILL need hands-on verification by the user.**
**Sub-project ⑤ (final) of the punch list** (① ✓ → ② ✓ → ③ ✓ → ④ ✓ → **⑤ rigid-body physics**).

## Goal

Make the **profile** shelf's 3D plank physically interactive: the member's puzzle boxes rest on the shelf under gravity, collide with each other and the shelf, and can be **grabbed and dragged/thrown** with pointer or touch, tumbling and settling realistically. The **dashboard** plank stays the static ③ scene (physics is a profile-only, opt-in layer). Reduced-motion, no-WebGL, and any 3D/physics error all fall back to the static scene or the CSS plank.

## Hard constraints / safety (because it can't be tested here)

Physics correctness is entirely runtime behavior. To bound the risk of shipping something subtly broken:

- **Opt-in + isolated:** physics is a separate scene module (`scene-physics.tsx`) selected only when the profile passes `interactive`. ③'s `scene.tsx` is untouched and remains the default everywhere (dashboard, and profile when not interactive / reduced-motion / error).
- **Degradation chain (reuse ③'s):** no WebGL → CSS plank; `prefers-reduced-motion` → static ③ scene (no physics); the existing `SceneBoundary` catches any throw from the physics scene → CSS plank. So a physics bug never breaks the profile page — worst case it shows the CSS plank.
- **Bounded simulation:** a ground plane + invisible side/back walls keep knocked boxes from flying offscreen or falling forever; bodies that somehow escape are not catastrophic (offscreen, paused with the frameloop).

## New dependency

Add `@react-three/rapier` (a version compatible with `@react-three/fiber` 9.x / `three` 0.184 — the current 2.x line) to `apps/web/package.json`; `pnpm install` updates the lockfile. Rapier's WASM is lazy-loaded with the already-lazy scene chunk, so it adds nothing to first paint (the CSS plank shows first).

## Architecture

Builds on `apps/web/src/components/common/puzzle-plank-3d/`.

### 1. `box.tsx` (marketing, shared) — minimal anchoring prop

`PuzzleBox` currently self-positions its group at `[slot.x, h/2, 0]`. Physics needs a `RigidBody` parent to own the transform with the visual centered at local origin. Add a backward-compatible prop `anchored = true`:

- `anchored: true` (default) → today's behavior (group at `[slot.x, baseY, 0]`), so ③'s static scene and the marketing hero are unchanged.
- `anchored: false` → render the group at the **local origin** (`[0, 0, 0]`, no per-box yaw) so a parent `RigidBody` positions it. The box's mesh stays centered, so a cuboid collider of half-extents `(w/2, h/2, BOX_DEPTH/2)` matches it.

`PuzzleBox` already computes `w`, `h`, `BOX_DEPTH`; expose the resolved `{ w, h }` so the physics scene can size colliders without recomputing. Either (a) lift the height calc into a tiny shared helper `boxWorldSize(box, sizeScale)` in `box.tsx` (returns `{ w, h }`, reused by `scene.tsx`'s `boxWorldHeight` too — DRY), or (b) the physics scene recomputes via the same formula. Prefer (a).

### 2. `scene-physics.tsx` (new) — the interactive scene

A sibling of `scene.tsx` (same `PlankSceneProps` plus nothing new), default-exported and `React.lazy`-loaded by the orchestrator when interactive. Differences from `scene.tsx`:

- Wrap the world in rapier `<Physics>` (gravity `[0, -9.81, 0]`, `paused` driven by `visible`/reduced-motion so it never simulates offscreen), reusing the same `Lights`, camera cover-fit (`Arrangement` framing math), `ContactShadows`, and shelf board.
- **Shelf + ground + walls = fixed colliders:** the shelf board is a `<RigidBody type="fixed">` cuboid; add a fixed ground plane just below the shelf and low invisible walls (left/right/back/front) sized from `rowWidth`/`maxBoxH` to contain thrown boxes.
- **Each box = a dynamic `<RigidBody>`** at its `layoutRow` slot `[slots[i].x, h/2, 0]` (initial resting transform), containing `<PuzzleBox … anchored={false} />` and a `<CuboidCollider args={[w/2, h/2, BOX_DEPTH/2]} />`. Modest restitution, sensible friction/density so boxes settle and stack without jitter.
- **No `Parallax`** (pointer drives dragging, not camera tilt). Keep the fixed yaw on the camera framing, not on a rotating group (physics bodies must live in world space, not inside a tilting group — bake the yaw into camera position instead).
- `FirstFrame` → crossfade as before.

### 3. Drag interaction (`use-box-drag.ts` or inline)

Pointer/touch grab-drag-throw on the dynamic bodies, canvas pointer events enabled (the physics scene's `<Canvas>` uses `pointerEvents: "auto"` — ③'s static canvas keeps `"none"`):

- On pointer-down on a box: capture it, switch the body to `kinematicPosition` (so it follows the cursor exactly, ignoring gravity while held), and record the grab offset.
- On pointer-move: project the pointer onto a drag plane (parallel to the camera, through the grab point) and set the kinematic body's next position there. Track recent positions for a release velocity.
- On pointer-up: switch the body back to `dynamic` and apply the computed linear velocity (a gentle throw); clamp to a max so a flick can't launch a box across the screen.
- Touch: the same pointer events (pointer events unify mouse/touch); ensure the container's `touch-action` allows the drag without the page scrolling (the canvas is inside the document-scroll mobile shell from ②, so set `touch-action: none` on the canvas only while a box is grabbed, restoring it on release, so vertical page scroll still works when not dragging).

### 4. Orchestrator (`index.tsx`) — opt-in + selection

- Add an `interactive?: boolean` prop to `PuzzlePlank3D`. When `interactive && !reducedMotion && WebGL`, lazy-load `scene-physics`; otherwise lazy-load the static `scene` (today's behavior). Both go through the same `SceneBoundary` + CSS fallback + color resolution + `IntersectionObserver` visibility.
- The physics canvas needs pointer events; gate the canvas `pointerEvents` on whether the physics scene is active.

### 5. Profile wiring (`profile/shelf-section.tsx`)

Pass `interactive` to the profile's `PuzzlePlank3D` (the dashboard does not). The curated boxes from ④ flow in unchanged.

## Components / boundaries

- **`scene-physics.tsx`** — owns all rapier usage; isolated so ③'s `scene.tsx` and the marketing hero are untouched. Knows nothing about profiles.
- **`box.tsx` `anchored` prop + `boxWorldSize` helper** — the only change to the shared renderer; default preserves every existing caller.
- **drag hook** — owns pointer→world projection + kinematic/dynamic toggling; the one piece with the most runtime risk, kept small and isolated.
- **`index.tsx`** — owns scene SELECTION (static vs physics) + the existing lifecycle/fallback.

## Testing / verification

- **Unit (TDD where pure):** the release-velocity clamp and the drag-plane / pointer→world projection math can be extracted to pure helpers and unit-tested (e.g. `clampThrowVelocity`, `pointerToDragPlane`). The collider half-extents come from the unit-tested `boxWorldSize`. That is the only automatable coverage.
- **No simulation tests** — physics behavior is not unit-testable here and the env has no browser. The `SceneBoundary` + CSS fallback make a physics failure non-fatal.
- **⚠️ Mandatory user verification:** on the profile page, boxes rest on the shelf; grabbing/dragging with mouse AND touch works; thrown boxes tumble and settle without falling through the shelf or flying offscreen; page still scrolls when not dragging a box; reduced-motion shows the static shelf; perf is acceptable on a real phone. This is the gate before ⑤ is considered done — I cannot confirm any of it here.

## Out of scope

- Physics on the dashboard plank (static ③ only).
- Persisting knocked-around positions (boxes re-init to their resting layout on each mount).
- Any change to the marketing hero scene or ③'s static `scene.tsx`.

## Risks (high — flagged)

- **Untestable here:** every behavioral aspect (collider alignment, drag feel, throw clamp, settle stability, mobile perf, touch-vs-scroll) is runtime-only. Expect an iteration pass after the user tries it.
- **Mobile perf:** physics stepping + WebGL on a phone; mitigated by offscreen pause (frameloop/`paused`), DPR clamp, few bodies (≤6), and simple cuboid colliders.
- **Touch vs page scroll:** the ② mobile shell scrolls the document; the canvas must only swallow touch while a box is grabbed, or the shelf will trap page scroll. Designed above (`touch-action` toggled on grab).
- **Dependency/version:** `@react-three/rapier` must match fiber 9 / three 0.184; if the install surfaces a peer conflict, pin a compatible version.
