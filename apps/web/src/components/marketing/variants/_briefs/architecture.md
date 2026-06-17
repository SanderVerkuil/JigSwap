# Landing Variant System — Technical Theming & Layout Architecture

**Audience:** frontend devs building the four landing variants (`playful`, `editorial`, `cozy`, `retro`) plus `original`.
**Status:** authoritative. These rules are non-negotiable; the orchestrator owns the switcher/data foundation, you own the variant components inside the contract below.

---

## 0. Ground truth (what already exists — do not change)

- Marketing tokens live in `apps/web/src/styles/marketing.css`, all `--mk-*` prefixed, derived from three seeds (`--mk-seed-primary #6048e8`, `--mk-seed-secondary #19c316`, `--mk-seed-accent #ec4899`).
- Ramps `--mk-violet-50..900`, `--mk-green-50..700`, `--mk-pink-300..500`; surfaces `--mk-bg / --mk-card / --mk-muted`; text `--mk-text-strong / -body / -muted`; lines `--mk-border / --mk-input-border / --mk-ring`; shadows `--shadow-mk-xs..lg` + `--shadow-mk-brand`; easings `--ease-mk-out`, `--ease-mk-spring`; heading font `--font-mk-heading` ("Baloo 2"), body `--font-mk-sans`.
- Dark mode rides the **`.dark` class** (next-themes). The ramps flip automatically because the engine re-points `--mk-soft`/`--mk-deep`/`--mk-ground`/`--mk-card-base` under `.dark` and everything is `color-mix()`-derived from the seeds.
- Tailwind v4, **no config file**. Utilities like `bg-mk-card`, `text-mk-text-strong`, `font-mk-heading`, `shadow-mk-brand` exist because `marketing.css` exposes the tokens via `@theme inline`. The `inline` keyword is what lets the `.dark` cascade flip them at runtime — preserve that mechanism, never hardcode hex in components.
- Containers: `1200px` (default) / `760px` (`narrow`) max-width, `px-6` gutters (`Container`). Section rhythm: `py-[clamp(56px,8vw,104px)]` (`Section`). Mobile breakpoint convention across the marketing tree is **`max-[860px]` / `min-[861px]`** (one hard breakpoint, not Tailwind's `md`).
- Fonts are loaded once in `apps/web/src/routes/__root.tsx` as Google Fonts `<link>` stylesheets (Baloo 2 + Poppins), with `preconnect` to `fonts.googleapis.com` / `fonts.gstatic.com`.

The whole point of this system: **components stay written against `--mk-*`. A variant re-skins the page by redeclaring `--mk-*` (and adding `--v-*`) inside its `.v-<id>` scope — never by editing the global token file.**

---

## 1. Per-variant token scoping (THE core rule)

### 1.1 The pattern

Each variant root carries `class="v-<id>"` (orchestrator contract) and imports its own `<id>.css`. Inside that CSS you **redeclare the `--mk-*` tokens you want to change** on the `.v-<id>` selector. Because every shared component (`Button`, `Section`, `Reveal`, headers, cards) reads `--mk-*` through `var()`, those components instantly re-skin with zero component edits — same cascade trick the `.dark` class uses, one scope deeper.

Two layers of tokens:

- **Re-point `--mk-*`** to change what existing shared components render (palette, surfaces, border, ring, shadows, heading font).
- **Add new `--v-*`** for variant-only concepts that have no `--mk-*` equivalent (display font, paper grain opacity, hero blob colors, custom radii scales, texture seeds). Variant-private styling reads `--v-*`.

**Rules:**
1. Never edit `marketing.css` or `globals.css` to theme a variant. All overrides live under `.v-<id>` in `<id>.css`.
2. Re-point tokens by re-deriving from seeds where possible (`color-mix(... var(--mk-seed-*) ...)`) so the warm/cool relationships stay coherent; only drop to literal hex for a deliberately off-brand palette (retro, cozy).
3. Dark mode for a variant is handled with **`.dark .v-<id> { ... }`** — you must provide it for every token you changed whose light value won't survive on a dark ground. If you only shift hues (not lightness grounds) you may inherit the global `.dark` flip; if you set literal surface hex you MUST supply the `.dark .v-<id>` counterpart.
4. Keep `--mk-ring` meaningful (focus visibility) and keep `--mk-text-*` at AA contrast against your new `--mk-bg`/`--mk-card` (see §5).

### 1.2 Concrete example — `cozy` (`cozy.css`)

```css
/* apps/web/src/components/marketing/variants/cozy/cozy.css
   Cozy / Hygge: warm amber-terracotta palette, soft cream surfaces,
   humanist display type, generous radii. Re-points --mk-* so shared
   Button/Section/cards turn warm with no component changes. */

.v-cozy {
  /* --- Re-seed the engine toward warm (keeps ramp relationships) --- */
  --mk-seed-primary: #c2683d;   /* terracotta — replaces violet as "brand" */
  --mk-seed-secondary: #7d8b5a; /* sage/olive — replaces go-green */
  --mk-seed-accent: #d9a441;    /* honey — replaces pink */

  /* --- Warm grounds (literal: a cream page, not a tinted white) --- */
  --mk-ground: #f6ede0;
  --mk-card-base: #fffaf2;
  --mk-bg: color-mix(in oklab, var(--mk-seed-primary) 5%, var(--mk-ground));
  --mk-card: color-mix(in oklab, var(--mk-seed-primary) 3%, var(--mk-card-base));
  --mk-muted: color-mix(in oklab, var(--mk-seed-primary) 8%, #efe2d0);

  /* --- Warm-neutral ink (still AA on cream) --- */
  --mk-text-strong: #2e2117;
  --mk-text-body: #4a3a2c;
  --mk-text-muted: #8a7560;

  --mk-border: color-mix(in oklab, var(--mk-seed-primary) 16%, #e6d6c2);
  --mk-ring: var(--mk-seed-primary);

  /* --- Softer, warmer shadows than the cool-neutral --shadow-mk-* --- */
  --shadow-mk-md: 0 6px 18px -4px rgb(120 70 30 / 0.16);
  --shadow-mk-lg: 0 16px 36px -8px rgb(120 70 30 / 0.20);
  --shadow-mk-brand: 0 10px 30px -8px rgb(194 104 61 / 0.34);

  /* --- Re-point heading font + variant-only display/texture tokens --- */
  --mk-radius-card: 22px;                       /* used by variant CSS */
  --v-font-display: "Fraunces", Georgia, serif; /* humanist display */
  --v-paper-warmth: 0.06;                       /* gradient/texture intensity */

  /* Make shared components read the variant display where headings appear: */
  --font-mk-heading: var(--v-font-display);
}

/* Dark cozy: candle-lit, not black. Re-derive grounds; ink goes warm-light. */
.dark .v-cozy {
  --mk-ground: #221913;
  --mk-card-base: #2c211a;
  --mk-bg: color-mix(in oklab, var(--mk-seed-primary) 10%, var(--mk-ground));
  --mk-card: color-mix(in oklab, var(--mk-seed-primary) 8%, var(--mk-card-base));
  --mk-muted: color-mix(in oklab, var(--mk-seed-primary) 12%, #2e231b);
  --mk-text-strong: #f4e9da;
  --mk-text-body: #e4d4c2;
  --mk-text-muted: #b39e88;
  --mk-border: color-mix(in oklab, var(--mk-seed-primary) 18%, #3a2c22);
}
```

Same skeleton for the other three. Brief palette intent per variant:

- **`playful`** — keep close to the real seeds (it IS the premium brand mood), but boost saturation, add `--v-font-display` rounded display, larger `--mk-radius-*`, springier motion via `--ease-mk-spring`. Mostly additive; minimal `.dark .v-playful` needed (inherit global flip).
- **`editorial`** — near-monochrome ink-on-paper: `--mk-bg`/`--mk-card` to bright off-white/near-black, ONE high-chroma accent (re-point `--mk-seed-accent` to a single editorial red/violet), giant high-contrast display via `--v-font-display`. Must supply `.dark .v-editorial`.
- **`cozy`** — warm example above.
- **`retro`** — nostalgic muted board-game palette (mustard/teal/brick/cream), literal hex grounds, slab/vintage `--v-font-display`, paper grain tokens. Must supply `.dark .v-retro` (dim the paper, keep the grain).

---

## 2. Typography architecture

### 2.1 Loading mechanism (matches the existing pattern)

Each variant introduces ONE display typeface, exposed as `--v-font-display` and wired into headings by re-pointing `--font-mk-heading` (see §1.2). Two allowed loading strategies — **prefer self-host for the variant displays**:

- **Preferred — self-host via `@font-face` in `<id>.css`** with `font-display: swap` and a local woff2 placed under `apps/web/src/components/marketing/variants/<id>/fonts/`. (NOTE: the brief forbids binary assets in THIS spec's deliverables, but production self-hosting is the recommended path; if you cannot add binaries yet, fall back to Google Fonts.)
- **Fallback — Google Fonts `@import`** at the top of `<id>.css`: `@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&display=swap");`. Acceptable, but the `@import` blocks until fetched and adds a request chain — only one weight axis range per variant.

Do **not** add variant fonts to `__root.tsx` — that would load all four variants' faces on every page. Variant fonts load only when the variant CSS is imported by the variant component.

### 2.2 CLS / perf guardrails (mandatory)

- Always `font-display: swap` (self-host) or `&display=swap` (Google). Never `block`.
- Always declare a metric-compatible fallback in `--v-font-display` (e.g. `"Fraunces", Georgia, serif`) so the swap reflow is minimal.
- Add `size-adjust` / `ascent-override` on self-hosted `@font-face` where the display face differs a lot from its fallback (editorial's huge type makes CLS most visible there).
- One display family per variant, narrowest weight range that covers the design. Editorial may load two weights (e.g. 400 + 800) max.
- Headings use `--v-font-display`; **body text stays on `--font-mk-sans`** in every variant (readability + no second web font). Exception: retro may set body to a system slab stack with no extra download.

### 2.3 Suggested typefaces

| Variant | Display intent | Suggested `--v-font-display` |
|---|---|---|
| `playful` | rounded, friendly, premium | `"Baloo 2"` (already loaded) or `"Quicksand"` |
| `editorial` | high-contrast expressive display | `"Fraunces"` (opsz) or a grotesque like `"Space Grotesk"` |
| `cozy` | humanist, warm, soft serif | `"Fraunces"` soft / `"Newsreader"` |
| `retro` | slab / vintage / board-game | `"Bitter"`, `"Rokkitt"`, or a chunky slab |

Reusing **Baloo 2 for `playful`** costs zero extra bytes (already in `__root.tsx`).

---

## 3. Layout & responsive contract (all variants honor)

Distinct layouts are encouraged; the shared skeleton that keeps them coherent is not optional.

- **Container widths:** content max-width ≤ `1200px`, reading columns `760px`. You may go full-bleed for hero/texture bands, but text blocks must respect these maxes. Reuse `Container` (`max-w-[1200px] mx-auto px-6`) or replicate its gutters exactly (`px-6`, never less than 16px on mobile).
- **Section rhythm:** vertical padding `clamp(56px, 8vw, 104px)` (reuse `Section`, or match it). Editorial may use asymmetric/looser rhythm but stay within `clamp(40px, …, 140px)`.
- **Fluid type & spacing:** size headings/spacing with `clamp()`, never fixed px that can't shrink. Reference: existing display is `clamp(28px,4vw,40px)`; editorial may push the hero to `clamp(40px, 9vw, 112px)`. Always set a sane min so mobile never overflows.
- **One breakpoint:** honor `max-[860px]` / `min-[861px]` as the primary desktop↔mobile switch (consistent with header/footer). Use `max-[540px]` only for a further single-column collapse (footer already does this). Don't introduce a parallel `md:`/`lg:` ladder.
- **Overflow safety:** the page root uses `overflow-x-clip`; any rotated/oversized decorative element (editorial bleeds, retro stickers) must not create horizontal scroll. Test at 320px.
- **Header/footer coherence:** whatever the body layout, the page must open with a header landmark and close with a footer landmark at the standard container width so the chrome reads as the same product (see §4 for swapping).

---

## 4. Reuse vs rebuild

Default to **reuse**. Rebuild only when the variant's identity demands it, and keep the same data + landmarks.

| Piece | Default | Notes |
|---|---|---|
| `useLandingData()` (`{ stats, communityAvatars, plankPuzzles }`) | **Reuse always** | Single source of truth. Never re-fetch Convex directly in a variant. |
| `useStartHref()` | **Reuse always** | Primary CTA href. |
| `Container` | Reuse (or match its widths/gutters) | |
| `Section` / `Eyebrow` / `SectionHead` | Reuse for standard bands; rebuild for editorial/retro custom rhythm | If you rebuild, match the `clamp()` rhythm in §3. |
| `Reveal` | **Reuse always** | It's SSR-safe, base-visible, and already respects reduced-motion. Don't hand-roll scroll reveals. |
| `MarketingHeader` / `MarketingFooter` | Reuse by default | They read `--mk-*`, so they re-skin automatically under `.v-<id>`. |
| `JigPlank3D` (Three.js plank) | Reuse for `playful` hero (its signature interactive moment); optional elsewhere | Heavy + interactive — see §5 reduced-motion + lazy-load. `editorial`/`cozy`/`retro` should prefer their own hero (flat illustration / photo-gradient / paper diorama). |
| `Wordmark`, `PieceMotif` | Reuse freely | Inherit `--mk-*`. |
| `Button` (shadcn, `brand` variant) | Reuse | `brand` variant uses `--shadow-mk-brand` etc., re-skins automatically. |

**Swapping header/footer:** if a variant needs different chrome (e.g. editorial wants a hairline serif header), build `variants/<id>/header.tsx` / `footer.tsx` and render those inside the variant root **instead of** importing the shared ones. Requirements when you do:
- Keep semantic `<header>` / `<footer>` landmarks and the same nav destinations (the shared `NAV` list and auth `Button`s).
- Keep the light/dark `ModeToggle` and the `LangToggle` (do not drop i18n/theme controls).
- Style via `--mk-*` / `--v-*` only.
- The floating variant switcher is injected by the orchestrator at the app shell level — variants must not render or block it, and must not use `position: fixed` elements that cover its corner.

---

## 5. Accessibility & motion guardrails

- **Contrast (AA, 4.5:1 body / 3:1 large text):** the warm-on-warm (cozy, retro) and huge-type (editorial) variants are the risk zones. After re-pointing `--mk-bg`/`--mk-card`, verify `--mk-text-body` and `--mk-text-muted` against them; `-muted` is the usual failure. Editorial's accent-on-paper must clear 4.5:1 for any accent-colored body text (accent is fine for large display only).
- **Focus states:** keep `--mk-ring` set to a hue with ≥3:1 against the variant surface; never remove focus outlines. Shared `Button`/links already use it — don't override `outline: none` without a replacement ring.
- **prefers-reduced-motion:** any "delightful interactive hero moment" (playful's plank, editorial parallax, retro tilt/sticker physics) MUST degrade to a static, fully-legible state under `@media (prefers-reduced-motion: reduce)`. `Reveal` already handles this for scroll-ins; you handle it for bespoke hero motion. The 3D plank: gate auto-spin/drag-idle animation on the media query, and lazy-load it (`React.lazy` / dynamic import) so reduced-motion + slow devices aren't forced to download Three.js eagerly.
- **Semantic landmarks:** exactly one `<header>`, one `<main>`, one `<footer>` per variant; section headings in order (`h1` once in the hero, `h2` per section). Asymmetric editorial layout must keep DOM order = reading order (don't reorder headings purely with CSS grid placement).
- **Interactive targets:** ≥44px hit area for CTAs/toggles, even when the visual chip is smaller.
- **Motion budget:** decorative loops (floating motifs, grain shimmer) must pause/stop under reduced-motion and must not run off-screen.

---

## 6. Texture & asset strategy (pure CSS/SVG — no binary assets)

No real photography or raster textures are required or permitted as binaries here. Achieve atmosphere with CSS gradients + inline SVG (data-URI) filters.

### 6.1 Cozy — photo-warmth fallback

Simulate a photographed warm scene with layered radial/linear gradients reading off `--v-paper-warmth` and the warm seeds:

```css
.v-cozy .hero-photo-fallback {
  background:
    radial-gradient(60% 70% at 20% 15%,
      color-mix(in oklab, var(--mk-seed-accent) 40%, transparent), transparent 70%),
    radial-gradient(55% 65% at 85% 10%,
      color-mix(in oklab, var(--mk-seed-primary) 28%, transparent), transparent 72%),
    linear-gradient(160deg,
      color-mix(in oklab, var(--mk-seed-accent) 14%, var(--mk-card)),
      var(--mk-bg));
}
```

Add a subtle "film grain" via an inline SVG `feTurbulence` mask at low opacity (`var(--v-paper-warmth)`), so the gradient reads less flat. If a real photo is later supplied, it drops in over this same box as a progressive enhancement — keep the gradient as the SSR/no-image baseline.

### 6.2 Retro — paper grain / board-game box

Generate paper fibre + a faint print misregistration with inline SVG `feTurbulence` + `feColorMatrix`, tiled as a `background-image: url("data:image/svg+xml,...")`, multiplied over the muted retro surface:

```css
.v-retro .paper {
  background-color: var(--mk-card);
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.05'/></svg>");
  background-blend-mode: multiply;
}
```

- Keep grain opacity ≤ ~0.06 light / ≤ ~0.09 dark; it must never drop text contrast below AA.
- Board-game "box edge" = CSS `border` + layered `box-shadow` + a slight `border-radius`, not an image.
- Stickers/stamps = inline SVG shapes or text in `--v-font-display`, rotated with `transform`, kept inside the overflow-clip (§3).
- Honor reduced-motion: any grain shimmer/animation stops; the static grain stays.

---

## Non-negotiable summary (read this if nothing else)

1. **Theme by scope, not by edit.** Re-skin only by redeclaring `--mk-*` / adding `--v-*` inside `.v-<id>` in `<id>.css`; never touch `marketing.css` or `globals.css`. Components stay written against `--mk-*`.
2. **Dark mode is `.dark .v-<id>`.** If you set literal surface colors, you MUST supply the dark counterpart; keep `--mk-text-*` at AA on your new grounds.
3. **One display font per variant**, exposed as `--v-font-display`, wired via `--font-mk-heading`, loaded only in the variant CSS (never `__root.tsx`), `font-display: swap` + metric fallback; body stays on `--font-mk-sans`.
4. **Honor the layout contract:** ≤1200/760px content, `clamp(56px,8vw,104px)` rhythm, `clamp()` type, the single `max-[860px]/min-[861px]` breakpoint, and no horizontal overflow at 320px.
5. **Reuse `useLandingData()`, `useStartHref()`, and `Reveal` always**; reuse header/footer unless you rebuild them with the same landmarks, nav, theme + lang toggles, and `--mk-*` styling.
6. **Accessibility is a gate:** AA contrast (watch warm-on-warm + editorial accent text), visible `--mk-ring` focus, one h1, ordered landmarks, ≥44px targets; every bespoke hero animation degrades fully under `prefers-reduced-motion` and the 3D plank lazy-loads.
7. **Textures are pure CSS/SVG** (gradients + inline `feTurbulence`), no binary assets; grain opacity must never break text contrast.
