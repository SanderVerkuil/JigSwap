# Admin users page, admin puzzle-definitions page, and confirm-dialog migration

**Date:** 2026-07-08
**Status:** Approved
**Delivery:** three sequential branches/PRs, in the order below.

## Goals

1. Replace the raw browser `confirm()` calls with the internal shadcn `AlertDialog` pattern.
2. Add an admin page listing all users, including an admin-role column.
3. Add an admin page listing all puzzle definitions with admin metadata (created date,
   distinct-owner count) and a reversible disable/re-enable action, audit-logged, following
   the existing hexagonal architecture.

Non-goals: user management actions (deactivate, promote), wiring the collections delete
affordance, any change to how authorization works (`isAdmin` stays JWT-only).

## PR 1 — Replace raw `confirm()` with AlertDialog

Exactly two call sites exist, both destructive deletes using `if (confirm(t("deleteConfirm")))`:

- `apps/web/src/routes/_dashboard/my-puzzles/index.tsx:190` (`handleDeletePuzzle`, deletes an
  owned copy via `deletePuzzle.mutateAsync({ copyId })`).
- `apps/web/src/routes/_dashboard/collections/index.tsx:127` (`handleDeleteCollection`,
  currently unwired — "delete affordance in a follow-up").

Per decision, **no shared wrapper component**. Each site gets the controlled-AlertDialog
pattern already established in `apps/web/src/components/admin/category-list.tsx`:

- `const [confirming, setConfirming] = useState<Target | null>(null)` holds the row awaiting
  confirmation; the delete affordance sets it instead of mutating directly.
- `<AlertDialog open={confirming !== null} onOpenChange={...}>` with `AlertDialogTitle`,
  `AlertDialogDescription`, `AlertDialogCancel`, and a destructive-styled
  `AlertDialogAction` (`buttonVariants({ variant: "destructive" })`) that runs the mutation.

For collections the handler is converted to this pattern but the missing delete button is
NOT added (out of scope; the existing eslint-disable/unused marker stays in whatever form
still applies).

i18n: replace the single `deleteConfirm` message key with title/body keys (plus confirm
label where needed) in both en and nl locales.

**Verification:** typecheck + lint; drive the my-puzzles delete flow in the app (dialog
appears, cancel aborts, confirm deletes).

## PR 2 — Admin users page (`/admin/users`)

### Role mirroring (schema + webhook)

Adminship lives only in the Clerk JWT (`publicMetadata.role`, read by
`packages/backend/convex/identity/isAdmin.ts`). For a display-only role column:

- Add `role: v.optional(v.string())` to the `users` table in
  `packages/backend/convex/schema.ts`.
- Mirror it in the existing Clerk webhook sync: `users.updateOrCreateUser` writes
  `role: clerkUser.public_metadata?.role` on both insert and patch. Clerk emits
  `user.updated` when metadata changes, so the mirror stays current.
- One-shot backfill: an internal Convex action (pattern: `backfillSearchableName`) pages
  users via the Clerk Backend API (`@clerk/backend` is already a dependency;
  `CLERK_SECRET_KEY` is already in the deployment env) and patches `role` onto existing
  rows. Run once from the dashboard/CLI after deploy.
- **Authorization is untouched**: `isAdmin` keeps reading the JWT. The mirrored field is
  display-only and must never be used as an authz source.

### Backend read model

New `packages/backend/convex/admin/listUsers.ts` query:

- Gate: `await requireMember(ctx)` + `if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden")`
  (the established admin gate).
- Paginated (`ctx.db.query("users").paginate(...)`); optional `search` arg switches to the
  existing `by_searchable_name` search index.
- Returns per user: name, username, email, avatar URL, `createdAt`, `isActive`, `role`,
  and owned-copy count (indexed lookup per row on `ownedPuzzles.by_owner`).
- Wired into the gateway `admin` namespace (`packages/gateway/src/operations.ts`); the
  returned row shape is a typed view DTO in `packages/contracts`, matching the existing
  view-DTO precedent for read models.
- Admin read models stay thin Convex queries (precedent: `getModerationActivity`,
  `getModerationStats`) — no domain-package involvement for pure reads.

### Frontend

- New route `apps/web/src/routes/_dashboard/admin/users.tsx` inside the existing admin gate
  layout; nav entry `adminUsers` added to `ADMIN_GROUP` and `ROUTE_META` in
  `components/dashboard-layout/route-meta.ts`.
- Table: avatar+name, username, email, joined date, active flag, admin badge when
  `role === "admin"`, owned-copy count. Search input; load-more pagination via
  `usePaginatedQuery` (sanctioned exception to the TanStack Query bridge).
