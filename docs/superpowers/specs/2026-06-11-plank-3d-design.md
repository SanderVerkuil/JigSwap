# Interactive 3D Puzzle Plank — Design

**Date:** 2026-06-11
**Status:** Approved
**Scope:** Home hero only. The feature row and about page keep the existing CSS plank.

## Problem

The marketing "puzzle plank" (`apps/web/src/components/marketing/plank.tsx`) is a
CSS-skew isometric illustration: 45° axonometric angles, flat gradients, no
perspective and no real lighting. It reads as cartoonish. We want the hero
version to look like a stylized product render — real perspective, soft
shadows, believable cardboard — and to be playfully interactive.

## Decisions

| Decision     | Choice                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| Motion level | Playful interactive (hover lift, drag with spring settle)                                     |
| Placement    | Hero only; CSS plank stays elsewhere and as fallback                                          |
| Art style    | Stylized-real: brand violet palette, product-render lighting, not photoreal                   |
| 3D stack     | `three` + `@react-three/fiber` v9 + `@react-three/drei` + `maath` springs — no physics engine |
| Perf budget  | Lazy-loaded code-split chunk (~170 kB gzip) acceptable; must not block first paint            |

Rejected alternatives:

- **Rapier physics** (`@react-three/rapier`): true rigid-body fun, but +300 kB
  gzipped WASM and tuning risk. Springs approximate the feel; Rapier can be
  layered on later without architectural change.
- **Spline runtime:** fastest to pretty, but heavier than three.js, locks us to
  external tooling, and dynamic box art (titles/covers from props) is awkward.

## Architecture

New module `apps/web/src/components/marketing/plank-3d/`. The existing
`plank.tsx` is **not modified**.

```
plank-3d/
  index.tsx    JigPlank3D — public component, same `boxes: PlankBox[]` API
  scene.tsx    R3F <Canvas>: camera, lights, shelf, boxes, contact shadows
  box.tsx      One puzzle box mesh: RoundedBox + materials + interaction
  box-art.ts   PlankBox → offscreen canvas → CanvasTexture (front-face art)
```

### `index.tsx` — progressive enhancement wrapper

1. Renders the CSS `JigPlank` immediately. SSR-safe, zero layout shift.
2. After mount, dynamically imports the scene chunk (`React.lazy`).
3. When the scene has rendered its first frame, crossfades CSS → canvas.
4. If WebGL is unavailable or the import fails, the CSS plank simply stays.
   No error UI — the fallback _is_ the current production visual.

The canvas mounts inside the same fixed-size container the CSS plank occupies.

### `scene.tsx`

- Perspective camera, ~35° FOV, gentle ¾ view matching the current
  illustration's reading direction (front-left).
- Lighting: one soft directional key light + hemisphere/ambient fill lights.
  (No drei `Environment` HDRI presets — those fetch from a third-party CDN at
  runtime, which a marketing page must not depend on.)
- Wooden shelf: box mesh with rounded front edge, warm wood-toned
  `meshStandardMaterial` (subtle procedural grain via the existing palette —
  no texture downloads).
- drei `ContactShadows` under the boxes for grounding.
- Transparent canvas background; the existing `mk-hero-glow` shows through.
- Render loop pauses when the hero scrolls offscreen (IntersectionObserver)
  or the tab is hidden. DPR clamped to `[1, 2]`.

#### Dark-mode lighting

The marketing palette flips its entire `--mk-*` ramp via the next-themes
`.dark` class, so the scene must follow `useTheme().resolvedTheme` reactively:

- **Lighting presets.** Light mode: warm key light (slightly warm white,
  intensity ~1.2), soft ambient/environment fill — daylight product-shot
  feel. Dark mode: dimmer, cooler key light (~0.7, cool white), lower
  environment intensity, plus a subtle violet rim/fill light (from the brand
  primary) so box silhouettes read against the dark hero background instead
  of disappearing into it.
- **Shadows.** `ContactShadows` opacity drops in dark mode (shadows on a dark
  page read as holes if too strong).
- **Materials.** The shelf wood tone darkens a step in dark mode; box
  materials inherit their colors from the (theme-resolved) CSS variables.
- **Reactivity.** CSS-var resolution for box art and materials re-runs when
  `resolvedTheme` changes — the violet ramp flips, so `CanvasTexture`s are
  re-rendered and material colors updated. Light values transition with the
  same spring damping as the interactions, so toggling the theme fades the
  lighting rather than snapping it.

### `box.tsx`

- Geometry: drei `RoundedBox`, slight bevel (real cardboard has soft edges).
- Materials: front face uses the `box-art.ts` texture; top/sides use a tinted
  cardboard material derived from the box's `c1`/`c2` colors.
- Each box gets a small deterministic lean/rotation (seeded by index, not
  `Math.random`) so the shelf looks naturally arranged.
- Interactions (all spring-damped via `maath`):
  - **Hover:** lifts a few units, tilts toward the cursor, pointer cursor.
  - **Drag:** follows the pointer with inertia, tilting into the drag
    direction; on release, springs back to its shelf slot with a wobble.
  - **Touch:** gesture is captured only when it starts on a box; page scroll
    is never hijacked.
- `prefers-reduced-motion`: scene renders statically; all animation disabled.

### `box-art.ts`

Pure function: `PlankBox` → `HTMLCanvasElement` (consumed as `CanvasTexture`).

- Color boxes: brand gradient, series eyebrow, piece-count badge, white title
  strip — visually matching the current CSS box fronts, using the same brand
  font (`--font-mk-heading` resolved via `document.fonts`).
- Cover boxes: draw the cover image; if it fails to load, fall back to the
  gradient treatment (mirrors today's `onError` behavior).
- Canvas sized at 2× the displayed face for crispness.

## Integration

`hero.tsx` swaps `<JigPlank boxes={PLANK} depth={18} />` for
`<JigPlank3D boxes={PLANK} />`. The `PLANK` data, `Reveal` wrapper, and the
surrounding layout/scale classes are unchanged. CSS color variables
(`var(--mk-violet-400)` etc.) are resolved to concrete colors at runtime
before being handed to the canvas/material code.

## Dependencies

`three`, `@react-three/fiber@^9`, `@react-three/drei`, `maath` — added to
`@jigswap/web`. All imports live behind the dynamic import so they land in a
separate chunk; verified with `rollup-plugin-visualizer` (already a devDep).

## Error handling

| Failure                          | Behavior                               |
| -------------------------------- | -------------------------------------- |
| WebGL context unavailable / lost | CSS plank stays / returns; no error UI |
| Lazy chunk fails to load         | CSS plank stays                        |
| Cover image fails                | Gradient box-art fallback              |
| JS disabled / SSR                | CSS plank (already the rendered HTML)  |

## Testing & verification

- Unit tests for `box-art.ts` (gradient layout, cover fallback) — it's the
  only pure-logic piece.
- Type-check + lint as usual.
- Manual/visual verification in the running app: hero render quality, drag
  feel, fallback path (WebGL blocked), reduced-motion, mobile touch scroll,
  and both themes — including toggling dark mode live (lighting fades, box
  art re-renders with the flipped ramp).
- Bundle check: 3D chunk is code-split and not in the entry bundle.

## Out of scope

- Feature row and about page visuals (keep CSS plank).
- Physics engine (possible later layer).
