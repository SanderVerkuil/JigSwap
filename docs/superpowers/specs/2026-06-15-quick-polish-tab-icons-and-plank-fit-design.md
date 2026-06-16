# Quick polish — mobile tab icons + landing plank fit

**Date:** 2026-06-15
**Status:** Approved (design)
**Sub-project ① of the mobile/3D-plank punch list** (decomposition: ① quick polish → ② mobile shell + dashboard declutter → ③ 3D plank for real collections → ④ profile shelf curation → ⑤ rigid-body physics).

## Goal

Two small, independent fixes:

1. **Item 2** — Mobile bottom tab bar shows icon **+ text label**; it should show **icon only**.
2. **Item 5** — The landing page scrolls horizontally on narrow viewports because the CSS `JigPlank` preview is wider than the viewport. The plank should **scale down to fit** the page width.

Both are visual/layout only. No backend, no data, no new routes.

## Item 2 — Mobile tab bar: icons only

**File:** `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx` (`TabLink`)

- Remove the text-label `<span>` that renders `t(`tabs.${tab.key}`)`.
- The visible label was the link's only accessible name, so **add `aria-label={t(`tabs.${tab.key}`)}` to the `Link`** to preserve the screen-reader name. The existing `aria-current="page"` on the active tab is unchanged.
- Keep: icon size (`size-[21px]`), the unread badge, the active vs. muted color treatment, the `min-h-14` touch target and vertical centering. The bar reads as icons-only but stays the same height-class so the raised center "+" still overlaps correctly.
- The `t` lookups for labels stay (now used for `aria-label`), so no translation keys are removed.

**Out of scope:** the center "+" button, the desktop sidebar, the mobile top bar.

## Item 5 — Landing plank scales to fit

### Root cause

`JigPlank` (`components/marketing/plank.tsx`) is `width: fit-content` and intrinsically ~500px wide. In the hero it's clipped by `overflow-hidden`, but it is also rendered as an inline preview — un-clipped, in a `w-full` flex cell — in:

- `components/marketing/home/feature-rows.tsx` — the "library" feature row visual.
- `routes/_public/about.tsx` — the mission section visual.

On a ~360px phone the ~500px plank overflows its cell and widens the document → horizontal scroll.

### Fix — reusable `FitToWidth` wrapper (chosen approach A)

New component: `apps/web/src/components/marketing/fit-to-width.tsx`

- Renders `children` inside a measured wrapper.
- Uses `ResizeObserver` on the outer container and reads the child's natural (unscaled) size.
- Computes `scale = Math.min(1, containerWidth / naturalWidth)` and applies `transform: scale(scale)` with `transform-origin: top center` (or center).
- Collapses the wrapper's rendered height to `naturalHeight * scale` so the scaled-down plank doesn't leave a layout gap and surrounding content flows correctly.
- Only ever scales **down** (`min(1, …)`) — at desktop widths the plank renders at natural size, unchanged.
- SSR-safe: before measurement, render at scale 1 (natural size) so first paint is correct on wide screens; the observer corrects narrow screens on mount.

Wrap the two inline `JigPlank` previews (`feature-rows.tsx` library row, `about.tsx` mission visual) with `FitToWidth`. The hero's plank is already clipped and is left untouched.

### Defensive safety net

Add `overflow-x-clip` to the marketing landing root in `routes/index.tsx` (`<div className="mk-root font-mk-sans min-h-screen">`). This is a cheap backstop against any other stray horizontal overflow; the `FitToWidth` wrapper is the real fix for the plank.

## Components / boundaries

- `FitToWidth` — single purpose: scale a fixed-size child down to fit its container width and collapse the layout height accordingly. Inputs: `children`. No knowledge of planks specifically; reusable for any over-wide preview.

## Testing / verification

- No automated tests for this layout-only change (consistent with the existing marketing components, which are untested presentational pieces).
- Manual verification: load the landing page at ~360px width — no horizontal scrollbar, the feature-row and about planks visibly shrink to fit. Load the dashboard on mobile — bottom tab bar shows icons with no text labels; VoiceOver/TalkBack still announces each tab name (aria-label). At desktop width the planks render at natural size, unchanged.

## Out of scope (later sub-projects)

- Mobile shell native scroll / address-bar hiding, dashboard declutter (②).
- Swapping the CSS plank for the WebGL 3D scene (③).
- Profile shelf curation / highlight (④).
- Rigid-body physics (⑤).
