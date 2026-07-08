# Admin user detail view (second addendum to the admin users page)

**Date:** 2026-07-08
**Status:** Approved
**Delivery:** amends PR #38 (`feat/admin-users-page`), on top of
`2026-07-08-admin-user-role-management-design.md`.

## Goal

From `/admin/users`, an admin can open a per-user detail page showing everything the
backend knows that is admin-relevant: full profile, library/activity stats, their catalog
submissions, their moderation/audit trail, and the role-management action.

## Route & navigation

- New route `/admin/users/$userId` (TanStack file route under
  `apps/web/src/routes/_dashboard/admin/`; exact filename follows the repo's existing
  dynamic-route convention — verify against an existing `$param` route).
- Reached by clicking a row (or a per-row "view" affordance) in the `/admin/users` table.
- Renders inside the existing admin gate layout; the read model re-gates server-side.
- Page title/shell meta: follow whatever the codebase's existing dynamic routes do with
  `ROUTE_META` (path-keyed) — a static "User details" title is acceptable for v1.

## Backend read model

New admin-gated query `admin/getUserDetail.ts` (gate: `requireMember` + JWT `isAdmin`,
`ConvexError("Forbidden")`), arg `userId: Id<"users">`, returning a typed
`AdminUserDetailView` DTO in `packages/contracts` with four sections:

1. **Profile** — every `users` field an admin may need: name, username, email, avatar,
   bio, location, preferredLanguage, isActive, role (display mirror), clerkId, createdAt,
   updatedAt.
2. **Stats** —
   - owned copies: total plus availability breakdown (forTrade / forSale / forLend) via
     `ownedPuzzles.by_owner`;
   - collections count (owner index on the collections table — verify actual table/index
     names in `schema.ts`);
   - completions/solves count if an owner/user index exists (verify; omit if it would
     need a table scan — do NOT add scan-based stats).
3. **Catalog submissions** — the user's submitted puzzle definitions via
   `puzzles.by_submitted_by`: title, status (pending/approved/rejected — plus disabled
   once PR 3 merges; the type should tolerate unknown statuses), createdAt. Newest first,
   capped (e.g. 50).
4. **Moderation & audit trail** — two indexed lists, newest first, capped (e.g. 20 each):
   - actions this user performed as admin: new index
     `moderationActions.by_actor ["actorId", "at"]`;
   - actions targeting this user (v1: the `role_granted`/`role_revoked` rows, whose
     `targetId` is the clerkId): new index `moderationActions.by_target ["targetId", "at"]`.
     Both indexes are additive schema changes; no backfill needed (Convex indexes existing
     rows automatically).

Gateway: `admin.getUserDetail` in the `admin` namespace.

## Frontend

- Profile header card (avatar, name, username, email, badges for active/role, clerkId in
  a muted monospace line, bio/location/language, joined + updated dates).
- Stats row (copies + availability breakdown, collections, solves if available).
- Submissions section: compact list with status badges; empty state.
- Audit section: two lists (performed / received), reusing the Activity Log's
  label-translation approach for kinds; empty states.
- Role management: the same Make/Remove-admin affordance from the role-management
  addendum, same AlertDialog confirm, same self-row hiding (no affordance when viewing
  yourself). Implementation should share the confirm/action wiring with the table page
  rather than duplicating it (a small shared component or hook is justified here — two
  real call sites).
- i18n: en + nl + source additions.

## Testing (TDD, convex-test)

- Gate: unauthenticated and non-admin rejected (including row-mirror-admin-but-no-JWT).
- Shape: profile fields present; stats counts correct against seeded copies (with
  availability variety), collections, submissions with mixed statuses.
- Audit: by_actor returns the user's performed actions newest-first; by_target returns
  role rows for their clerkId; caps respected.
- Unknown/missing user id → ConvexError (not a crash).

## Out of scope

- Editing profile fields, deactivating users, impersonation.
- Paginating the capped lists (caps are fine for v1).
- Content-moderation history of the user's photos beyond what the two new indexes give
  (no per-owner photo-moderation index exists; not worth adding in v1).
