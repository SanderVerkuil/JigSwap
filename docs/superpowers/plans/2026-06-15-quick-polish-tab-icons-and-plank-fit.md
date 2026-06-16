# Quick Polish — Mobile Tab Icons + Landing Plank Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the mobile bottom tab bar as icons-only, and make the over-wide landing-page `JigPlank` previews scale down to fit narrow viewports so the page no longer scrolls horizontally.

**Architecture:** A new `FitToWidth` wrapper scales a fixed-size child down to fit its container (computed by a pure, unit-tested `fitScale` helper) and collapses its layout height so no gap remains. The two un-clipped marketing plank previews are wrapped in it, with a defensive `overflow-x-clip` on the marketing root. The tab-bar change drops the label `<span>` and moves the label to an `aria-label`.

**Tech Stack:** React, TanStack Router, Tailwind CSS, Vitest (pure-logic unit tests, the repo convention — no DOM testing library), lucide-react icons.

---

## File Structure

- `apps/web/src/components/marketing/fit-to-width.tsx` — **new.** Exports `fitScale` (pure) and `FitToWidth` (component). Single responsibility: scale a fixed-size child down to fit its container width.
- `apps/web/src/components/marketing/fit-to-width.test.ts` — **new.** Unit tests for `fitScale`.
- `apps/web/src/components/marketing/home/feature-rows.tsx` — **modify.** Wrap the "library" `JigPlank` preview in `FitToWidth`.
- `apps/web/src/routes/_public/about.tsx` — **modify.** Wrap the mission `JigPlank` preview in `FitToWidth`.
- `apps/web/src/routes/index.tsx` — **modify.** Add `overflow-x-clip` to the marketing root.
- `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx` — **modify.** `TabLink`: drop the label span, add `aria-label`.

---

## Task 1: `fitScale` pure helper + tests

**Files:**

- Create: `apps/web/src/components/marketing/fit-to-width.tsx`
- Test: `apps/web/src/components/marketing/fit-to-width.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/marketing/fit-to-width.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitScale } from "./fit-to-width";

describe("fitScale", () => {
  it("scales down when the child is wider than the container", () => {
    expect(fitScale(360, 500)).toBeCloseTo(0.72, 5);
  });

  it("never scales up past 1 when the container is wider", () => {
    expect(fitScale(800, 500)).toBe(1);
  });

  it("returns 1 when widths are equal", () => {
    expect(fitScale(500, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured container width", () => {
    expect(fitScale(0, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured natural width", () => {
    expect(fitScale(360, 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jigswap/web exec vitest run src/components/marketing/fit-to-width.test.ts`
Expected: FAIL — cannot resolve `./fit-to-width` (module/export does not exist yet).

> If `pnpm --filter @jigswap/web` is not the right invocation in this repo, run from `apps/web`: `cd apps/web && pnpm vitest run src/components/marketing/fit-to-width.test.ts`. The package script is `"test": "vitest run"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/components/marketing/fit-to-width.tsx` with only the helper for now:

```tsx
"use client";

import * as React from "react";

/**
 * Largest scale ≤ 1 that fits a child of `naturalWidth` into `containerWidth`.
 * Only ever scales DOWN — equal/larger containers return 1 (render untouched).
 * Returns 1 for non-positive inputs (pre-measurement / unmeasured elements).
 */
export function fitScale(containerWidth: number, naturalWidth: number): number {
  if (containerWidth <= 0 || naturalWidth <= 0) return 1;
  return Math.min(1, containerWidth / naturalWidth);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run src/components/marketing/fit-to-width.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/marketing/fit-to-width.tsx apps/web/src/components/marketing/fit-to-width.test.ts
git commit -m "feat(web): add fitScale helper for scaling previews to fit width"
```

---

## Task 2: `FitToWidth` component

**Files:**

- Modify: `apps/web/src/components/marketing/fit-to-width.tsx`

No unit test: this is DOM wiring (ResizeObserver + layout measurement), which the repo does not unit-test (existing web tests are pure-logic only). Verified manually in Task 3.

- [ ] **Step 1: Append the component to `fit-to-width.tsx`**

Add below `fitScale` in `apps/web/src/components/marketing/fit-to-width.tsx`:

