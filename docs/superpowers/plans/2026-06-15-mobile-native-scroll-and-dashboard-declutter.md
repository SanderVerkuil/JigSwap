# Mobile Native Scroll + Dashboard Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below the `md` breakpoint, make the app scroll at the document level (so the browser address bar hides) with a pinned top bar and fixed bottom tab bar, and de-emphasize/condense the mobile dashboard — desktop unchanged.

**Architecture:** Pure responsive Tailwind classes (no JS breakpoint branch in the shell → no hydration flash); gate every scroll/height constraint to `md:`, make the mobile top bar `sticky` and the tab bar `fixed`. The dashboard uses the existing `useIsMobile()` hook only for two numeric props CSS can't express (plank box size, goal-ring size). Two intents with **disjoint file sets** → one atomic commit each.

**Tech Stack:** React, TanStack Start (SSR), Tailwind CSS, shadcn sidebar primitives, `useIsMobile()` hook.

---

## File Structure

**Intent A — mobile native scroll** (shell + chrome):

- `apps/web/src/components/dashboard-layout/shell.tsx` — gate scroll/height to `md:`, mobile content bottom padding.
- `apps/web/src/components/dashboard-layout/mobile-top-bar.tsx` — `sticky top-0`.
- `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx` — `fixed` to viewport bottom.

**Intent B — dashboard declutter** (dashboard-home):

- `apps/web/src/routes/_dashboard/dashboard.tsx` — page section gap.
- `apps/web/src/components/dashboard-home/briefing-hero.tsx` — smaller headline + hero gap.
- `apps/web/src/components/dashboard-home/shelf-section.tsx` — shorter/narrower plank on mobile.
- `apps/web/src/components/dashboard-home/pulse-section.tsx` — tighter gaps + smaller goal ring on mobile.

The two intents share no files, so they can be implemented and committed in parallel and integrated conflict-free.

**Verification commands** (run from `apps/web`): `pnpm type-check`. The known worktree `routeTree.gen` noise (`createFileRoute("/...") not assignable to undefined`, one per route file at the `createFileRoute` call) is unrelated — only confirm no error references the _files this plan changes_.

---

## Task A: Mobile native document scroll

One cohesive intent — the shell relaxation and the two bar changes must land together (relaxing the shell without fixing the tab bar would let the bar scroll away). One commit.

**Files:**

- Modify: `apps/web/src/components/dashboard-layout/shell.tsx`
- Modify: `apps/web/src/components/dashboard-layout/mobile-top-bar.tsx`
- Modify: `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx`

- [ ] **Step 1: Relax the shell's scroll/height model to `md:` only**

In `apps/web/src/components/dashboard-layout/shell.tsx`, make these four exact replacements:

1. `SidebarProvider` open tag:

```tsx
<SidebarProvider className="h-svh flex-col overflow-hidden">
```

→

```tsx
<SidebarProvider className="flex-col md:h-svh md:overflow-hidden">
```

2. The sidebar/inset row:

```tsx
          <div className="flex min-h-0 flex-1">
```

→

```tsx
          <div className="flex flex-1 md:min-h-0">
```

3. `SidebarInset` className:

```tsx
            <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:mb-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0">
```

→

```tsx
            <SidebarInset className="md:min-h-0 md:overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:mb-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0">
```

4. The inner scroll `<div>`:

```tsx
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
```

→

```tsx
              <div className="flex-1 overflow-x-hidden md:min-h-0 md:overflow-y-auto md:[scrollbar-gutter:stable]">
```

- [ ] **Step 2: Give mobile content room to clear the (soon-to-be) fixed tab bar**

In the same file, in `ContentArea`, replace the first argument of the `cn(...)`:

```tsx
        "w-full px-4 pt-[18px] pb-8 md:p-6",
```

→

```tsx
        "w-full px-4 pt-[18px] pb-[calc(env(safe-area-inset-bottom)+76px)] md:p-6",
```

(`md:p-6` overrides the bottom padding at desktop, so desktop spacing is unchanged.)

- [ ] **Step 3: Pin the mobile top bar**

In `apps/web/src/components/dashboard-layout/mobile-top-bar.tsx`, the `<header>`:

```tsx
    <header className="shrink-0 border-b bg-card pt-[env(safe-area-inset-top)] md:hidden">
```

→

```tsx
    <header className="sticky top-0 z-30 shrink-0 border-b bg-card pt-[env(safe-area-inset-top)] md:hidden">
```

