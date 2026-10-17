# My-Puzzles In-Progress Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PuzzleCard` shows an "In progress" indicator (cover overlay chip AND context-row badge) when `solveInProgress` is true.

**Architecture:** One file: `apps/web/src/components/ui/puzzle-card.tsx`. Reuses the existing `solveInProgress` prop, the loan-badge cover-overlay pattern already in the file, the context-`badges` block, the `Clock` lucide icon, and the existing `solving.completions.inProgress` locale key ×3 (already present — no locale edits). Spec: `docs/superpowers/specs/2026-07-27-my-puzzles-in-progress-indicator-design.md`.

---

### Task 1: PuzzleCard indicator

**Files:**

- Modify: `apps/web/src/components/ui/puzzle-card.tsx`

- [ ] **Step 1: Read the file's existing patterns**

Read `puzzle-card.tsx` fully first. Locate: (a) the cover-overlay area where `loanBadge` renders (comment ~line 97 "Rendered as a cover overlay so it sits above the stretched-link (z-10)") and the shared corner-chip styling comment (~line 100); (b) the context-`badges` block (~lines 311-338, condition/availability/owner badges); (c) how the component gets translations (which `useTranslations` namespaces are in scope — the in-progress label needs `useTranslations("solving.completions")`, add it if absent as e.g. `tCompletions`).

- [ ] **Step 2: Implement both placements**

1. **Overlay chip**: where `loanBadge` renders (or immediately beside it), when `solveInProgress` is true render a small chip following the same overlay/z-index idiom as the loan badge — `Clock` icon (h-3 w-3) + `tCompletions("inProgress")` text, styled consistently with the existing corner/overlay chips (mirror the loan badge's classes; if the loan badge is a caller-supplied ReactNode, place the new chip in the same positioned container with the same styling classes). Both may appear together (a borrowed copy being solved) — stack them without overlap (e.g. flex gap in the shared container).
2. **Context badge**: in the `badges` block, append when `solveInProgress`:

```tsx
{
  solveInProgress && (
    <Badge variant="secondary" className="text-xs">
      <Clock className="mr-1 h-3 w-3" />
      {tCompletions("inProgress")}
    </Badge>
  );
}
```

(match the sibling badges' exact variant/classes — read them first; `Clock` import from lucide-react, add if absent.)

The boolean is already threaded (`solveInProgress` prop, default false) — do NOT change the prop or any call site.

- [ ] **Step 3: Verify**

`cd apps/web && npx tsc --noEmit` (no new errors); `npx nx run @jigswap/web:lint --skip-nx-cache` from repo root (no new errors); `cd apps/web && npx vitest run src/components/social/activity-feed-meta.test.ts` (3 green, guards nothing broke transitively).

- [ ] **Step 4: Commit + push**

```bash
pnpm prettier --write apps/web/src/components/ui/puzzle-card.tsx
git add apps/web
git commit -m "feat(web): in-progress indicator on my-puzzles cards" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin feat/in-progress-solves
```

Then `gh pr view 66 --json mergeable,mergeStateStatus` — report values.
