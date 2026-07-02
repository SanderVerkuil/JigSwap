# TanStack Query migration — route all Convex reads/writes through the bridge (design)

**Date:** 2026-07-02
**Status:** approved design, pre-implementation
**Branch:** `refactor/tanstack-query-migration`, stacked on `feat/admin-redesign` (PR bases there;
auto-retargets to main when #33 merges).

## Problem

`router.tsx` wires the full `@convex-dev/react-query` integration (ConvexQueryClient queryFn/
hashFn + `connect()`), but only `lib/marketing-queries.ts` uses it. The other ~87 files use plain
`convex/react` hooks: live while mounted, but the subscription result is forgotten on unmount, so
every remount (tab switches, navigation) shows a loading flash. TanStack's cache keeps data for
`gcTime`, so remounts render instantly from cache while the re-established subscription keeps it
live — cache-and-invalidate semantics without manual invalidation.

## Conversion cookbook

| From (`convex/react`)                  | To                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `useQuery(fn, args)`                   | `useQuery(convexQuery(fn, args))` (`@tanstack/react-query`); read `.data`, loading = `.isPending` |
| `useQuery(fn, cond ? {} : "skip")`     | `useQuery(convexQuery(fn, cond ? {} : "skip"))` — native skip (verified in bridge typings)        |
| `useMutation(fn)`                      | `useMutation({ mutationFn: useConvexMutation(fn) })`                                              |
| `.withOptimisticUpdate(...)` (3 files) | `useConvexMutation(fn).withOptimisticUpdate(...)` as the mutationFn (existing messaging pattern)  |
| `useAction(fn)`                        | `useMutation({ mutationFn: useConvexAction(fn) })`                                                |

**Busy-state rule (owner decision):** ALL manual busy flags (`busy`, `saving`, `isSubmitting`
useState around mutations) are removed in favor of `isPending`. Each distinct action gets its own
`useMutation` object; where a shared disable is genuinely wanted (e.g. the moderation console
disabling all actions during any decision), compose it: `const busy = approve.isPending ||
reject.isPending || ...`. No new shared flags.

**Sanctioned exceptions (stay on `convex/react`, one-line comment each):**
`usePaginatedQuery` (2 files — no bridge equivalent), `useConvexAuth` (4 files — auth state),
raw `useConvex` client (1 file), and the `Authenticated`/`Unauthenticated` auth-state components
(marketing header).

**Cache posture:** foundation task reads the installed bridge README and locks the recommended
`staleTime`/`gcTime` defaults in `router.tsx` (subscription-backed queryFn; unmounted data kept
for gcTime so remounts are instant).

## Execution architecture (user-opted multi-agent)

1. **Foundation (sequential subagent):** verify bridge capabilities against installed typings/
   README; set router defaults; convert two exemplars (one query-heavy file, one
   optimistic-mutation file); full verify; the cookbook is then FROZEN — fan-out agents follow
   it verbatim.
2. **Workflow fan-out:** remaining files partitioned into ~8 disjoint-directory batches; parallel
   agents convert per cookbook, editing the shared checkout WITHOUT committing (disjoint file
   lists; single committer). Each agent returns changed files + any site it could not convert
   mechanically (escalation list, not improvisation).
3. **Wrap-up (sequential):** full 5-project verify + fix loop; adversarial completeness check
   (grep: zero `useQuery|useMutation|useAction` imports from `convex/react` outside the
   documented exceptions; zero remaining manual busy flags around mutations); final review; one
   commit; stacked PR.

## Testing / verification

Behavior-preserving refactor: no UI, i18n, or backend changes. Full
`type-check`/`lint`/`test`/`arch-check` across the 5 projects (`--skip-nx-cache`). Existing web
tests (91) must stay green; pure-helper tests are unaffected. Loading-state call sites that
checked `x === undefined` are adjusted to `.isPending`/`.data` with identical rendering.

## Out of scope

Route-loader prefetching (`ensureQueryData`) — a natural follow-up once call sites are on the
bridge; pagination migration; any behavioral change.
