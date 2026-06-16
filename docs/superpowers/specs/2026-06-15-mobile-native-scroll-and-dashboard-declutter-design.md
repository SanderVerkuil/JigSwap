# Mobile native scroll + dashboard declutter

**Date:** 2026-06-15
**Status:** Approved (design)
**Sub-project ② of the mobile/3D-plank punch list** (① quick polish ✓ → **② mobile shell + dashboard declutter** → ③ 3D plank for real collections → ④ profile shelf curation → ⑤ rigid-body physics).

## Goal

Two intents, disjoint file sets (so they implement independently):

- **Intent A — Item 1: mobile native document scroll.** Below the `md` breakpoint, the app scrolls at the document level so the mobile browser's address bar collapses on scroll. The mobile top bar stays pinned (sticky); the bottom tab bar stays fixed. The desktop inset-card shell is unchanged.
- **Intent B — Item 4: focus the mobile dashboard.** De-emphasize the hero, condense the crowded "pulse" middle, shorten the shelf plank, and tighten vertical rhythm — all mobile-only. Every section stays reachable; the top of the page becomes about _status + shelf_.

CSS/layout only. No backend, no data, no new routes, no JS breakpoint branch in the shell (pure responsive classes → no SSR/hydration flash). Intent B uses the existing `useIsMobile()` hook for the two numeric props that can't be expressed in CSS (plank box size, goal-ring size); a brief first-paint at desktop size is acceptable.

## Why CSS-responsive (not a JS-branched mobile shell)

The fixed-height behavior comes solely from `h-svh overflow-hidden` on `SidebarProvider` plus the inner `overflow-y-auto`. `html` has only `overflow-x-hidden`; `body` and the root have no height/overflow lock — so relaxing those classes below `md` lets the document scroll natively. This matches the shell's existing pattern of CSS-swapping mobile vs. desktop chrome (`md:hidden` / `hidden md:block`) and avoids a hydration flash. `PageHead` is already `hidden ... md:block`, so the sticky mobile top bar is the only mobile top chrome — no collision.

---

## Intent A — Mobile native scroll

All changes in the dashboard shell + the two mobile bars. The mechanism: gate every scroll/height constraint to `md:`, make the mobile top bar `sticky` and the tab bar `fixed`, and give mobile content bottom padding to clear the fixed bar.

### `apps/web/src/components/dashboard-layout/shell.tsx`

