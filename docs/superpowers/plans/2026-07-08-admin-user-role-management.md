# Admin User Role Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved spec `docs/superpowers/specs/2026-07-08-admin-user-role-management-design.md`: admins grant/revoke roles on OTHER users from `/admin/users`. Today the only role is `"admin"`, but the write path is modeled generically (`role: "admin" | null` union = the allowlist). An admin can never change their own role (server-enforced self-guard; the UI additionally hides the affordance on the caller's own row). Every change is audit-logged as a `moderationActions` row (`role_granted` / `role_revoked`) and surfaced in the existing moderation Activity Log. **The role's source of truth stays Clerk `publicMetadata.role`; authorization keeps reading the JWT via `identity/isAdmin`; `users.role` remains a display-only mirror — no code path may read it for authz.**

**Architecture:** The write path is a `"use node"` public action `admin/setUserRole.ts` (precedent: `backfillUserRoles.ts` for the Clerk client, `catalog/extractFromUrl.ts` for a public node action). Because a `"use node"` file may only contain actions, its transactional support functions live in a separate NON-node module `admin/roleChange.ts`: `gate` (internalQuery — re-derives member+JWT-admin authz, loads the target, self-guards on `clerkId === identity.subject`) and `apply` (internalMutation — patches the `users.role` mirror and stamps the audit row via the existing `stampModerationAction` helper). Flow is gate → Clerk `updateUserMetadata` → apply, in order, so a failed Clerk write mirrors and stamps nothing; the `user.updated` webhook reconciles the mirror later regardless. The action is exposed through the `@jigswap/gateway` `admin` namespace exactly like the existing catalog actions and called from the web with `useConvexAction` (the `use-puzzle-import.ts` pattern). Frontend extends the existing `/admin/users` table with a trailing inline-button actions cell (the lighter option, consistent with `category-list.tsx` — no dropdown) behind the established controlled-AlertDialog confirm; the self row is detected by comparing the row `_id` against `gateway.identity.currentUser`'s `_id`.

**Tech Stack:** Convex (queries/mutations/`"use node"` actions, `convex-test` + vitest), Clerk (`@clerk/backend` `createClerkClient`), TanStack Router/Query + `@convex-dev/react-query` (`useConvexAction`, `convexQuery`), shadcn UI (`AlertDialog`, `Button`), sonner toasts, use-intl (en + nl + source), Nx monorepo (pnpm).

---

## Execution context (mandatory facts)

- **Branch/worktree:** work in `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap-worktrees/admin-users-page` on branch `feat/admin-users-page`. This plan **amends PR #38** (the admin users page + Clerk role mirror are already implemented on this branch): commits append to `feat/admin-users-page`, and `git push` updates the open PR. All file paths below are relative to that worktree root; write via the worktree path, never the main-repo path.
- **Backend tests:** `.test.ts` files at the `packages/backend/convex/` ROOT (never subdirs — the `import.meta.glob` module bundling breaks otherwise). Run one file: `pnpm --filter @jigswap/backend exec vitest run convex/<file>.test.ts` (from the worktree root). Full suite: omit the file. Vitest transpiles without type-checking, so a "failing test" step can fail at runtime (missing module / schema validation) rather than compile time — that counts.
- **Backend REAL typecheck:** `pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit` (the `--filter` tsc variant checks zero files). Web: `pnpm nx run @jigswap/web:lint --skip-nx-cache` and `pnpm nx run @jigswap/web:type-check --skip-nx-cache` — the `routeTree.gen.ts` noise (~39 errors: missing module + `createFileRoute(...)` assignability) is PRE-EXISTING; verify only that no NEW errors appear outside that pattern. Always `--skip-nx-cache` to mirror CI.
- **Convex codegen can't run** (no live deployment in the worktree): **hand-edit `packages/backend/convex/_generated/api.d.ts`** to register the TWO new modules (`admin/roleChange` in Task 2, `admin/setUserRole` in Task 3), alphabetically, mirroring the sibling entries. `_generated/api.js` exports `anyApi` and needs NO edit (runtime/test resolution already works); the hand-edit only restores compile-time types. Schema changes need no `_generated` edit. A later real `convex dev` regenerates the file identically.
- **Prettier:** CI runs `pnpm format:check` first. Format every changed file with `pnpm prettier --write <files>` before EVERY commit. Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Authorization guardrail (embed in every review):** authorization NEVER reads `users.role`. The JWT gate (`identity/isAdmin`, which only uses `ctx.auth`) is the only authz source. The self-guard compares the target's `clerkId` to `identity.subject` inside the internal gate query — transactionally, server-side; the UI's hidden affordance is convenience, not enforcement.
- **Known merge overlap (accepted by the spec):** PR 3 of the surrounding feature extends the same `moderationActions.kind` union with `definition_disabled`/`definition_reenabled` and guards the same stats bucketing. Keep the Task 1 edits minimal and explicit (add literals; explicit kind checks; no restructuring) so the conflict stays a trivial union-line merge.