```tsx
/**
 * Scales a fixed-size child DOWN to fit the width of this wrapper, and collapses
 * the wrapper's rendered height to the scaled height so the shrunk child leaves
 * no layout gap. `overflow: hidden` contains the child's un-transformed layout
 * box (a CSS transform shrinks paint, not layout) so it can't widen the page.
 *
 * Used for the marketing JigPlank previews, which are intrinsically wider than a
 * phone viewport. At widths ≥ the child's natural width, scale is 1 (untouched).
 */
export function FitToWidth({ children }: { children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [scaledHeight, setScaledHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const outerEl = outer.current;
    const innerEl = inner.current;
    if (!outerEl || !innerEl) return;

    const measure = () => {
      // offsetWidth/Height report the UN-transformed layout box, so they give the
      // child's natural size even while our scale transform is applied.
      const next = fitScale(outerEl.clientWidth, innerEl.offsetWidth);
      setScale(next);
      setScaledHeight(innerEl.offsetHeight * next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outerEl);
    ro.observe(innerEl); // child can resize after images load (JigPlank re-measures)
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      style={{
        width: "100%",
        height: scaledHeight ?? undefined,
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        ref={inner}
        style={{
          flex: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: PASS (no new errors in `fit-to-width.tsx`). Pre-existing `routeTree.gen` noise, if any, is unrelated — confirm no error references `fit-to-width.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/marketing/fit-to-width.tsx
git commit -m "feat(web): add FitToWidth wrapper that scales previews to fit"
```

---

## Task 3: Wire `FitToWidth` into the marketing planks + overflow safety net

**Files:**

- Modify: `apps/web/src/components/marketing/home/feature-rows.tsx`
- Modify: `apps/web/src/routes/_public/about.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 1: Wrap the feature-row library plank**

In `apps/web/src/components/marketing/home/feature-rows.tsx`:

Add the import (alongside the existing imports):

```tsx
import { FitToWidth } from "@/components/marketing/fit-to-width";
```

Then wrap the `JigPlank` in the `library` row's `visual`. Change:

```tsx
      visual: (
        <JigPlank
          depth={16}
          boxes={[
```

to:

```tsx
      visual: (
        <FitToWidth>
          <JigPlank
            depth={16}
            boxes={[
```

and the matching close — change:

```tsx
          ]}
        />
      ),
    },
```

to:

```tsx
            ]}
          />
        </FitToWidth>
      ),
    },
```