- Read-only: no actions in v1.

**Verification:** backend `.test.ts` for `listUsers` (gate + pagination + search + role
field); typecheck; drive the page as an admin user.

## PR 3 — Admin puzzle-definitions page (`/admin/puzzles`) with reversible disable

### Domain (`packages/domain/src/catalog`)

- `domain/approval.ts`: extend `ApprovalStatus` with `"disabled"`. Transition table:
  `pending → [approved, rejected]` (unchanged), `approved → [disabled]`,
  `disabled → [approved]`, `rejected → []`.
- `domain/events.ts`: new `PuzzleDefinitionDisabled` and `PuzzleDefinitionReenabled` events
  (no actor on the event — actor is stamped at the composition root, same as
  approve/reject).
- `domain/puzzle-definition.ts`: `disable()` / `reenable()` methods guarded by the
  transition table, recording the new events; invalid transitions raise the existing
  domain error type used by `approve()`/`reject()`.
- `application/ports/in`: disable/re-enable inbound port (mirroring
  `moderate-puzzle-definition.port.ts`, command `{ puzzleDefinitionId }`).
- `application/use-cases`: `disable-puzzle-definition.ts` / `reenable-puzzle-definition.ts`
  via the shared `run-definition-action.ts` wrapper.
- Colocated `.spec.ts` domain tests for the new transitions (including invalid ones:
  disable from pending/rejected, re-enable from approved).

### Backend (Convex composition root)

- `schema.ts`: `puzzles.status` union gains `"disabled"`; `moderationActions.kind` union
  gains `definition_disabled` and `definition_reenabled`.
- New mutations `catalog/disablePuzzleDefinition.ts` / `catalog/reenablePuzzleDefinition.ts`:
  admin gate → `runDefinitionAction` (repository + event publisher + clock) →
  `stampModerationAction` with the new kinds. Audit is doubly preserved: the
  `moderationActions` row and the `domainEvents` outbox row; disable only flips status,
  nothing is deleted.
- New admin-gated paginated query (`admin/listPuzzleDefinitions.ts`) over **all**
  definitions regardless of status: title, brand, pieceCount, status, `createdAt`,
  submitter name, thumbnail URL, and distinct-owner count (existing pattern:
  `ownedPuzzles.withIndex("by_puzzle", ...)` → dedupe `ownerId`, as in
  `library/getPuzzleDefinitionView.ts:132`).
- Gateway: the list query joins the `admin` namespace (next to `getModerationActivity`);
  the disable/re-enable mutations join the `catalog` namespace (next to `approve`/`reject`).
- **Visibility invariants to verify during implementation** (expected to fall out of
  existing filters, but must be checked and covered by tests):
  - public browse/search only surfaces `status === "approved"` → disabled definitions
    disappear automatically;
  - the library ACL (`CatalogSnapshotProvider.getAcquisitionContext`) only authorizes
    acquisition for approved definitions (or the submitter's own pending) → new
    acquisitions of disabled definitions are blocked;
  - existing owned copies are unaffected (they render from their cached `snapshot`).

### Frontend

- New route `apps/web/src/routes/_dashboard/admin/puzzles.tsx`; nav entry `adminPuzzles` in
  `ADMIN_GROUP` + `ROUTE_META`.
- Table: thumbnail, title/brand/piece count, status badge (pending/approved/rejected/
  disabled), created date, owner count, submitter. Row actions: Disable (on approved) /
  Re-enable (on disabled), each behind an inline AlertDialog confirm (PR 1 pattern).
- The existing moderation Activity Log surfaces the new audit kinds; add label
  translations for `definition_disabled` / `definition_reenabled` (en + nl).

**Verification:** domain `.spec.ts` for the state machine; backend `.test.ts` for the
mutations (gate, audit stamp, status flip, invalid-transition rejection) and the list
query (owner counts); typecheck; drive the disable → hidden-from-browse → re-enable flow.

## Error handling

- All new admin functions fail closed: unauthenticated or non-admin → `ConvexError("Forbidden")`
  (existing gate semantics).
- Invalid lifecycle transitions surface as the catalog domain error and map to the existing
  error translation the moderation console already uses for approve/reject failures.

## Testing conventions

Per repo convention: domain tests are colocated `.spec.ts` in `packages/domain`; backend
tests are `.test.ts` at the `packages/backend/convex/` root; CI runs prettier
`format:check` first (format changed files before committing) and nx should be run with
`--skip-nx-cache` when mirroring CI.
