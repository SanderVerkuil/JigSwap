# 3D plank rendering real collections (dashboard + profile)

**Date:** 2026-06-15
**Status:** Approved (design) — autonomous build per the user's "continue until everything is completed" directive; major fork (3D on dashboard + profile) pre-decided.
**Sub-project ③ of the mobile/3D-plank punch list** (① ✓ → ② ✓ → **③ 3D plank for real collections** → ④ profile shelf curation → ⑤ rigid-body physics).

## Goal

Replace the 2.5D CSS `PuzzlePlank` on the dashboard "Your Shelf" and the profile shelf with a **contained, bounded WebGL 3D plank** that renders the member's _actual_ puzzle copies on a single shelf board — keeping the existing CSS `PuzzlePlank` as the graceful fallback (SSR, no-WebGL, pre-load, and on any 3D error).

Scope boundary: ③ is **rendering only** — a static 3D shelf with gentle idle parallax (reduced-motion aware). No per-box manipulation and no physics (that's ⑤). No curation UI (that's ④). The component renders whatever ordered box list it's handed; ④ later changes _which_ boxes the profile passes in.

## Why a new component (not adapting `JigPlank3D`)

`JigPlank3D` is specialized for the marketing hero: an **endless, repeating, multi-row, full-bleed** backdrop with fog haze at both ends, fed by `--mk-*` marketing tokens, sized to the viewport. The app need is the opposite — a **finite single row of the member's real N boxes**, contained in a fixed-height block on a normal page, themed with app tokens. Forcing those two into one component would tangle both. Instead, build a focused `PuzzlePlank3D` that **reuses the genuinely shared pieces** — `PuzzleBox` (`box.tsx`), `box-art.ts`, and `palette.ts`'s `LIGHTING` + `resolveCssColor` — and has its own bounded single-row arrangement, contained camera, and CSS fallback.

## Architecture

New directory `apps/web/src/components/common/puzzle-plank-3d/`:

- **`index.tsx` — `PuzzlePlank3D({ boxes }: { boxes: PuzzlePlankBox[] })`.** The public component, mirroring `JigPlank3D`'s orchestration but for a contained widget:
  - WebGL-support check, `prefers-reduced-motion`, theme (`next-themes`), `React.lazy` scene, `IntersectionObserver` to pause the render loop offscreen, and a render-nothing error boundary that leaves the CSS fallback — all adapted from `JigPlank3D`.
  - **Fallback = the existing CSS `PuzzlePlank`** (`@/components/common/puzzle-plank`), shown during SSR/first paint and crossfaded out when the scene's first frame lands; permanently shown if WebGL is unavailable or the scene errors.
  - Resolves each box's `c1`/`c2` via `resolveCssColor` against the **app DOM scope** (the dashboard/profile pass concrete hex colors, which resolve trivially; brand `var()`s resolve too) and the app heading font.
  - Fills its parent container (the parent owns the height; see "Sizing").

