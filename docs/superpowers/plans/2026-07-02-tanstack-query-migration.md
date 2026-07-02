# TanStack Query Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 3 is executed with the Workflow tool per the user's explicit multi-agent opt-in.

**Goal:** Route every Convex read/write in apps/web through `@convex-dev/react-query` per the frozen cookbook in `docs/superpowers/specs/2026-07-02-tanstack-query-migration-design.md`; kill all manual busy flags in favor of `isPending`.

**Architecture:** Behavior-preserving refactor. Foundation locks the recipe on two exemplars; a Workflow fan-out applies it across disjoint file batches; a sequential wrap-up proves completeness adversarially.

**Tech Stack:** @tanstack/react-query 5, @convex-dev/react-query 0.1, TanStack Start.

**Branch:** `refactor/tanstack-query-migration` (stacked on `feat/admin-redesign`; spec committed).

---

### Task 0: Branch check

- [ ] `git fetch origin && git log origin/feat/admin-redesign --oneline -1` — if feat/admin-redesign moved, rebase this branch onto it. Working tree clean.

### Task 1: Foundation — router defaults + two exemplars (sequential subagent)

**Files:** Modify `apps/web/src/router.tsx`; Convert `apps/web/src/components/admin/moderation/activity-log.tsx` (query-heavy exemplar) and `apps/web/src/hooks/use-favorites.ts` (optimistic-mutation exemplar); consumers of use-favorites adjust if its return shape changes (it should NOT — keep the hook's public API identical).

- [ ] **1.1:** Read the installed bridge README (`node_modules/.pnpm/@convex-dev+react-query*/node_modules/@convex-dev/react-query/README.md`) and typings. Apply its recommended query defaults to `router.tsx`'s `QueryClient` (expected: long/Infinity `staleTime` because the subscription-backed queryFn keeps data fresh; keep default `gcTime` unless the README says otherwise). Comment each default with WHY.
- [ ] **1.2:** Convert `activity-log.tsx`: `useQuery` from `@tanstack/react-query` + `convexQuery(gateway.admin.getModerationActivity, {})`; `activity === undefined` loading check becomes `isPending`; `.data` destructured. Rendering identical.
- [ ] **1.3:** Convert `use-favorites.ts`: `useConvexMutation(...).withOptimisticUpdate(...)` as mutationFn inside `useMutation`; queries via `convexQuery` incl. any "skip"; the hook's exported API (names/shapes) unchanged — verify its consumers compile untouched.
- [ ] **1.4:** `pnpm nx run-many -t type-check lint test -p @jigswap/web --skip-nx-cache` green. Prettier. Commit: `refactor(web): tanstack-query foundation — router defaults + exemplar conversions`.
- [ ] **1.5:** Report any cookbook adjustment discovered (e.g. exact skip typing quirks); the controller amends the spec's cookbook if needed. After this, the cookbook is FROZEN.

### Task 2: Batch inventory (controller, inline)

- [ ] **2.1:** Generate the worklist: `grep -rln 'from "convex/react"' apps/web/src` minus the sanctioned exceptions (`usePaginatedQuery` files: `components/puzzles/puzzle-client.tsx`?, verify; `useConvexAuth`-only files; the raw `useConvex` file) minus Task 1's exemplars. For files mixing sanctioned + migratable hooks: they're IN the worklist (convert the migratable hooks, keep the exception with its comment).
- [ ] **2.2:** Partition into batches of ≤8 files grouped by directory. Save as JSON for the workflow args.

### Task 3: Workflow fan-out (Workflow tool — user opt-in)

- [ ] **3.1:** Run a workflow: one agent per batch (parallel, shared checkout, NO commits, disjoint files). Each agent prompt contains: the frozen cookbook table verbatim (from the spec, plus any Task-1 amendment), the busy-state rule, the exceptions rule, its exact file list, and instructions to (a) convert every `convex/react` hook usage per cookbook, (b) replace manual busy flags with per-action `isPending` (compose ORs only where a shared disable exists today), (c) run prettier on each file, (d) NOT run nx (racy in parallel), (e) return per file: converted hook count, busy flags removed, any site it could NOT convert mechanically (escalate, don't improvise).
- [ ] **3.2:** Collect reports; controller triages escalated sites (fix inline or dispatch a focused fixer).

### Task 4: Wrap-up verification (sequential)

- [ ] **4.1:** Full `pnpm nx run-many -t type-check lint test arch-check -p @jigswap/backend @jigswap/domain @jigswap/gateway @jigswap/web @jigswap/contracts --skip-nx-cache`. Fix loop until green (type errors from missed call-site shape changes are expected here — fix them per cookbook).
- [ ] **4.2:** Adversarial completeness check (script): every `from "convex/react"` import in apps/web/src names ONLY sanctioned hooks (`usePaginatedQuery`, `useConvexAuth`, `useConvex`) and carries the exception comment; zero `useState` busy/saving flags whose only writes bracket a mutation call (grep candidates `busy|saving|isSubmitting` and inspect each); zero `"skip"` passed to convex/react useQuery (all skips now inside convexQuery).
- [ ] **4.3:** Commit: `refactor(web): migrate all Convex call sites to the tanstack-query bridge`.

### Task 5: Review + PR

- [ ] **5.1:** Dispatch one review subagent over the full branch diff: cookbook conformance sampling (≥10 random files), the 3 optimistic-update files traced end-to-end, busy→isPending correctness (no lost disable states), exceptions documented, no behavior drift (spot-render logic).
- [ ] **5.2:** Fix loop; push `-u`; `gh pr create` with base `feat/admin-redesign`, title `refactor(web): route all Convex data access through TanStack Query`; body: spec link, counts (files/hooks/busy-flags), the remount-caching win, exceptions list, note it auto-retargets to main when #33 merges. Claude Code footer.

## Self-review notes

- Cookbook lives in the spec (single source); plan references, never restates beyond Task 3's prompt requirement.
- Parallel-safety: agents share a checkout but disjoint files, no commits, no nx runs — single committer in Task 4.
- Risk: call sites reading `undefined`-as-loading are the main breakage class; Task 4.1 owns it explicitly.
