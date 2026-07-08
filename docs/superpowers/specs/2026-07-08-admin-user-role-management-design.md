# Admin user role management (addendum to the admin users page)

**Date:** 2026-07-08
**Status:** Approved
**Delivery:** amends PR #38 (`feat/admin-users-page`); extends
`2026-07-08-admin-users-puzzles-and-confirm-dialogs-design.md` PR 2.

## Goal

Admins can grant and revoke roles on other users from `/admin/users`. Today the only
role is `"admin"`, but the write path is modeled generically. An admin can never change
their own role. Role changes are audit-logged.

## Decisions

- **Audit:** yes — `moderationActions` gains `role_granted` / `role_revoked` kinds,
  stamped with the acting admin, surfaced in the existing moderation Activity Log.
- **Demoting other admins:** allowed. Only self-changes are blocked (all of them, not
  just revokes: since a role set overwrites `publicMetadata.role`, letting an admin set
  any role on themselves would be an indirect self-demotion). The Clerk dashboard stays
  the escape hatch for edge cases (e.g. the last admin demoting themselves is impossible
  in-app by construction).
- **Source of truth unchanged:** the role lives in Clerk `publicMetadata.role`;
  authorization keeps reading the JWT via `identity/isAdmin`. `users.role` remains a
  display-only mirror.

## Backend

### Write path — `packages/backend/convex/admin/setUserRole.ts` (`"use node"` action)

Args: `{ userId: Id<"users">, role: v.union(v.literal("admin"), v.null()) }` — the union
is the role allowlist; future roles extend it. Flow:

1. `ctx.runQuery(internal.admin.setUserRoleGate...)` — an internal query that re-derives
   everything gate-relevant transactionally:
   - `requireMember` + JWT `isAdmin` (fails closed, `ConvexError("Forbidden")`);
   - loads the target user row (`ConvexError` if missing);
   - **self-guard**: if `target.clerkId === identity.subject`, throw
     `ConvexError("CannotChangeOwnRole")`;
   - returns `{ clerkId, name, actorId }` for the steps below.
2. Clerk write: `clerkClient.users.updateUserMetadata(clerkId, { publicMetadata: { role } })`
   (`null` deletes the key; `CLERK_SECRET_KEY` already in env). The target's active JWT
   updates on its next refresh — a brief window where their old claims still apply is
   accepted (Clerk tokens are short-lived).
3. `ctx.runMutation(internal.admin.applyRoleChange...)` — one internal mutation that
   atomically (a) patches the `users.role` mirror (patch with `undefined` clears it) and
   (b) stamps the audit row: `kind: role === null ? "role_revoked" : "role_granted"`,
   `actorId`, `targetLabel: name`, `targetId: clerkId`, `at: now`.

If the Clerk call throws, nothing is mirrored or stamped (steps run in order); the
action surfaces the error to the client. The webhook (`user.updated`) later reconciles
the mirror regardless, so step 3 is an optimistic fast-path, not a consistency
requirement.

### Schema

`moderationActions.kind` union gains `"role_granted" | "role_revoked"`. (Known overlap:
PR 3 extends the same union with `definition_disabled`/`definition_reenabled` — a small
expected merge conflict between the branches.)

`admin/getModerationStats.ts` must not mis-bucket the new kinds (same guard concern PR 3
handles for its kinds — verify the weekly KPI bucketing ignores role kinds).

### Gateway

`admin.setUserRole` wired as an **action** in the `admin` namespace. The web calls it via
the codebase's established action-call pattern (check how existing actions, e.g. the
catalog URL import, are invoked from the web and mirror that).

## Frontend (`/admin/users`)

- The role column (or a trailing actions cell) gains a per-row affordance:
  **Make admin** when `role !== "admin"`, **Remove admin** when `role === "admin"`.
- Both behind the established controlled AlertDialog confirm; revoke uses destructive
  styling.
- **No affordance on the caller's own row** (compare row `clerkId`/id against the current
  user via the existing identity data the shell already has). Server-side guard is the
  real enforcement; the UI just doesn't offer the foot-gun.
- The table is already reactive; the optimistic mirror patch updates the row without
  manual refresh. Disable the row's action while the call is pending.
- Activity Log: label translations for `role_granted` / `role_revoked` (en + nl +
  source).

## Testing (TDD, convex-test, `.test.ts` at convex root)

- Gate query: unauthenticated → rejected; member without JWT admin claim → Forbidden
  (even if their row mirror says "admin"); self-change → CannotChangeOwnRole; admin
  targeting another user → returns clerkId/name/actor.
- Apply mutation: grant patches mirror + stamps `role_granted` with actor and target
  label; revoke clears mirror + stamps `role_revoked`; rows are append-only additions to
  `moderationActions`.
- Activity log read model surfaces the new kinds; weekly stats bucketing unaffected.
- The action shell (Clerk network call) is not convex-testable — same accepted status as
  `backfillUserRoles`; verified by typecheck and on the preview deployment.

## Out of scope

- Roles other than `"admin"` in the UI (the write path already accepts a union).
- Self-service role changes, invitation flows, or role expiry.
- Reading `users.role` for any authorization decision.