- **`scene.tsx` — the bounded single-row scene** (default export, `React.lazy`-loaded). A `<Canvas>` with:
  - One shelf board sized to the actual row width (no fog, no endless span, no repeat).
  - The real `PuzzleBox` instances laid out left→right by a pure `layoutRow(boxes)` helper (see Components), each at its natural footprint (no size jitter — these are the member's real boxes, shown faithfully).
  - Lighting from `palette.ts` `LIGHTING[theme]`, a `ContactShadows` under the row, and the gentle pointer `Parallax` (reduced-motion → disabled), reused/adapted from `scene.tsx`.
  - Camera framed to fit the whole row with a small margin (cover-fit by the row's bounding width/height).
  - `onFirstFrame` to trigger the crossfade.

- **`layout.ts` — pure `layoutRow` helper + its types.** Computes each box's world `x` position and the row's total width from the box widths + a fixed gap, deterministically (no randomness). Unit-tested.

- **`palette.ts` reuse:** import `LIGHTING`, `resolveCssColor` as-is. `resolveHeadingFont` currently hard-codes `--font-mk-heading`; generalize it to `resolveHeadingFont(scope, varName = "--font-mk-heading")` and call it with `--font-heading` from the app component. (Backward-compatible — the marketing caller keeps the default.)

- **`box.tsx` / `box-art.ts` reuse:** `PuzzleBox` already accepts a `PlankBox` plus a resolved `BoxSlot` ({x, c1, c2}) and `headingFont`; it is theme/scope-agnostic. The app `PuzzlePlankBox` is structurally compatible with `PlankBox` (`title`/`series`/`pieceCount`/`cover`/`c1`/`c2`/`width`/`height`). The scene passes app boxes through unchanged.

## Data flow

No backend change. Both consumers already build the box list:

- **Dashboard `shelf-section.tsx`:** swap `<PuzzlePlank boxes={…}/>` for `<PuzzlePlank3D boxes={…}/>` inside a sized container. Keep the existing `owned.slice(0, 5).map(toPlankBox)` mapping. (This supersedes ②'s mobile plank sizing on the dashboard — see "Sizing".)
- **Profile `shelf-section.tsx`:** same swap, `copies.slice(0, 6)` mapping unchanged.

## Sizing (contained canvas)

The CSS plank is intrinsic-height; a `<Canvas>` needs a defined parent height. The `PuzzlePlank3D` parent container gets a responsive fixed height (a `clamp()` block) that matches the plank's visual footprint, shorter on mobile (carrying ②'s "shorter on mobile" intent into the 3D widget, which now owns it). The CSS fallback renders centered within the same box. Exact heights are pinned in the implementation plan.

## Components / boundaries

- **`layoutRow(boxes)` (pure)** — input: ordered boxes; output: `{ slots: {x}[], rowWidth }`. No DOM, no three.js. The one unit-tested unit.
- **`scene.tsx`** — owns all three.js; depends on `box.tsx`, `palette.ts`, `layout.ts`. Knows nothing about the dashboard/profile.
- **`index.tsx`** — owns WebGL/fallback/lifecycle orchestration + color resolution; depends on the CSS `PuzzlePlank` and `scene.tsx`. The only thing the pages import.
- Consumers (`dashboard-home/shelf-section.tsx`, `profile/shelf-section.tsx`) — unchanged except the component swap + container.

## Testing / verification

- **Unit (TDD):** `layout.ts` `layoutRow` — deterministic x-positions and total width for given box widths + gap (mirrors the existing `box-art.test.ts` pure-logic convention).
- **No 3D rendering tests** (consistent with the untested marketing `scene.tsx`/`index.tsx`); the error boundary + CSS fallback make 3D failures non-fatal by design.
- **Manual / user verification** (browser automation unavailable here): on dashboard + profile, the shelf shows the member's real puzzles as 3D boxes on a board; with WebGL off or on error, the CSS plank still shows; reduced-motion disables the parallax; desktop and mobile both render contained (no full-bleed, no horizontal overflow).

## Out of scope (later sub-projects)

- Curation / "highlight" — which puzzles and in what order the **profile** passes (④); ③ just renders the list it's given.
- Grab/drag and rigid-body physics (⑤).
- Any change to the marketing hero `JigPlank3D` (it keeps its endless-backdrop behavior; ③ only generalizes `resolveHeadingFont` in the shared `palette.ts`, backward-compatibly).

## Risks / decisions (documented, not blocking)

- **Two WebGL contexts** can now exist on one page only on the marketing site (hero) — the app pages have one plank each, so at most one canvas per app page. Fine.
- **Dashboard is the highest-traffic page;** the scene is `React.lazy` + offscreen-paused + DPR-clamped + CSS-fallback-first, so first paint is the cheap CSS plank and WebGL upgrades in. Acceptable.
- **Interaction = gentle parallax only** in ③ (decided default); ⑤ layers physics on the same scene.