1. **`SidebarProvider`** — `className="h-svh flex-col overflow-hidden"` → `className="flex-col md:h-svh md:overflow-hidden"`. (The component's base classes already include `flex min-h-svh w-full`, so mobile keeps `min-h-svh` and grows with content; desktop regains `h-svh overflow-hidden`.)

2. **The sidebar/inset row** — `<div className="flex min-h-0 flex-1">` → `<div className="flex flex-1 md:min-h-0">`. (`flex-1` is harmless on mobile; `min-h-0` — needed only for the fixed-height inner-scroll case — is gated to `md`.)

3. **`SidebarInset`** — gate the scroll-clip to `md`: `className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-0 …"` → `className="md:min-h-0 md:overflow-hidden md:peer-data-[variant=inset]:mt-0 …"` (the existing `md:peer-data-[variant=inset]:*` inset margins/border are unchanged).

4. **The inner scroll `<div>`** (currently the single scroll region) — `className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"` → `className="flex-1 overflow-x-hidden md:min-h-0 md:overflow-y-auto md:[scrollbar-gutter:stable]"`. On mobile it becomes a normal flowing block (no inner scroll → content extends the document); desktop keeps the inner scroll under the glass head.

5. **`ContentArea` bottom padding** — the now-`fixed` tab bar (~56px tall + safe area) would overlap content. Change `"w-full px-4 pt-[18px] pb-8 md:p-6"` → `"w-full px-4 pt-[18px] pb-[calc(env(safe-area-inset-bottom)+76px)] md:p-6"`. (`md:p-6` overrides the bottom padding on desktop, so desktop is unchanged.)

### `apps/web/src/components/dashboard-layout/mobile-top-bar.tsx`

6. **Pin the bar.** Header `className="shrink-0 border-b bg-card pt-[env(safe-area-inset-top)] md:hidden"` → prepend `sticky top-0 z-30`. The opaque `bg-card` keeps content legible scrolling underneath; the browser address bar still collapses on scroll-down (sticky is independent of the browser's own chrome).

### `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx`

7. **Fix the bar to the viewport bottom.** The `<nav>` is `className="relative z-30 grid shrink-0 grid-cols-5 …"`; change the leading `relative` → `fixed inset-x-0 bottom-0`. It is already `md:hidden`, so this only affects mobile. The existing `pb-[env(safe-area-inset-bottom)]`, `z-30`, and `overflow-visible` (for the raised center button) stay.

### Spacing note (Item 1's "large padding")

With native scroll + a fixed tab bar + the new bottom padding, short pages (e.g. the empty dashboard) sit at the top with the tab bar pinned at the bottom — no stretched filler. The oversized gap in the report was the fixed-shell behavior plus the tall hero/plank; Intent A removes the former and Intent B the latter.

---

## Intent B — Focus the mobile dashboard

Mobile-only de-emphasis + condensing. All `md:`/`lg:` values below preserve the current desktop appearance exactly.

### `apps/web/src/routes/_dashboard/dashboard.tsx`

1. Page section gap: `className="flex w-full flex-col gap-8 md:gap-10"` → `gap-6 md:gap-10`.

### `apps/web/src/components/dashboard-home/briefing-hero.tsx`

2. **Headline** (`Headline`'s `<p>`): `"font-heading max-w-[860px] text-2xl leading-[1.4] font-semibold tracking-tight text-pretty md:text-3xl"` → make the mobile size smaller and tighter: `text-xl leading-snug … md:text-3xl md:leading-[1.4]`. Net: mobile `text-xl leading-snug`, desktop unchanged (`text-3xl`, `leading-[1.4]`).
3. **Hero gap** (both the `BriefingHero` `<section>` and the loading-skeleton `<section>`): `"flex flex-col gap-5"` → `"flex flex-col gap-4 md:gap-5"`.

### `apps/web/src/components/dashboard-home/shelf-section.tsx`

4. **Shorter, narrower plank on mobile.** `PuzzlePlank` derives every box's height from its `width` (cover boxes via image aspect; no-cover boxes via the `height` fallback), so shrinking `width` + the fallback heights on mobile makes the whole plank shorter. This file is already `"use client"`.
   - Import and call `useIsMobile()` from `@/hooks/use-mobile`.
   - Thread `isMobile` into `toPlankBox`. On mobile set `width: 92` (desktop: leave `undefined` → the component default 116) and use a shorter fallback-height array `[118, 104, 124, 100, 114]` (desktop keeps `[148, 130, 156, 126, 142]`).
   - Reduce the plank wrapper's vertical padding on mobile: `className="min-w-0 overflow-x-auto px-2 pt-6 pb-5"` → `"min-w-0 overflow-x-auto px-2 pt-3 pb-3 md:pt-6 md:pb-5"`.
   - The `overflow-x-auto` swipe is kept (boxes stay legible; they're just smaller on mobile).
   - **Note:** sub-project ③ replaces this CSS plank with the 3D scene on the dashboard, which will own final box sizing. Intent B's plank change is the minimal mobile-height trim until then; do not over-invest here.

### `apps/web/src/components/dashboard-home/pulse-section.tsx`

5. **Tighter stacked gap on mobile** (the three columns stack below `lg`): the `PulseSection` grid and the `PulseSkeleton` grid both use `"grid gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]"` → `"grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]"`.
6. **Smaller goal ring on mobile.** `GoalRing` hardcodes `const size = 148`. Add a `size` prop (default `148`) and derive the SVG geometry from it (it already does: `r`, `c`, `mid` are computed from `size`; the container `size-[148px]` must become `style={{ width: size, height: size }}`). In `GoalsColumn`, call `useIsMobile()` and pass `size={isMobile ? 116 : 148}`.

---

## Components / boundaries

- **Shell scroll model (Intent A)** — one responsibility: below `md`, document-level scroll with pinned top / fixed bottom chrome; at/above `md`, the inset-card shell with inner scroll. Expressed entirely in responsive classes across `shell.tsx` + the two mobile bars.
- **Dashboard mobile density (Intent B)** — per-section responsive sizing; each dashboard-home component owns its own mobile treatment. `GoalRing` gains a reusable `size` prop (no longer hardcoded).

## Testing / verification

- No automated tests (layout-only; consistent with the untested presentational dashboard/shell components — same call made in sub-project ①). The `GoalRing` `size` prop is exercised visually.
- **Manual verification (controller, post-integration):** Note browser automation is unavailable in this environment (no Chrome for Playwright). Verification is by layout reasoning + a user eyeball on a real phone:
  - Mobile (≤767px), authenticated dashboard: scrolling moves the _document_ (address bar collapses); the top bar stays pinned; the tab bar stays fixed at the bottom and never overlaps content (bottom padding clears it); the hero headline is smaller, the plank shorter, the pulse columns tighter with a smaller goal ring.
  - Desktop (≥768px): byte-for-byte unchanged — inset card, inner scroll under the glass head, original hero/plank/pulse sizes.

## Out of scope (later sub-projects)

- Swapping the CSS plank for the WebGL 3D scene on dashboard + profile (③) — which supersedes Intent B's plank sizing.
- Profile shelf curation / highlight (④); rigid-body physics (⑤).
- Any change to the desktop shell, the desktop top bar, or the sidebar offcanvas.