---

### Task 1: `role_granted` / `role_revoked` audit kinds + stats-bucketing guard (TDD)

The `moderationActions.kind` union gains the two role kinds; `stampModerationAction`'s TS union follows; and `getModerationStats` must NOT mis-bucket them — today its bucketing loop has a bare `else` (lines 33–37 of `getModerationStats.ts`) that counts anything that is neither `definition_approved/edited_approved` nor `definition_rejected` as `flagsCleared`, so role rows would silently inflate the weekly "flags cleared" KPI. Replace the bare `else` with an explicit photo-kind check (no restructuring — this is the guard style least likely to collide with PR 3's parallel edits). The `avgReviewMins` sampling guard (`row.kind.startsWith("definition_")`, line 38) already excludes role kinds — leave it untouched. `getModerationActivity` passes kinds through unchanged and needs no code edit, but the spec requires a read-model test that it surfaces the new kinds.

**Files:**

- Modify: `packages/backend/convex/schema.ts` (`moderationActions.kind` union, lines 415–422 — add two literals after `photo_auto_rejected`)
- Modify: `packages/backend/convex/admin/stampModerationAction.ts` (`ModerationKind` union, lines 4–10)
- Modify: `packages/backend/convex/admin/getModerationStats.ts` (bucketing loop, lines 27–38 — bare `else` → explicit photo-kind check)
- Test (modify): `packages/backend/convex/moderationActions.test.ts` (extend the `seedAction` helper's kind union at lines 224–230; append a new `describe` at the end of the file, after line 432)

**Steps:**

- [ ] **Step 1.1:** Write the failing tests. In `packages/backend/convex/moderationActions.test.ts`, first extend the `seedAction` helper's inline kind union (lines 224–230) to:

```ts
    kind:
      | "definition_approved"
      | "definition_rejected"
      | "definition_edited_approved"
      | "photo_restored"
      | "photo_removal_confirmed"
      | "photo_auto_rejected"
      | "role_granted"
      | "role_revoked";
```

Then append this `describe` block at the very end of the file (after the closing `});` of `"moderation read models are admin-gated"` at line 432):

```ts
describe("role-change kinds in moderation read models", () => {
  test("weekly stats ignore role_granted / role_revoked rows", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    await seedAction(t, { kind: "definition_approved", at: now - 1000 });
    await seedAction(t, {
      kind: "role_granted",
      at: now - 2000,
      actorId: alice,
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    await seedAction(t, {
      kind: "role_revoked",
      at: now - 3000,
      actorId: alice,
      targetLabel: "Cleo",
      targetId: "clerk_cleo",
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    // Role rows are audit-only: they must not leak into ANY weekly KPI bucket.
    expect(stats).toMatchObject({ approved: 1, rejected: 0, flagsCleared: 0 });
    expect(stats.avgReviewMins).toBeNull();
  });

  test("the activity feed surfaces role kinds with the actor joined in", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    await seedAction(t, {
      kind: "role_granted",
      at: now - 1000,
      actorId: alice,
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    await seedAction(t, {
      kind: "role_revoked",
      at: now - 2000,
      actorId: alice,
      targetLabel: "Cleo",
      targetId: "clerk_cleo",
    });

    const rows = await asAdmin(t).query(
      api.admin.getModerationActivity.getModerationActivity,
      {},
    );
    expect(rows).toEqual([
      {
        kind: "role_granted",
        actorName: "Alice",
        targetLabel: "Bob",
        targetId: "clerk_bob",
        at: now - 1000,
      },
      {
        kind: "role_revoked",
        actorName: "Alice",
        targetLabel: "Cleo",
        targetId: "clerk_cleo",
        at: now - 2000,
      },
    ]);
  });
});
```

- [ ] **Step 1.2:** Run and watch it fail: `pnpm --filter @jigswap/backend exec vitest run convex/moderationActions.test.ts` — expected failure: both new tests reject at the `seedAction` insert with a convex-test schema-validation error for `kind` (the union does not yet allow `"role_granted"`/`"role_revoked"`). The pre-existing tests still pass.
- [ ] **Step 1.3:** Extend the schema union. In `packages/backend/convex/schema.ts`, change the `moderationActions.kind` validator (lines 415–422) to:

```ts
    kind: v.union(
      v.literal("definition_approved"),
      v.literal("definition_rejected"),
      v.literal("definition_edited_approved"),
      v.literal("photo_restored"),
      v.literal("photo_removal_confirmed"),
      v.literal("photo_auto_rejected"),
      v.literal("role_granted"),
      v.literal("role_revoked"),
    ),
```

- [ ] **Step 1.4:** Extend the stamp helper's TS union. In `packages/backend/convex/admin/stampModerationAction.ts`, change `ModerationKind` (lines 4–10) to:

```ts
type ModerationKind =
  | "definition_approved"
  | "definition_rejected"
  | "definition_edited_approved"
  | "photo_restored"
  | "photo_removal_confirmed"
  | "photo_auto_rejected"
  | "role_granted"
  | "role_revoked";
```

- [ ] **Step 1.5:** Re-run `pnpm --filter @jigswap/backend exec vitest run convex/moderationActions.test.ts` — expected: the activity test now PASSES, but the stats test still FAILS with `flagsCleared: 2` instead of `0` (the bare `else` mis-buckets the role rows). This failure is the point of the guard.
- [ ] **Step 1.6:** Fix the bucketing. In `packages/backend/convex/admin/getModerationStats.ts`, replace the `else` branch (lines 33–37):

```ts
      } else {
        // photo_restored | photo_removal_confirmed | photo_auto_rejected
        flagsCleared += 1;
      }
```

with an explicit kind check:

```ts
      } else if (
        row.kind === "photo_restored" ||
        row.kind === "photo_removal_confirmed" ||
        row.kind === "photo_auto_rejected"
      ) {
        flagsCleared += 1;
      }
      // role_granted / role_revoked are audit-only: surfaced in the activity
      // feed, never counted in the weekly moderation KPIs.
```

(Leave the `row.kind.startsWith("definition_")` review-time sampling untouched — role kinds don't match it.)

- [ ] **Step 1.7:** Run to green: `pnpm --filter @jigswap/backend exec vitest run convex/moderationActions.test.ts` — expected PASS (all tests, old and new).
- [ ] **Step 1.8:** Typecheck: `pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit` — expected PASS.
- [ ] **Step 1.9:** Format and commit:

```bash
pnpm prettier --write packages/backend/convex/schema.ts packages/backend/convex/admin/stampModerationAction.ts packages/backend/convex/admin/getModerationStats.ts packages/backend/convex/moderationActions.test.ts
git add packages/backend/convex/schema.ts packages/backend/convex/admin/stampModerationAction.ts packages/backend/convex/admin/getModerationStats.ts packages/backend/convex/moderationActions.test.ts
git commit -m "feat(backend): role_granted/role_revoked audit kinds + stats bucketing guard

The moderationActions kind union gains the role-change kinds; the weekly
KPI bucketing switches from a bare else to an explicit photo-kind check
so audit-only role rows never inflate flagsCleared.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `admin/roleChange.ts` — gate query + apply mutation (TDD)

The transactional halves of the write path, in a NON-node module (a `"use node"` file may only contain actions, so these cannot live in `admin/setUserRole.ts`). `gate` re-derives everything gate-relevant inside one transaction; `apply` patches the mirror and stamps the audit row atomically. Registering the new module in the hand-edited `api.d.ts` happens in this task so the backend typecheck stays green.

**Files:**

- Create: `packages/backend/convex/admin/roleChange.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (import block: insert after the `admin_restorePhoto` import at line 16; module map: insert after `"admin/restorePhoto"` at line 300 — alphabetical: `restorePhoto` < `roleChange` < `setUserRole` < `adminCategories`)
- Test (create): `packages/backend/convex/roleChange.test.ts`

**Steps:**

- [ ] **Step 2.1:** Write the failing test. Create `packages/backend/convex/roleChange.test.ts`:

```ts
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Two members: Alice acts (admin ONLY via the JWT claim — her row mirror is set
// too, to prove the gate never reads it), Bob is the target.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const alice = await mkUser("clerk_alice", "Alice", { role: "admin" });
    const bob = await mkUser("clerk_bob", "Bob");
    return { alice, bob };
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

describe("admin/roleChange.gate", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expect(
      t.query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a member without the JWT admin claim (even when their ROW mirror says admin)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    // Alice's row carries role "admin" (display mirror) but her identity has no
    // metadata.role claim — the gate must still refuse her.
    await expect(
      asMember(t).query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("rejects a self-change with CannotChangeOwnRole", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      asAdmin(t).query(internal.admin.roleChange.gate, { userId: alice }),
    ).rejects.toThrow(/CannotChangeOwnRole/);
  });

  test("rejects when the target row no longer exists", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await t.run((ctx) => ctx.db.delete(bob));
    await expect(
      asAdmin(t).query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toThrow(/User not found/);
  });

  test("returns clerkId, name and the acting admin's id for a valid target", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const result = await asAdmin(t).query(internal.admin.roleChange.gate, {
      userId: bob,
    });
    expect(result).toEqual({
      clerkId: "clerk_bob",
      name: "Bob",
      actorId: alice,
    });
  });
});

describe("admin/roleChange.apply", () => {
  test("grant patches the display mirror and stamps role_granted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: "admin",
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const row = await t.run((ctx) => ctx.db.get(bob));
    expect(row?.role).toBe("admin");
    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "role_granted",
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    expect(typeof actions[0].at).toBe("number");
  });

  test("revoke clears the mirror and stamps role_revoked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run((ctx) => ctx.db.patch(bob, { role: "admin" }));
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const row = await t.run((ctx) => ctx.db.get(bob));
    expect(row?.role).toBeUndefined();
    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "role_revoked",
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
  });

  test("stamps are append-only additions to moderationActions", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: "admin",
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const actions = await allActions(t);
    expect(actions.map((a) => a.kind)).toEqual([
      "role_granted",
      "role_revoked",
    ]);
  });
});
```

- [ ] **Step 2.2:** Run and watch it fail: `pnpm --filter @jigswap/backend exec vitest run convex/roleChange.test.ts` — expected failure: every test rejects because the `admin/roleChange` module does not exist (convex-test cannot resolve `admin/roleChange:gate` / `admin/roleChange:apply` from the bundled modules).
- [ ] **Step 2.3:** Implement. Create `packages/backend/convex/admin/roleChange.ts`:

```ts
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { stampModerationAction } from "./stampModerationAction";

// Transactional halves of the admin/setUserRole "use node" action. They live in
// this separate NON-node module because a "use node" file may only contain
// actions. The action runs gate (authz re-derivation) BEFORE the Clerk write and
// apply (mirror + audit stamp) AFTER it. Authorization NEVER reads users.role:
// the JWT gate (identity/isAdmin) is the only authz source; the row's role stays
// a display-only mirror.

// Re-derive everything gate-relevant inside one transaction: the caller must be
// a member AND a JWT admin (fails closed), the target row must exist, and an
// admin can never change their OWN role (self-guard on clerkId vs
// identity.subject — a role set overwrites publicMetadata.role wholesale, so
// ANY self-write would be an indirect self-demotion path).
export const gate = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("User not found");

    // requireMember already proved an identity exists; re-read it for the
    // self-guard comparison.
    const identity = await ctx.auth.getUserIdentity();
    if (identity && target.clerkId === identity.subject) {
      throw new ConvexError("CannotChangeOwnRole");
    }

    return {
      clerkId: target.clerkId,
      name: target.name,
      actorId: memberId as unknown as Id<"users">,
    };
  },
});

// Optimistic fast-path after the Clerk write: atomically patch the display
// mirror (patching `role: undefined` clears the field — the users.patchUserRole
// precedent) and stamp the audit row. The user.updated webhook reconciles the
// mirror later regardless, so this is convenience, not a consistency
// requirement.
export const apply = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.null()),
    actorId: v.id("users"),
    clerkId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { userId, role, actorId, clerkId, name }) => {
    await ctx.db.patch(userId, { role: role ?? undefined });
    await stampModerationAction(ctx, {
      actorId,
      kind: role === null ? "role_revoked" : "role_granted",
      targetLabel: name,
      targetId: clerkId,
    });
  },
});
```

- [ ] **Step 2.4:** Register the module in the hand-edited codegen types. In `packages/backend/convex/_generated/api.d.ts`, insert after line 16 (`import type * as admin_restorePhoto from "../admin/restorePhoto.js";`):

```ts
import type * as admin_roleChange from "../admin/roleChange.js";
```

and in the module map, insert after `"admin/restorePhoto": typeof admin_restorePhoto;` (line 300):

```ts
  "admin/roleChange": typeof admin_roleChange;
```

- [ ] **Step 2.5:** Run to green: `pnpm --filter @jigswap/backend exec vitest run convex/roleChange.test.ts` — expected PASS (8 tests).
- [ ] **Step 2.6:** Typecheck: `pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit` — expected PASS.
- [ ] **Step 2.7:** Format and commit:

```bash
pnpm prettier --write packages/backend/convex/admin/roleChange.ts packages/backend/convex/_generated/api.d.ts packages/backend/convex/roleChange.test.ts
git add packages/backend/convex/admin/roleChange.ts packages/backend/convex/_generated/api.d.ts packages/backend/convex/roleChange.test.ts
git commit -m "feat(backend): role-change gate query + apply mutation (admin/roleChange)

gate re-derives member+JWT-admin authz transactionally, loads the target
and refuses self-changes (clerkId vs identity.subject); apply patches the
display mirror and stamps the role_granted/role_revoked audit row. Both
are internal — the setUserRole node action is the only caller.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `admin/setUserRole.ts` node action + api.d.ts + gateway wiring

The public write path: a `"use node"` action (Clerk Backend API is Node-only — same as `backfillUserRoles.ts`, and `CLERK_SECRET_KEY` is already in the deployment env). The action shell is NOT convex-testable (Clerk network call) — the same accepted status as `backfillUserRoles`; it is verified by the real backend typecheck + gateway typecheck here and on the PR preview deployment. The gateway already exposes actions the same way as queries/mutations (`catalog.extractPuzzleFromUrl`, `catalog.importPuzzleImage` are actions), so `admin.setUserRole` follows that exact precedent — no new gateway mechanism needed.

**Files:**

- Create: `packages/backend/convex/admin/setUserRole.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (import block: insert after the `admin_roleChange` import added in Task 2; module map: insert after `"admin/roleChange"`)
- Modify: `packages/gateway/src/operations.ts` (`admin` namespace, after `listUsers` at line 325)

**Steps:**

- [ ] **Step 3.1:** Create `packages/backend/convex/admin/setUserRole.ts`:

```ts
"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

// Admin write path for a member's role. Clerk publicMetadata.role is the source
// of truth for authorization (identity/isAdmin reads the JWT claim); this action
// updates Clerk and then fast-paths the users.role display mirror + audit stamp
// via internal.admin.roleChange.apply. The role union is the allowlist — future
// roles extend it. Steps run IN ORDER so a failed Clerk write mirrors and stamps
// NOTHING (the error surfaces to the client):
//   1. gate — transactional authz (member + JWT admin), target lookup,
//      self-guard (CannotChangeOwnRole).
//   2. Clerk updateUserMetadata — role: null deletes the key. The target's
//      active JWT keeps its old claims until its next refresh; that brief window
//      is accepted (Clerk tokens are short-lived).
//   3. apply — patch the users.role mirror + stamp role_granted/role_revoked.
//      The user.updated webhook reconciles the mirror later regardless.
export const setUserRole = action({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.null()),
  },
  handler: async (ctx, { userId, role }) => {
    const target = await ctx.runQuery(internal.admin.roleChange.gate, {
      userId,
    });

    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    await clerkClient.users.updateUserMetadata(target.clerkId, {
      publicMetadata: { role },
    });

    await ctx.runMutation(internal.admin.roleChange.apply, {
      userId,
      role,
      actorId: target.actorId,
      clerkId: target.clerkId,
      name: target.name,
    });
  },
});
```

- [ ] **Step 3.2:** Register the module. In `packages/backend/convex/_generated/api.d.ts`, insert after the `admin_roleChange` import line (added in Task 2):

```ts
import type * as admin_setUserRole from "../admin/setUserRole.js";
```

and in the module map, insert after `"admin/roleChange": typeof admin_roleChange;`:

```ts
  "admin/setUserRole": typeof admin_setUserRole;
```

- [ ] **Step 3.3:** Wire the gateway. In `packages/gateway/src/operations.ts`, inside the `admin` namespace, add after the `listUsers` entry (line 325):

```ts
    // Role management WRITE path: a "use node" ACTION (Clerk network write), not
    // a mutation — call it with useConvexAction (the extractPuzzleFromUrl
    // pattern). Grants/revokes the Clerk publicMetadata.role (the authz source
    // of truth), fast-paths the users.role display mirror and stamps a
    // role_granted/role_revoked audit row. Self-changes are refused server-side.
    setUserRole: api.admin.setUserRole.setUserRole,
```

- [ ] **Step 3.4:** Verify by typecheck (the action shell's only automatable verification): `pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit` — expected PASS. `pnpm nx run @jigswap/gateway:type-check --skip-nx-cache` — expected PASS (proves the hand-registered module resolves through the generated `api` object).
- [ ] **Step 3.5:** Regression guard: `pnpm --filter @jigswap/backend exec vitest run convex/roleChange.test.ts` — expected PASS (the new node module joins the test bundle's `import.meta.glob`; a failure here means `setUserRole.ts` broke module loading).
- [ ] **Step 3.6:** Format and commit:

```bash
pnpm prettier --write packages/backend/convex/admin/setUserRole.ts packages/backend/convex/_generated/api.d.ts packages/gateway/src/operations.ts
git add packages/backend/convex/admin/setUserRole.ts packages/backend/convex/_generated/api.d.ts packages/gateway/src/operations.ts
git commit -m "feat(backend): admin setUserRole node action + gateway wiring

gate -> Clerk updateUserMetadata -> apply, in order, so a failed Clerk
write mirrors and stamps nothing. Exposed as gateway.admin.setUserRole
(action, the extractPuzzleFromUrl precedent).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — row actions, confirm dialogs, self-row hiding, i18n, activity labels

Extend `/admin/users` with a trailing actions cell: one inline `Button` per row (**Make admin** when `role !== "admin"`, destructive-styled **Remove admin** when `role === "admin"`), behind the established controlled-AlertDialog confirm (the `category-list.tsx` pattern — inline buttons, not a dropdown, consistent with that page's row actions and lighter than `dropdown-menu.tsx`). The caller's own row shows NO affordance: compare the row `_id` against `gateway.identity.currentUser` (`CurrentMemberView` shares the `users` `_id`); the server gate stays the real enforcement. The action is called via `useConvexAction` (the `use-puzzle-import.ts` pattern); per-row busy state derives from the in-flight mutation's `variables` (the `category-list.tsx` `busyId` idiom). The table is already reactive — `apply`'s mirror patch updates the row without manual refresh. The Activity Log's `KIND_META` is `Record<ActivityRow["kind"], …>`, so after Task 1 the backend's widened kind union makes the two new entries type-REQUIRED — the web typecheck fails until they are added (built-in verification).

**Files:**

- Modify: `apps/web/src/routes/_dashboard/admin/users.tsx` (whole file — full replacement below)
- Modify: `apps/web/src/components/admin/moderation/activity-log.tsx` (imports at lines 14–21; `KIND_META` at lines 28–35)
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json` (`admin.users` + `admin.moderation.activity` blocks)

**Steps:**

- [ ] **Step 4.1:** Replace `apps/web/src/routes/_dashboard/admin/users.tsx` with:

```tsx
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Search, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUsersPage,
});

const PAGE_SIZE = 25;

// Admin directory of every member. The role badge renders the DISPLAY-ONLY mirrored Clerk
// role (users.role); authorization is enforced server-side from the JWT (identity/isAdmin)
// in admin/listUsers — this page never gates on the mirror. Role management: a per-row
// grant/revoke behind an AlertDialog confirm, calling the setUserRole ACTION (Clerk write +
// mirror fast-path + audit stamp). The caller's own row shows no affordance — the server's
// CannotChangeOwnRole gate is the real enforcement, the UI just doesn't offer the foot-gun.
function AdminUsersPage() {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const [searchInput, setSearchInput] = useState("");
  // Debounced server search: usePaginatedQuery restarts pagination whenever its args change,
  // so only push the term once the admin stops typing.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const {
    results: users,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(gateway.admin.listUsers, search ? { search } : {}, {
    initialNumItems: PAGE_SIZE,
  });

  // The signed-in admin's own row is identified by _id (CurrentMemberView shares the
  // users table _id) so its role affordance can be hidden.
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  const setRole = useMutation({
    mutationFn: useConvexAction(gateway.admin.setUserRole),
  });
  // Per-row busy state derived from the in-flight mutation's variables (the
  // category-list busyId idiom) — the row's button disables while its call runs.
  const busyUserId = setRole.isPending
    ? (setRole.variables?.userId ?? null)
    : null;

  // The row awaiting the role-change confirm (grant when role !== "admin", revoke otherwise).
  const [confirming, setConfirming] = useState<(typeof users)[number] | null>(
    null,
  );

  const changeRole = async (user: (typeof users)[number]) => {
    const granting = user.role !== "admin";
    try {
      await setRole.mutateAsync({
        userId: user._id as Id<"users">,
        role: granting ? "admin" : null,
      });
      toast.success(
        granting
          ? t("grantSuccess", { name: user.name })
          : t("revokeSuccess", { name: user.name }),
      );
    } catch {
      // Covers Clerk failures and the server self-guard (unreachable via this UI,
      // which hides the own-row affordance).
      toast.error(granting ? t("grantError") : t("revokeError"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {status === "LoadingFirstPage" ? (
        <PageLoading message={t("loading")} />
      ) : users.length === 0 ? (
        <QueueEmpty icon={UserX} title={t("emptyTitle")} label={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("columns.member")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.joined")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.role")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("columns.copies")}
                </th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t("columns.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user._id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        {user.avatar && (
                          <AvatarImage src={user.avatar} alt={user.name} />
                        )}
                        <AvatarFallback>
                          {user.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        {user.username && (
                          <div className="text-xs text-muted-foreground">
                            @{user.username}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format.dateTime(new Date(user.createdAt), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <Badge variant="secondary">{t("active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.role === "admin" && <Badge>{t("adminBadge")}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {user.ownedCopyCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {me && me._id !== user._id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(user)}
                        disabled={busyUserId === user._id}
                        className={
                          user.role === "admin"
                            ? "text-destructive hover:text-destructive"
                            : undefined
                        }
                      >
                        {user.role === "admin"
                          ? t("removeAdmin")
                          : t("makeAdmin")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => loadMore(PAGE_SIZE)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.role === "admin"
                ? t("revokeConfirmTitle", { name: confirming?.name ?? "" })
                : t("grantConfirmTitle", { name: confirming?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.role === "admin"
                ? t("revokeConfirmBody")
                : t("grantConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming?.role === "admin"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
              onClick={() => {
                if (confirming) void changeRole(confirming);
                setConfirming(null);
              }}
            >
              {confirming?.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 4.2:** Add the Activity Log kind metadata. In `apps/web/src/components/admin/moderation/activity-log.tsx`, extend the lucide import (lines 14–21) to:

```tsx
import {
  CheckCircle,
  Flag,
  type LucideIcon,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
```

and extend `KIND_META` (lines 28–35) to:

```tsx
const KIND_META: Record<ActivityRow["kind"], [LucideIcon, string]> = {
  definition_approved: [CheckCircle, "text-jigsaw-success"],
  definition_edited_approved: [CheckCircle, "text-jigsaw-success"],
  definition_rejected: [XCircle, "text-destructive"],
  photo_removal_confirmed: [Trash2, "text-destructive"],
  photo_auto_rejected: [Flag, "text-jigsaw-warning"],
  photo_restored: [Undo2, "text-muted-foreground"],
  role_granted: [ShieldCheck, "text-jigsaw-success"],
  role_revoked: [ShieldOff, "text-destructive"],
};
```

(`KIND_META` is `Record<ActivityRow["kind"], …>` over the backend return type, so omitting either new entry is a type error — the web typecheck in Step 4.5 verifies completeness.)

- [ ] **Step 4.3:** Add the i18n keys — English + source. In BOTH `apps/web/locales/en.json` and `apps/web/locales/source.json` (identical English content), inside `admin.users`: add to the `columns` object after `"copies"`:

```json
    "actions": "Actions"
```

and after the existing `"loadMore"` key add:

```json
    "makeAdmin": "Make admin",
    "removeAdmin": "Remove admin",
    "grantConfirmTitle": "Make {name} an admin?",
    "grantConfirmBody": "This grants full access to the admin console, including moderation and member management. The change is audit-logged.",
    "revokeConfirmTitle": "Remove admin from {name}?",
    "revokeConfirmBody": "They lose access to the admin console once their session refreshes. The change is audit-logged.",
    "grantSuccess": "{name} is now an admin.",
    "grantError": "Could not grant the admin role.",
    "revokeSuccess": "{name} is no longer an admin.",
    "revokeError": "Could not remove the admin role."
```

Inside `admin.moderation.activity` (after `"photo_restored"`) add:

```json
    "role_granted": "<strong>{actor}</strong> made <strong>{target}</strong> an admin",
    "role_revoked": "<strong>{actor}</strong> removed the admin role from <strong>{target}</strong>"
```

- [ ] **Step 4.4:** Add the i18n keys — Dutch. In `apps/web/locales/nl.json`, inside `admin.users.columns` after `"copies"`:

```json
    "actions": "Acties"
```

after `"loadMore"`:

```json
    "makeAdmin": "Beheerder maken",
    "removeAdmin": "Beheerder verwijderen",
    "grantConfirmTitle": "{name} beheerder maken?",
    "grantConfirmBody": "Dit geeft volledige toegang tot de beheerconsole, inclusief moderatie en ledenbeheer. De wijziging wordt vastgelegd in het auditlogboek.",
    "revokeConfirmTitle": "Beheerdersrechten van {name} intrekken?",
    "revokeConfirmBody": "Zij verliezen toegang tot de beheerconsole zodra hun sessie ververst. De wijziging wordt vastgelegd in het auditlogboek.",
    "grantSuccess": "{name} is nu beheerder.",
    "grantError": "Kon de beheerdersrol niet toekennen.",
    "revokeSuccess": "{name} is geen beheerder meer.",
    "revokeError": "Kon de beheerdersrol niet intrekken."
```

Inside `admin.moderation.activity` (after `"photo_restored"`):

```json
    "role_granted": "<strong>{actor}</strong> maakte <strong>{target}</strong> beheerder",
    "role_revoked": "<strong>{actor}</strong> trok de beheerdersrol van <strong>{target}</strong> in"
```

- [ ] **Step 4.5:** Verify: `pnpm nx run @jigswap/web:lint --skip-nx-cache` — expected PASS. `pnpm nx run @jigswap/web:type-check --skip-nx-cache` — no NEW errors (only the pre-existing `routeTree.gen.ts` noise); this also proves `KIND_META` covers the widened kind union and the `setUserRole` args type flows through `useConvexAction`. Browser click-through is unavailable in this environment (no Chrome) — drive-the-page verification happens on the PR preview deployment.
- [ ] **Step 4.6:** Format and commit:

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/admin/users.tsx apps/web/src/components/admin/moderation/activity-log.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git add apps/web/src/routes/_dashboard/admin/users.tsx apps/web/src/components/admin/moderation/activity-log.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git commit -m "feat(web): grant/revoke admin role from /admin/users with confirm dialogs

Per-row inline action (destructive styling on revoke) behind the
controlled AlertDialog pattern, calling the setUserRole action via
useConvexAction. The caller's own row shows no affordance (server
self-guard stays authoritative). Activity Log labels for the
role_granted/role_revoked audit kinds (en/nl/source).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification sweep + push (updates PR #38)

**Files:** none created/modified (verification + PR update only).

**Steps:**

- [ ] **Step 5.1:** Full backend suite: `pnpm --filter @jigswap/backend exec vitest run` — expected PASS (no regressions from the schema union or new modules).
- [ ] **Step 5.2:** Types + lint across the touched projects:

```bash
pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit
pnpm nx run @jigswap/contracts:type-check --skip-nx-cache
pnpm nx run @jigswap/gateway:type-check --skip-nx-cache
pnpm nx run @jigswap/web:type-check --skip-nx-cache   # only pre-existing routeTree noise allowed
pnpm nx run @jigswap/web:lint --skip-nx-cache
```

- [ ] **Step 5.3:** `pnpm format:check` — expected PASS (CI runs this first).
- [ ] **Step 5.4:** Scope audit: `git diff origin/main --stat` — every changed file must appear in this plan's **Files:** lists or in the pre-existing PR #38 diff; anything else is scope creep and must be reverted. This plan's own additions are exactly: `packages/backend/convex/schema.ts`, `packages/backend/convex/admin/stampModerationAction.ts`, `packages/backend/convex/admin/getModerationStats.ts`, `packages/backend/convex/moderationActions.test.ts`, `packages/backend/convex/admin/roleChange.ts`, `packages/backend/convex/roleChange.test.ts`, `packages/backend/convex/admin/setUserRole.ts`, `packages/backend/convex/_generated/api.d.ts`, `packages/gateway/src/operations.ts`, `apps/web/src/routes/_dashboard/admin/users.tsx`, `apps/web/src/components/admin/moderation/activity-log.tsx`, `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`, `docs/superpowers/specs/2026-07-08-admin-user-role-management-design.md`, `docs/superpowers/plans/2026-07-08-admin-user-role-management.md`.
- [ ] **Step 5.5:** Guardrail inspection: confirm `identity/isAdmin.ts` and `identity/requireMember.ts` are untouched; confirm no code path reads `users.role` for an authorization decision (`gate` reads the JWT via `isAdmin`; the row's `role` is only displayed and mirrored); confirm the self-guard compares `target.clerkId === identity.subject`.
- [ ] **Step 5.6:** Commit the spec + this plan if not yet committed (they must ship with the branch):

```bash
git add docs/superpowers/specs/2026-07-08-admin-user-role-management-design.md docs/superpowers/plans/2026-07-08-admin-user-role-management.md
git commit -m "docs: admin user role management spec + implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if `git status` shows them already committed.)

- [ ] **Step 5.7:** Push — this appends the commits to the open PR: `git push` (branch `feat/admin-users-page`, PR #38).
- [ ] **Step 5.8:** Document the addition on the PR:

```bash
gh pr comment 38 --body "## Added: admin user role management (approved addendum spec)

This PR now also implements \`docs/superpowers/specs/2026-07-08-admin-user-role-management-design.md\`:

- **Grant/revoke roles from /admin/users** — per-row Make admin / Remove admin behind AlertDialog confirms (destructive styling on revoke), calling the new \`admin/setUserRole\` \"use node\" action via \`useConvexAction\`.
- **Write path** — \`gate\` (internal query: member + JWT-admin authz re-derived transactionally, target lookup) → Clerk \`updateUserMetadata\` (publicMetadata.role is the authz source of truth; \`role: null\` deletes the key) → \`apply\` (internal mutation: users.role display-mirror fast-path + audit stamp). A failed Clerk write mirrors and stamps nothing; the user.updated webhook reconciles the mirror regardless.
- **Self-guard** — an admin can never change their OWN role: the gate throws \`CannotChangeOwnRole\` when the target's clerkId equals \`identity.subject\`; the UI additionally hides the affordance on the caller's own row. Demoting *other* admins is allowed; the Clerk dashboard remains the escape hatch.
- **Audit kinds** — \`moderationActions.kind\` gains \`role_granted\` / \`role_revoked\`, surfaced in the moderation Activity Log (en/nl/source labels) and explicitly excluded from the weekly KPI bucketing in \`getModerationStats\`. (Known small merge overlap with PR 3, which extends the same union.)
- **Authorization unchanged** — nothing reads \`users.role\` for authz; \`identity/isAdmin\` (JWT) stays the only gate.

Tests: \`roleChange.test.ts\` (gate + apply, 8 tests) and role-kind read-model tests in \`moderationActions.test.ts\`. The action shell (Clerk network call) is not convex-testable — same accepted status as \`backfillUserRoles\`; verify grant/revoke on the preview deployment.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Post-deploy note (no new operational steps)

- `CLERK_SECRET_KEY` is already in the deployment env (used by `backfillUserRoles`); the Clerk `convex` JWT template already carries the `metadata` claim. No configuration change needed.
- The target's active JWT keeps its old claims until its next refresh — accepted (Clerk tokens are short-lived).
- `_generated/api.d.ts` was hand-edited again (worktree, no live deployment); the next real `convex dev`/`convex deploy` codegen regenerates it identically.