(Only the `library` row's `JigPlank` is wrapped — `LendTrackVisual` and `FilterVisual` already fit on mobile.)

- [ ] **Step 2: Wrap the about-page mission plank**

In `apps/web/src/routes/_public/about.tsx`:

Add the import:

```tsx
import { FitToWidth } from "@/components/marketing/fit-to-width";
```

Wrap the `JigPlank` that sits inside the drop-shadow div. Change:

```tsx
              <div className="[filter:drop-shadow(0_24px_36px_rgb(40_30_80_/_.16))]">
                <JigPlank
                  depth={16}
                  boxes={[
```

to:

```tsx
              <div className="[filter:drop-shadow(0_24px_36px_rgb(40_30_80_/_.16))]">
                <FitToWidth>
                  <JigPlank
                    depth={16}
                    boxes={[
```

and close the `FitToWidth` right after the `JigPlank` closes (before the `</div>` that closes the drop-shadow wrapper). Locate the `JigPlank`'s closing `/>` and its surrounding `</div>`; insert `</FitToWidth>` between them so the structure is `<div drop-shadow><FitToWidth><JigPlank .../></FitToWidth></div>`.

- [ ] **Step 3: Add the marketing-root overflow safety net**

In `apps/web/src/routes/index.tsx`, change:

```tsx
    <div className="mk-root font-mk-sans min-h-screen">
```

to:

```tsx
    <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: PASS — no errors referencing `feature-rows.tsx`, `about.tsx`, or `index.tsx`.

- [ ] **Step 5: Manual verification (landing page)**

Run the dev server: `cd apps/web && pnpm dev`. In the browser devtools, set viewport width to 360px and open `/`:

- Expected: **no horizontal scrollbar**; the feature-row "library" plank and the about-page plank visibly shrink to fit the column width.
- Resize the viewport wider (≥ ~900px): expected the planks render at natural size (scale 1), unchanged from before.

If a horizontal scrollbar remains, identify the overflowing element in devtools (Elements → toggle the scroll), and confirm whether it is another plank instance (wrap it in `FitToWidth`) or a different element (out of scope for this plan — note it for sub-project ②).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/marketing/home/feature-rows.tsx apps/web/src/routes/_public/about.tsx apps/web/src/routes/index.tsx
git commit -m "fix(web): scale landing plank previews to fit, stop horizontal scroll"
```

---

## Task 4: Mobile tab bar — icons only

**Files:**

- Modify: `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx` (`TabLink`)

- [ ] **Step 1: Replace the `TabLink` return**

In `apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx`, replace the entire `return (...)` block of the `TabLink` function. Change:

```tsx
return (
  <Link
    href={tab.href}
    aria-current={on ? "page" : undefined}
    className={cn(
      "flex min-h-14 flex-col items-center justify-center gap-[3px] pt-[7px] pb-1.5",
      on ? "text-jigsaw-primary" : "text-muted-foreground",
    )}
  >
    <span className="relative">
      <tab.icon className="size-[21px]" />
      {badge > 0 && (
        <span className="bg-jigsaw-primary-accent absolute -top-1 -right-2 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </span>
    <span
      className={cn(
        "text-[10.5px] tracking-[0.01em]",
        on ? "font-bold" : "font-medium",
      )}
    >
      {t(`tabs.${tab.key}`)}
    </span>
  </Link>
);
```

to:

```tsx
return (
  <Link
    href={tab.href}
    aria-label={t(`tabs.${tab.key}`)}
    aria-current={on ? "page" : undefined}
    className={cn(
      "flex min-h-14 flex-col items-center justify-center",
      on ? "text-jigsaw-primary" : "text-muted-foreground",
    )}
  >
    <span className="relative">
      <tab.icon className="size-[21px]" />
      {badge > 0 && (
        <span className="bg-jigsaw-primary-accent absolute -top-1 -right-2 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </span>
  </Link>
);
```

(The label text moves from a visible `<span>` to the `Link`'s `aria-label`; the `t` import/usage stays, so nothing becomes unused. The icon stays centered via `min-h-14 flex-col ... justify-center`.)

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: PASS — no error referencing `mobile-tab-bar.tsx`.

- [ ] **Step 3: Manual verification (mobile tab bar)**

With `pnpm dev` running and the viewport at 360px, open `/dashboard`:

- Expected: bottom tab bar shows **icons only** — no "Home / Bibliotheek / Ruilen / Community" text. The center "+" still overlaps the bar correctly; the unread/pending badge still appears on Swaps.
- Inspect a tab `Link` in devtools: expected `aria-label` equals the localized tab name, and the active tab still has `aria-current="page"`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx
git commit -m "feat(web): mobile tab bar shows icons only (label moves to aria-label)"
```

---

## Final verification

- [ ] **Run the web test suite**

Run: `cd apps/web && pnpm test`
Expected: PASS, including the new `fit-to-width.test.ts`.

- [ ] **Format check (CI runs `format:check` first)**

Run prettier on the changed files before the final state, e.g. from repo root:
`npx prettier --write apps/web/src/components/marketing/fit-to-width.tsx apps/web/src/components/marketing/fit-to-width.test.ts apps/web/src/components/marketing/home/feature-rows.tsx apps/web/src/routes/_public/about.tsx apps/web/src/routes/index.tsx apps/web/src/components/dashboard-layout/mobile-tab-bar.tsx`
Then commit any formatting changes.

- [ ] **Type-check the package once more**

Run: `cd apps/web && pnpm type-check`
Expected: no errors referencing any file changed in this plan.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Item 2 → Task 4. Item 5 → Tasks 1–3 (`fitScale` + `FitToWidth` + wiring + safety net). Both spec items are covered.
- **Why `overflow: hidden` on the `FitToWidth` outer:** a CSS `transform: scale()` shrinks only paint, not the layout box, so the un-scaled child would still widen the page; `overflow: hidden` contains it while the scaled content remains fully visible (`transform-origin: top center` anchors it).
- **No scale-up:** `fitScale` clamps to `≤ 1`, so desktop rendering is unchanged.