- [ ] **Step 4: Fix the mobile tab bar to the viewport bottom**

In `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx`, the `<nav>` (change the leading `relative` to `fixed inset-x-0 bottom-0`; keep everything else):

```tsx
className =
  "relative z-30 grid shrink-0 grid-cols-5 items-stretch overflow-visible border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden";
```

→

```tsx
className =
  "fixed inset-x-0 bottom-0 z-30 grid shrink-0 grid-cols-5 items-stretch overflow-visible border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden";
```

- [ ] **Step 5: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: no error references `shell.tsx`, `mobile-top-bar.tsx`, or `mobile-tab-bar.tsx`. (Class-only changes — there should be none. Ignore the pre-existing `routeTree.gen` route-path noise.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard-layout/shell.tsx apps/web/src/components/dashboard-layout/mobile-top-bar.tsx apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx
git commit -m "feat(web): mobile uses native document scroll so the address bar hides"
```

---

## Task B: Focus the mobile dashboard

One intent across four dashboard-home files (all mobile-only de-emphasis). One commit.

**Files:**

- Modify: `apps/web/src/routes/_dashboard/dashboard.tsx`
- Modify: `apps/web/src/components/dashboard-home/briefing-hero.tsx`
- Modify: `apps/web/src/components/dashboard-home/shelf-section.tsx`
- Modify: `apps/web/src/components/dashboard-home/pulse-section.tsx`

- [ ] **Step 1: Tighten the page section gap on mobile**

In `apps/web/src/routes/_dashboard/dashboard.tsx`:

```tsx
    <div className="flex w-full flex-col gap-8 md:gap-10">
```

→

```tsx
    <div className="flex w-full flex-col gap-6 md:gap-10">
```

- [ ] **Step 2: Shrink the hero headline + hero gap on mobile**

In `apps/web/src/components/dashboard-home/briefing-hero.tsx`:

2a. The `Headline` component's `<p>`:

```tsx
    <p className="font-heading max-w-[860px] text-2xl leading-[1.4] font-semibold tracking-tight text-pretty md:text-3xl">
```

→

```tsx
    <p className="font-heading max-w-[860px] text-xl leading-snug font-semibold tracking-tight text-pretty md:text-3xl md:leading-[1.4]">
```

2b. The loading-skeleton `<section>` (inside `if (loading)`):

```tsx
      <section className="flex flex-col gap-5">
```

→

```tsx
      <section className="flex flex-col gap-4 md:gap-5">
```

2c. The real `BriefingHero` `<section>` (the `return` near the end):

```tsx
    <section className="flex flex-col gap-5">
      <Headline
```

→

```tsx
    <section className="flex flex-col gap-4 md:gap-5">
      <Headline
```

- [ ] **Step 3: Shorter, narrower plank on mobile**

In `apps/web/src/components/dashboard-home/shelf-section.tsx`:

3a. Add the import near the other imports:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
```

3b. Add a mobile height array right after the existing `BOX_HEIGHTS` declaration:

```tsx
// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];
```

→

```tsx
// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];
// Shorter set for the cramped mobile dashboard (see sub-project ②).
const MOBILE_BOX_HEIGHTS = [118, 104, 124, 100, 114];
```

3c. Replace the whole `toPlankBox` function so it scales with `isMobile`:

```tsx
function toPlankBox(copy: OwnedCopy, index: number): PuzzlePlankBox {
  const cover = copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    height: cover ? undefined : BOX_HEIGHTS[index % BOX_HEIGHTS.length],
  };
}
```

→

```tsx
function toPlankBox(
  copy: OwnedCopy,
  index: number,
  isMobile: boolean,
): PuzzlePlankBox {
  const cover = copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  const heights = isMobile ? MOBILE_BOX_HEIGHTS : BOX_HEIGHTS;
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    // Narrower boxes on mobile; PuzzlePlank derives cover-box height from width,
    // so this shortens the whole shelf. Desktop keeps the component default (116).
    width: isMobile ? 92 : undefined,
    height: cover ? undefined : heights[index % heights.length],
  };
}
```

3d. In `ShelfSection`, add the hook call right after the translations line `const t = useTranslations("dashboard.shelf");`:

```tsx
const isMobile = useIsMobile();
```

3e. Update the plank usage (the non-empty branch) to pass `isMobile` and reduce mobile padding:

```tsx
<div className="min-w-0 overflow-x-auto px-2 pt-6 pb-5">
  <PuzzlePlank boxes={owned.slice(0, 5).map(toPlankBox)} />
</div>
```

→

```tsx
<div className="min-w-0 overflow-x-auto px-2 pt-3 pb-3 md:pt-6 md:pb-5">
  <PuzzlePlank
    boxes={owned.slice(0, 5).map((copy, i) => toPlankBox(copy, i, isMobile))}
  />
</div>
```

- [ ] **Step 4: Tighter pulse gaps + smaller goal ring on mobile**

In `apps/web/src/components/dashboard-home/pulse-section.tsx`:

4a. Add the import near the other imports:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
```

4b. Make `GoalRing` accept a `size` prop (default 148) and drive the container off it. Replace the function signature + the `const size = 148;` line + the container `<div>`:

```tsx
function GoalRing({ current, target }: { current: number; target: number }) {
  const t = useTranslations("dashboard.pulse.goals");
  const size = 148;
  const stroke = 13;
```

→

```tsx
function GoalRing({
  current,
  target,
  size = 148,
}: {
  current: number;
  target: number;
  size?: number;
}) {
  const t = useTranslations("dashboard.pulse.goals");
  const stroke = 13;
```

and the container div:

```tsx
    <div className="relative size-[148px] shrink-0">
```

→

```tsx
    <div className="relative shrink-0" style={{ width: size, height: size }}>
```

(The `r`, `c`, `mid` geometry already derive from `size`, so they need no change.)

4c. In `GoalsColumn`, add the hook after `const t = useTranslations("dashboard.pulse.goals");`:

```tsx
const isMobile = useIsMobile();
```

and pass the size to `GoalRing`:

```tsx
<Link href="/goals">
  <GoalRing
    current={primary.currentCompletions}
    target={primary.targetCompletions}
  />
</Link>
```

→

```tsx
<Link href="/goals">
  <GoalRing
    current={primary.currentCompletions}
    target={primary.targetCompletions}
    size={isMobile ? 116 : 148}
  />
</Link>
```

4d. Tighten the stacked gap on mobile in **both** grids. The `PulseSkeleton` grid:

```tsx
    <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      {Array.from({ length: 3 }).map((_, i) => (
```

→

```tsx
    <div className="grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      {Array.from({ length: 3 }).map((_, i) => (
```

and the `PulseSection` grid:

```tsx
    <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      <InMotionColumn exchanges={exchanges ?? []} />
```

→

```tsx
    <div className="grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      <InMotionColumn exchanges={exchanges ?? []} />
```

- [ ] **Step 5: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: no error references `dashboard.tsx`, `briefing-hero.tsx`, `shelf-section.tsx`, or `pulse-section.tsx`. (Ignore the pre-existing `routeTree.gen` route-path noise.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_dashboard/dashboard.tsx apps/web/src/components/dashboard-home/briefing-hero.tsx apps/web/src/components/dashboard-home/shelf-section.tsx apps/web/src/components/dashboard-home/pulse-section.tsx
git commit -m "feat(web): focus the mobile dashboard (smaller hero, plank, pulse)"
```

---

## Final verification (controller, after integrating both intents)

- [ ] **Type-check the integrated branch**

Run: `cd apps/web && pnpm type-check`
Expected: no errors referencing any file changed by this plan.

- [ ] **Format check (CI runs `format:check`)**

From repo root: `npx prettier --write` the seven changed files, then commit any formatting delta.

- [ ] **Manual / user verification (browser automation unavailable in this env)**

On a real phone (mobile ≤767px), authenticated dashboard:

- Scrolling moves the document and the browser address bar collapses; the app top bar stays pinned; the bottom tab bar stays fixed and never hides content behind it.
- Hero headline is smaller; the plank is shorter/narrower; the pulse columns are tighter with a smaller goal ring.

Desktop (≥768px): inset card + inner scroll under the glass head, and the original hero/plank/pulse sizes — all unchanged.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Intent A items 1–7 → Task A steps 1–4. Intent B items 1–6 → Task B steps 1–4. All spec requirements have a task.
- **Type consistency:** `toPlankBox(copy, index, isMobile)` — every call site updated (Step 3e). `GoalRing` gains optional `size?: number` (default 148) — the one call site passes it (Step 4c); the default keeps any other use safe.
- **Desktop safety:** every change is mobile-only (`md:`/`lg:` restores the current value, or `isMobile` ternaries default to the current value), so the desktop shell and dashboard are unchanged.
