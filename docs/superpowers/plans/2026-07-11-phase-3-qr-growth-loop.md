# Phase 3: QR + Share Link + Growth Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can show a QR code (or share a link) that lets anyone — logged-out strangers or existing members — connect with them in one tap, with signup attribution that survives the Clerk redirect.

**Architecture:** A per-member `inviteLinks` token (revocable, with counters) rides on the Phase 1 profile URL as `?invite=<token>`. Backend: five thin Convex functions in `convex/social/` plus one shared `establishMutualFollow` helper that reuses the existing follow use case (so domain events still flow to the activity feed and notifications). Web: a client-rendered QR dialog, invite-aware landing states on `/members/$handle`, and an `InviteRedeemer` mounted in the dashboard layout that redeems the localStorage token after signup.

**Tech Stack:** Convex (convex-test + vitest for backend tests), TanStack Router/Start, Clerk, `qrcode.react` (new dep), use-intl.

**Prerequisites (Phase 1 + 2 are merged):** `/members/$handle` route (`apps/web/src/routes/members.$handle.tsx`) with `getPublicMemberTeaser`; `followRequests` table with `by_requester_target` index and status `pending|approved|declined`; visibility-aware `followMember`.

**Conventions that bite:**

- Backend tests live at `packages/backend/convex/*.test.ts` (root, NOT nested), using `convexTest` + `t.withIdentity({ subject: "clerk_..." })` — copy the seed pattern from `arrangeShelf.test.ts`.
- New Convex function files need `_generated/api.d.ts` entries. In a worktree without a deployment, hand-edit `packages/backend/convex/_generated/api.d.ts` to add the module imports/entries (see memory: "Convex codegen needs deployment").
- Run tests with `pnpm nx test backend --skip-nx-cache -- <filename>` (Nx cache hides fresh failures).
- Run `pnpm prettier --write <changed files>` before every commit (CI runs `format:check` first).

---

### Task 1: Schema — `inviteLinks` + `inviteRedemptions` tables

**Files:**

- Modify: `packages/backend/convex/schema.ts` (append after the `follows` table, ~line 885)

- [ ] **Step 1: Add the two tables**

```ts
  // Social: a member's shareable invite link. One ACTIVE row per member (revokedAt undefined);
  // resets revoke the old row and insert a new one so historical counters survive. The token rides
  // on the profile URL as ?invite=<token> (QR + share). Counters are the growth-loop metrics.
  inviteLinks: defineTable({
    ownerId: v.id("users"),
    token: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    landingViews: v.number(),
    signupsAttributed: v.number(),
    followsEstablished: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_token", ["token"]),

  // Social: one row per redeemed invite — makes redeemInvite idempotent per new member
  // (by_new_member is checked before establishing the mutual follow).
  inviteRedemptions: defineTable({
    inviteLinkId: v.id("inviteLinks"),
    inviterId: v.id("users"),
    newMemberId: v.id("users"),
    createdAt: v.number(),
  }).index("by_new_member", ["newMemberId"]),
```

- [ ] **Step 2: Verify the schema compiles**

Run: `pnpm nx run @jigswap/backend:type-check --skip-nx-cache`
Expected: PASS (exit 0)

- [ ] **Step 3: Commit**

```bash
pnpm prettier --write packages/backend/convex/schema.ts
git add packages/backend/convex/schema.ts
git commit -m "feat(social): inviteLinks + inviteRedemptions tables for QR growth loop"
```

---

### Task 2: `getMyInviteLink` + `resetInviteLink`

**Files:**

- Create: `packages/backend/convex/social/getMyInviteLink.ts`
- Create: `packages/backend/convex/social/resetInviteLink.ts`
- Test: `packages/backend/convex/inviteLinks.test.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-add the two modules if codegen is unavailable)

- [ ] **Step 1: Write the failing tests**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("getMyInviteLink", () => {
  test("creates a token on first call and returns the same one after", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);

    const first = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(first.token).toMatch(/^[a-f0-9]{32}$/);

    const second = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(second.token).toBe(first.token);
  });
});

describe("resetInviteLink", () => {
  test("revokes the active token and issues a different one", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    const original = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const reset = await asAlice(t).mutation(
      api.social.resetInviteLink.resetInviteLink,
      {},
    );
    expect(reset.token).not.toBe(original.token);

    // Old row is revoked, new row is active
    const rows = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_owner", (q) => q.eq("ownerId", alice))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.token === original.token)?.revokedAt).toBeTypeOf(
      "number",
    );
    expect(
      rows.find((r) => r.token === reset.token)?.revokedAt,
    ).toBeUndefined();

    // getMyInviteLink now returns the new token
    const after = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(after.token).toBe(reset.token);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test backend --skip-nx-cache -- inviteLinks.test.ts`
Expected: FAIL — `api.social.getMyInviteLink` is undefined

- [ ] **Step 3: Implement `getMyInviteLink.ts`**

```ts
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { Id } from "../_generated/dataModel";

// Returns the member's ACTIVE invite token, creating one on first use. A mutation (not a query)
// because the first call writes. The token is opaque (uuid hex) — never derived from the member id,
// so resetting it actually severs old links.
export const getMyInviteLink = mutation({
  args: {},
  handler: async (ctx, _args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .collect();
    const active = rows.find((r) => r.revokedAt === undefined);
    if (active) return { token: active.token };

    const token = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.insert("inviteLinks", {
      ownerId: memberId,
      token,
      createdAt: Date.now(),
      landingViews: 0,
      signupsAttributed: 0,
      followsEstablished: 0,
    });
    return { token };
  },
});
```

- [ ] **Step 4: Implement `resetInviteLink.ts`**

```ts
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { Id } from "../_generated/dataModel";

// Revoke the active invite token and issue a fresh one. Old rows are kept (revokedAt stamped) so
// historical counters survive; landings on the old token silently degrade to the plain teaser.
export const resetInviteLink = mutation({
  args: {},
  handler: async (ctx, _args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .collect();
    const now = Date.now();
    for (const row of rows) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch(row._id, { revokedAt: now });
      }
    }

    const token = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.insert("inviteLinks", {
      ownerId: memberId,
      token,
      createdAt: now,
      landingViews: 0,
      signupsAttributed: 0,
      followsEstablished: 0,
    });
    return { token };
  },
});
```

If `api.social.getMyInviteLink` doesn't resolve in tests, hand-add both modules to `packages/backend/convex/_generated/api.d.ts` following the existing `social/*` entries.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test backend --skip-nx-cache -- inviteLinks.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/getMyInviteLink.ts packages/backend/convex/social/resetInviteLink.ts packages/backend/convex/inviteLinks.test.ts
git add packages/backend/convex/social/getMyInviteLink.ts packages/backend/convex/social/resetInviteLink.ts packages/backend/convex/inviteLinks.test.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(social): invite link create + reset mutations"
```

---

### Task 3: `getInviteContext` (public query) + `recordInviteLanding` (public mutation)

**Files:**

- Create: `packages/backend/convex/social/getInviteContext.ts`
- Create: `packages/backend/convex/social/recordInviteLanding.ts`
- Test: `packages/backend/convex/inviteLanding.test.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-add if needed)

- [ ] **Step 1: Write the failing tests**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("getInviteContext", () => {
  test("valid only when token is active AND belongs to the viewed member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Unauthenticated (public) query
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: alice,
      }),
    ).toEqual({ valid: true });

    // Token pinned to a different member's profile -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: bob,
      }),
    ).toEqual({ valid: false });

    // Unknown token -> invalid
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token: "nope",
        memberId: alice,
      }),
    ).toEqual({ valid: false });

    // Revoked token -> invalid
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId: alice,
      }),
    ).toEqual({ valid: false });
  });
});

describe("recordInviteLanding", () => {
  test("increments landingViews for valid tokens, no-ops otherwise", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Public (unauthenticated) mutation
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token,
    });
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token,
    });
    await t.mutation(api.social.recordInviteLanding.recordInviteLanding, {
      token: "nope",
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(row?.landingViews).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test backend --skip-nx-cache -- inviteLanding.test.ts`
Expected: FAIL — `api.social.getInviteContext` is undefined

- [ ] **Step 3: Implement `getInviteContext.ts`**

```ts
import { v } from "convex/values";
import { query } from "../_generated/server";

// PUBLIC (no auth): tells the /members/$handle landing whether ?invite=<token> is a live invite
// for THIS profile. memberId pins the token to the viewed profile so a token can't decorate
// someone else's page. Returns only a boolean — never the token owner's data.
export const getInviteContext = query({
  args: { token: v.string(), memberId: v.id("users") },
  handler: async (ctx, { token, memberId }) => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    return {
      valid:
        link !== null &&
        link.revokedAt === undefined &&
        link.ownerId === memberId,
    };
  },
});
```

- [ ] **Step 4: Implement `recordInviteLanding.ts`**

```ts
import { v } from "convex/values";
import { mutation } from "../_generated/server";

// PUBLIC (no auth): fire-and-forget landing counter for the growth-loop metrics. Invalid or
// revoked tokens are silently ignored (the landing page degrades to the plain teaser).
export const recordInviteLanding = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (link === null || link.revokedAt !== undefined) return;
    await ctx.db.patch(link._id, { landingViews: link.landingViews + 1 });
  },
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm nx test backend --skip-nx-cache -- inviteLanding.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/getInviteContext.ts packages/backend/convex/social/recordInviteLanding.ts packages/backend/convex/inviteLanding.test.ts
git add packages/backend/convex/social/getInviteContext.ts packages/backend/convex/social/recordInviteLanding.ts packages/backend/convex/inviteLanding.test.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(social): public invite-context query + landing counter"
```

---

### Task 4: `establishMutualFollow` helper + `acceptQrFollow`

**Files:**

- Create: `packages/backend/convex/social/establishMutualFollow.ts`
- Create: `packages/backend/convex/social/acceptQrFollow.ts`
- Test: `packages/backend/convex/qrFollow.test.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-add if needed)

- [ ] **Step 1: Write the failing tests**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

const followEdges = (
  t: ReturnType<typeof convexTest>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    const ab = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", a).eq("followeeId", b),
      )
      .unique();
    const ba = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", b).eq("followeeId", a),
      )
      .unique();
    return { ab: ab !== null, ba: ba !== null };
  });

describe("acceptQrFollow", () => {
  test("valid foreign token establishes the mutual follow and bumps the counter", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.followsEstablished).toBe(1);
  });

  test("is idempotent when edges already exist (one direction pre-followed)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob already follows Alice
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const result = await asBob(t).mutation(
      api.social.acceptQrFollow.acceptQrFollow,
      { token },
    );
    expect(result).toEqual({ established: true });
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });

    // No duplicate edges
    const bobToAlice = await t.run((ctx) =>
      ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", bob).eq("followeeId", alice),
        )
        .collect(),
    );
    expect(bobToAlice).toHaveLength(1);
  });

  test("own token and invalid/revoked tokens are silently ignored", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Own token
    expect(
      await asAlice(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: false });

    // Revoked token
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: false });

    // Unknown token
    expect(
      await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token: "nope",
      }),
    ).toEqual({ established: false });

    expect(await followEdges(t, alice, bob)).toEqual({ ab: false, ba: false });
  });

  test("auto-approves a pending follow request between the pair", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob has a pending request to (private) Alice — Phase 2 shape
    await t.run(async (ctx) => {
      await ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: bob,
        targetId: alice,
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await asBob(t).mutation(api.social.acceptQrFollow.acceptQrFollow, {
      token,
    });

    const request = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", bob).eq("targetId", alice),
        )
        .unique(),
    );
    expect(request?.status).toBe("approved");
    expect(await followEdges(t, alice, bob)).toEqual({ ab: true, ba: true });
  });
});
```

> Note: the `followRequests` insert must match the Phase 2 schema exactly — check
> `packages/backend/convex/schema.ts` at implementation time and adjust field names
> (`createdAt`/`updatedAt` vs `requestedAt` etc.) to what Phase 2 actually shipped.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test backend --skip-nx-cache -- qrFollow.test.ts`
Expected: FAIL — `api.social.acceptQrFollow` is undefined

- [ ] **Step 3: Implement `establishMutualFollow.ts`**

```ts
import { makeFollowMember, toMemberId } from "@jigswap/domain";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";

// Establish follow edges in BOTH directions between two members, tolerating edges that already
// exist, and auto-approve any pending follow request between the pair. Used by QR scan + invite
// redemption, where physically sharing your code is mutual intent — so this deliberately bypasses
// the private-profile request gate that the followMember ENDPOINT applies (Phase 2). It still goes
// through the domain use case so MemberFollowed events reach the activity feed and notifications.
export async function establishMutualFollow(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<void> {
  const followUseCase = makeFollowMember({
    follows: convexFollowRepository(ctx),
    followIds: followIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });

  for (const [follower, followee] of [
    [a, b],
    [b, a],
  ] as const) {
    // Skip directions that already have an edge (the use case would reject the duplicate).
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", follower).eq("followeeId", followee),
      )
      .unique();
    if (existing !== null) continue;

    const result = await followUseCase({
      followerId: toMemberId(follower),
      followeeId: toMemberId(followee),
    });
    // Duplicate-edge races are benign here; anything else (e.g. self-follow) is a caller bug.
    if (result.isErr) {
      console.warn("establishMutualFollow: follow rejected", result.error);
    }
  }

  // Auto-approve any pending request between the pair — the edge now exists either way, and a
  // stale "pending" row would keep the requester's UI stuck on "Requested".
  for (const [requesterId, targetId] of [
    [a, b],
    [b, a],
  ] as const) {
    const pending = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", requesterId).eq("targetId", targetId),
      )
      .unique();
    if (pending !== null && pending.status === "pending") {
      await ctx.db.patch(pending._id, {
        status: "approved",
        respondedAt: Date.now(),
      });
    }
  }
}
```

> Verified against the Phase 2 plan: `followRequests` has `createdAt` + optional `respondedAt`
> (NO `updatedAt` field), pair-uniqueness is enforced in the application layer so `.unique()` is
> safe, and Phase 2's approve path stamps `respondedAt` — the patch above mirrors it.

- [ ] **Step 4: Implement `acceptQrFollow.ts`**

```ts
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";

// A logged-in member scanned someone's QR (or opened their invite link): one tap establishes the
// mutual follow. Own/invalid/revoked tokens are silently ignored — never an error, the landing
// page just shows nothing special.
export const acceptQrFollow = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      link.ownerId === memberId
    ) {
      return { established: false };
    }

    await establishMutualFollow(ctx, link.ownerId, memberId);
    await ctx.db.patch(link._id, {
      followsEstablished: link.followsEstablished + 1,
    });
    return { established: true };
  },
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm nx test backend --skip-nx-cache -- qrFollow.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/establishMutualFollow.ts packages/backend/convex/social/acceptQrFollow.ts packages/backend/convex/qrFollow.test.ts
git add packages/backend/convex/social/establishMutualFollow.ts packages/backend/convex/social/acceptQrFollow.ts packages/backend/convex/qrFollow.test.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(social): mutual-follow helper + one-tap QR follow for members"
```

---

### Task 5: `redeemInvite`

**Files:**

- Create: `packages/backend/convex/social/redeemInvite.ts`
- Test: `packages/backend/convex/redeemInvite.test.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-add if needed)

- [ ] **Step 1: Write the failing tests**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const newbie = await ctx.db.insert("users", {
      clerkId: "clerk_newbie",
      email: "newbie@example.com",
      name: "Newbie",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, newbie };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asNewbie = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_newbie" });

describe("redeemInvite", () => {
  test("first redemption attributes signup and establishes the mutual follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    const result = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(result).toEqual({ redeemed: true, inviterId: alice });

    const edges = await t.run(async (ctx) => {
      const ab = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", alice).eq("followeeId", newbie),
        )
        .unique();
      const ba = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", newbie).eq("followeeId", alice),
        )
        .unique();
      return { ab: ab !== null, ba: ba !== null };
    });
    expect(edges).toEqual({ ab: true, ba: true });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(1);
  });

  test("second redemption by the same member is a no-op (idempotent)", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    await asNewbie(t).mutation(api.social.redeemInvite.redeemInvite, {
      token,
    });
    const second = await asNewbie(t).mutation(
      api.social.redeemInvite.redeemInvite,
      { token },
    );
    expect(second).toEqual({ redeemed: false });

    const link = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(link?.signupsAttributed).toBe(1);
  });

  test("revoked and self tokens are no-ops", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const { token } = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Self token
    expect(
      await asAlice(t).mutation(api.social.redeemInvite.redeemInvite, {
        token,
      }),
    ).toEqual({ redeemed: false });

    // Revoked token
    await asAlice(t).mutation(api.social.resetInviteLink.resetInviteLink, {});
    expect(
      await asNewbie(t).mutation(api.social.redeemInvite.redeemInvite, {
        token,
      }),
    ).toEqual({ redeemed: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test backend --skip-nx-cache -- redeemInvite.test.ts`
Expected: FAIL — `api.social.redeemInvite` is undefined

- [ ] **Step 3: Implement `redeemInvite.ts`**

```ts
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";

// Post-signup invite redemption: called once by the client (InviteRedeemer) when a localStorage
// token survives the Clerk redirect. Idempotent per member via inviteRedemptions.by_new_member —
// a member can only ever be attributed to one inviter. Revoked/self/unknown tokens no-op.
export const redeemInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const prior = await ctx.db
      .query("inviteRedemptions")
      .withIndex("by_new_member", (q) => q.eq("newMemberId", memberId))
      .unique();
    if (prior !== null) return { redeemed: false };

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      link.ownerId === memberId
    ) {
      return { redeemed: false };
    }

    await ctx.db.insert("inviteRedemptions", {
      inviteLinkId: link._id,
      inviterId: link.ownerId,
      newMemberId: memberId,
      createdAt: Date.now(),
    });
    await establishMutualFollow(ctx, link.ownerId, memberId);
    await ctx.db.patch(link._id, {
      signupsAttributed: link.signupsAttributed + 1,
      followsEstablished: link.followsEstablished + 1,
    });
    return { redeemed: true, inviterId: link.ownerId };
  },
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test backend --skip-nx-cache -- redeemInvite.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the whole backend suite (guard against regressions)**

Run: `pnpm nx test backend --skip-nx-cache`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write packages/backend/convex/social/redeemInvite.ts packages/backend/convex/redeemInvite.test.ts
git add packages/backend/convex/social/redeemInvite.ts packages/backend/convex/redeemInvite.test.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(social): idempotent post-signup invite redemption with attribution"
```

---

### Task 6: Gateway operations

**Files:**

- Modify: `packages/gateway/src/operations.ts` (inside the `social` block, after the `follow`/`unfollow` entries around line 253)

- [ ] **Step 1: Add the five operations**

```ts
    // Invite links / QR growth loop (Phase 3). getInviteContext + recordInviteLanding are PUBLIC
    // (unauthenticated landings); the rest require the acting member.
    myInviteLink: api.social.getMyInviteLink.getMyInviteLink,
    resetInviteLink: api.social.resetInviteLink.resetInviteLink,
    inviteContext: api.social.getInviteContext.getInviteContext,
    recordInviteLanding: api.social.recordInviteLanding.recordInviteLanding,
    redeemInvite: api.social.redeemInvite.redeemInvite,
    acceptQrFollow: api.social.acceptQrFollow.acceptQrFollow,
```

- [ ] **Step 2: Type-check the gateway + web**

Run: `pnpm nx run-many --target=type-check --projects=@jigswap/gateway,web --skip-nx-cache`
Expected: PASS (if the gateway project name differs, find it with `pnpm nx show projects | grep gateway`)

- [ ] **Step 3: Commit**

```bash
pnpm prettier --write packages/gateway/src/operations.ts
git add packages/gateway/src/operations.ts
git commit -m "feat(gateway): invite-link operations"
```

---

### Task 7: QR dialog component

**Files:**

- Create: `apps/web/src/components/social/qr-dialog.tsx`
- Modify: `apps/web/package.json` (new dep)
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json` (new `invite` namespace)

- [ ] **Step 1: Install the QR library**

Run: `pnpm --filter web add qrcode.react`
Expected: `qrcode.react` appears in `apps/web/package.json` dependencies. (~4 KB gzipped, zero deps, renders SVG — no canvas, crisp at any size.)

- [ ] **Step 2: Add locale strings**

In `apps/web/locales/en.json` (top-level, alphabetical placement near `"insights"`), and mirrored with Dutch translations in `nl.json` and source values in `source.json`:

```json
"invite": {
  "showMyQr": "Show my QR",
  "dialogTitle": "My QR code",
  "scanHint": "Have a friend scan this to follow each other",
  "copyLink": "Copy link",
  "copied": "Copied!",
  "share": "Share",
  "resetLink": "Reset invite link",
  "resetConfirm": "Old links and QR codes will stop working. Reset?",
  "needUsernameTitle": "Set a username first",
  "needUsernameBody": "Your QR caption and profile link use your username. Set one in your account settings, then come back.",
  "openSettings": "Open account settings",
  "invitedYou": "{name} invited you to JigSwap",
  "followEachOther": "{name} shared their code with you — follow each other?",
  "followEachOtherCta": "Follow each other",
  "followEstablished": "You and {name} now follow each other",
  "didSomeoneInviteTitle": "Did someone invite you?",
  "didSomeoneInviteBody": "Find them by name and follow each other.",
  "findThem": "Find them",
  "loopTitle": "Anyone else here?",
  "loopBody": "Show them this code so they can follow you too.",
  "loopSkip": "Not now"
}
```

Dutch (`nl.json`) translations:

```json
"invite": {
  "showMyQr": "Toon mijn QR",
  "dialogTitle": "Mijn QR-code",
  "scanHint": "Laat een vriend dit scannen om elkaar te volgen",
  "copyLink": "Link kopiëren",
  "copied": "Gekopieerd!",
  "share": "Delen",
  "resetLink": "Uitnodigingslink resetten",
  "resetConfirm": "Oude links en QR-codes werken dan niet meer. Resetten?",
  "needUsernameTitle": "Stel eerst een gebruikersnaam in",
  "needUsernameBody": "Je QR-bijschrift en profiellink gebruiken je gebruikersnaam. Stel er een in bij je accountinstellingen en kom dan terug.",
  "openSettings": "Accountinstellingen openen",
  "invitedYou": "{name} heeft je uitgenodigd voor JigSwap",
  "followEachOther": "{name} heeft hun code met je gedeeld — elkaar volgen?",
  "followEachOtherCta": "Elkaar volgen",
  "followEstablished": "Jij en {name} volgen elkaar nu",
  "didSomeoneInviteTitle": "Heeft iemand je uitgenodigd?",
  "didSomeoneInviteBody": "Zoek ze op naam en volg elkaar.",
  "findThem": "Zoek ze",
  "loopTitle": "Nog iemand hier?",
  "loopBody": "Laat ze deze code zien zodat ze jou ook kunnen volgen.",
  "loopSkip": "Niet nu"
}
```

- [ ] **Step 3: Implement `qr-dialog.tsx`**

```tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

// Fullscreen "show my QR" dialog. The QR encodes the STABLE member-id URL (rename-proof) with the
// invite token; the mono caption shows the human-readable username URL. The QR card is always
// white — dark mode must never invert the modules or phone cameras stop reading it.
export function QrDialog(props: {
  memberId: string;
  displayName: string;
  username: string | null | undefined;
  avatarUrl?: string | null;
}) {
  const t = useTranslations("invite");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { mutate: fetchLink, data: link } = useMutation({
    mutationFn: useConvexMutation(gateway.social.myInviteLink),
  });

  useEffect(() => {
    if (open && !link) fetchLink({});
  }, [open, link, fetchLink]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const qrUrl = link
    ? `${origin}/members/${props.memberId}?invite=${link.token}`
    : null;
  const displayUrl = props.username
    ? `${origin.replace(/^https?:\/\//, "")}/members/${props.username}`
    : null;

  const copy = () => {
    if (!qrUrl) return;
    void navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4" />
          {t("showMyQr")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-svh max-h-svh w-full max-w-full flex-col items-center justify-center gap-6 rounded-none sm:h-auto sm:max-h-[90svh] sm:max-w-md sm:rounded-lg">
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        {props.username == null ? (
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <h2 className="font-heading text-xl">{t("needUsernameTitle")}</h2>
            <p className="text-muted-foreground text-sm">
              {t("needUsernameBody")}
            </p>
            <Button asChild variant="brand">
              <Link to="/profile">{t("openSettings")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <Avatar className="size-16">
                {props.avatarUrl ? <AvatarImage src={props.avatarUrl} /> : null}
                <AvatarFallback>{props.displayName.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <span className="font-heading text-lg">{props.displayName}</span>
            </div>
            {/* Always-white card: ≥16px padding is the QR quiet zone. */}
            <div className="rounded-2xl bg-white p-5 shadow-md">
              {qrUrl ? (
                <QRCodeSVG
                  value={qrUrl}
                  size={320}
                  className="h-auto w-[min(70vw,320px)]"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              ) : (
                <div className="size-[min(70vw,320px)]" />
              )}
            </div>
            {displayUrl ? (
              <span className="text-muted-foreground font-mono text-sm">
                {displayUrl}
              </span>
            ) : null}
            <p className="text-muted-foreground text-sm">{t("scanHint")}</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={copy} disabled={!qrUrl}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? t("copied") : t("copyLink")}
              </Button>
              {canShare ? (
                <Button
                  variant="brand"
                  disabled={!qrUrl}
                  onClick={() => {
                    if (qrUrl) void navigator.share({ url: qrUrl });
                  }}
                >
                  <Share2 className="size-4" />
                  {t("share")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

> Adjust `Button` variants/`Avatar` imports to the repo's actual component APIs at implementation
> time (check `apps/web/src/components/ui/button.tsx` for whether `variant="brand"` exists — the
> marketing pages use it; if the dashboard variant differs, use `variant="default"`).

- [ ] **Step 4: Type-check**

Run: `pnpm nx run web:type-check --skip-nx-cache 2>&1 | grep -v routeTree.gen`
Expected: no errors in the new file (routeTree.gen noise is a known artifact)

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/components/social/qr-dialog.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json apps/web/package.json
git add apps/web/src/components/social/qr-dialog.tsx apps/web/locales/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): fullscreen QR dialog with copy/share and username gate"
```

---

### Task 8: Entry points — People header, own profile, reset action

**Files:**

- Modify: `apps/web/src/routes/_dashboard/people.tsx` (header actions, ~line 62)
- Modify: `apps/web/src/routes/_dashboard/profile.tsx` (header actions inside `ProfilePage`)
- Modify: `apps/web/src/components/social/profile-edit-dialog.tsx` (reset invite link row)

- [ ] **Step 1: Add the QR button to the People page header**

In `people.tsx`, the page already publishes header actions via `usePageHeaderActions`. Extend it — the QR button needs the current member, which `gateway.identity.currentUser` provides:

```tsx
import { QrDialog } from "@/components/social/qr-dialog";
// ... inside PeoplePage():
const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

usePageHeaderActions(
  () => (
    <div className="flex items-center gap-3">
      {me ? (
        <QrDialog
          memberId={me._id}
          displayName={me.name}
          username={me.username}
          avatarUrl={me.avatar}
        />
      ) : null}
      {headerMeta ? (
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {headerMeta}
        </span>
      ) : null}
    </div>
  ),
  [headerMeta, me],
);
```

> Check the actual field names on the `currentUser` DTO (`_id` vs `memberId`, `avatar` vs
> `avatarUrl`) in `packages/contracts` and adjust.

- [ ] **Step 2: Add the same QR button to the own-profile page**

In `profile.tsx`, add the identical `usePageHeaderActions` block (or place the button beside the existing edit action if the page composes its own header) with the same `QrDialog` props from the page's current-user data.

- [ ] **Step 3: Add "Reset invite link" to the profile edit dialog**

In `profile-edit-dialog.tsx`, add below the existing form fields (matching the dialog's layout):

```tsx
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
// ... inside the dialog component:
const t = useTranslations("invite");
const { mutate: resetLink } = useMutation({
  mutationFn: useConvexMutation(gateway.social.resetInviteLink),
  onSuccess: () => toast.success(t("resetLink")),
});

// In the JSX, after the profile fields:
<Button
  type="button"
  variant="outline"
  size="sm"
  onClick={() => {
    if (window.confirm(t("resetConfirm"))) resetLink({});
  }}
>
  {t("resetLink")}
</Button>;
```

> If the repo has a `ConfirmDialog` component (the admin console added confirm dialogs), use it
> instead of `window.confirm` — search `apps/web/src/components` for `confirm`.

- [ ] **Step 4: Verify in the running app**

Run: `pnpm dev:web` (serves on :3001), sign in, open /people → "Show my QR" renders the dialog with a scannable code; /profile shows the same entry; the edit dialog shows the reset action.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/people.tsx apps/web/src/routes/_dashboard/profile.tsx apps/web/src/components/social/profile-edit-dialog.tsx
git add apps/web/src/routes/_dashboard/people.tsx apps/web/src/routes/_dashboard/profile.tsx apps/web/src/components/social/profile-edit-dialog.tsx
git commit -m "feat(web): QR entry points on People + profile, invite-link reset"
```

---

### Task 9: Invite-aware landing on `/members/$handle`

**Files:**

- Modify: `apps/web/src/routes/members.$handle.tsx` (the Phase 1 route)

- [ ] **Step 1: Add the `invite` search param**

```tsx
import { z } from "zod";

export const Route = createFileRoute("/members/$handle")({
  validateSearch: z.object({
    invite: z.string().optional(),
  }),
  // ...existing head/loader/component config stays
});
```

- [ ] **Step 2: Wire the invite context into the page component**

Inside the route component (which already resolves the viewed member + viewer auth state from Phase 1 — adapt names to what Phase 1 shipped):

```tsx
const { invite } = Route.useSearch();
const { data: inviteContext } = useQuery({
  ...convexQuery(gateway.social.inviteContext, {
    token: invite ?? "",
    memberId: member._id,
  }),
  enabled: invite !== undefined,
});
const inviteValid = inviteContext?.valid === true;
```

- [ ] **Step 3: Logged-out behavior — persist token, count landing, reframe teaser**

```tsx
const { mutate: recordLanding } = useMutation({
  mutationFn: useConvexMutation(gateway.social.recordInviteLanding),
});

// Persist the token BEFORE any sign-up redirect (attribution survival) and count the landing
// once per browser session. Only for valid tokens — revoked ones degrade silently.
useEffect(() => {
  if (!invite || !inviteValid || isAuthenticated) return;
  window.localStorage.setItem("jigswap.invite", invite);
  const sessionKey = `jigswap.inviteLanded.${invite}`;
  if (window.sessionStorage.getItem(sessionKey) === null) {
    window.sessionStorage.setItem(sessionKey, "1");
    recordLanding({ token: invite });
  }
}, [invite, inviteValid, isAuthenticated, recordLanding]);
```

In the logged-out teaser JSX (Phase 1), when `inviteValid`, replace the standard subtitle with the framing headline and make sign-up the only primary button:

```tsx
{
  inviteValid ? (
    <h2 className="font-heading text-xl">
      {t("invitedYou", { name: member.displayName })}
    </h2>
  ) : null;
}
```

The sign-up CTA must carry the return path (Phase 1 established the `redirect_url` convention from `lib/require-auth.ts`):

```tsx
<Link
  to="/sign-up/$"
  params={{ _splat: "" }}
  search={{ redirect_url: location.href }}
>
```

- [ ] **Step 4: Logged-in behavior — one-tap mutual follow prompt**

Add a small card rendered above the profile/interstitial content when the viewer is authenticated, `inviteValid`, and the profile is not their own:

```tsx
function QrFollowPrompt(props: { token: string; name: string }) {
  const t = useTranslations("invite");
  const [done, setDone] = useState(false);
  const { mutate: accept, isPending } = useMutation({
    mutationFn: useConvexMutation(gateway.social.acceptQrFollow),
    onSuccess: (result) => {
      if (result.established) {
        setDone(true);
        toast.success(t("followEstablished", { name: props.name }));
      }
    },
  });
  if (done) return null;
  return (
    <div className="border-border bg-card flex items-center justify-between gap-4 rounded-lg border p-4">
      <p className="text-sm">{t("followEachOther", { name: props.name })}</p>
      <Button
        variant="brand"
        size="sm"
        disabled={isPending}
        onClick={() => accept({ token: props.token })}
      >
        {t("followEachOtherCta")}
      </Button>
    </div>
  );
}
```

`acceptQrFollow` silently returns `{ established: false }` for own/invalid tokens, so no extra client-side guards are load-bearing — but don't render the prompt at all unless `inviteValid && !isSelf` (no point showing UI that will no-op).

- [ ] **Step 5: Verify in the running app**

With `pnpm dev:web`: copy your invite URL from the QR dialog, open it in a private window → teaser shows the "invited you" framing; open it as a second signed-in test user → the one-tap prompt appears and tapping it makes both profiles show "You follow each other".

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write apps/web/src/routes/members.\$handle.tsx
git add apps/web/src/routes/members.\$handle.tsx
git commit -m "feat(web): invite-aware landing states on member profile"
```

---

### Task 10: `InviteRedeemer` — post-signup redemption, fallback, loop closure

**Files:**

- Create: `apps/web/src/components/social/invite-redeemer.tsx`
- Modify: `apps/web/src/routes/_dashboard/route.tsx` (mount it in the authed layout)

- [ ] **Step 1: Implement `invite-redeemer.tsx`**

```tsx
import { QrDialog } from "@/components/social/qr-dialog";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const INVITE_KEY = "jigswap.invite";
const LOOP_SHOWN_KEY = "jigswap.inviteLoopShown";
const FALLBACK_SHOWN_KEY = "jigswap.inviteFallbackShown";
const NEW_MEMBER_WINDOW_MS = 15 * 60 * 1000;

// Mounted once in the authed dashboard layout. Three jobs, all one-shot:
// 1. Redeem a localStorage invite token that survived the Clerk redirect (attribution).
// 2. Loop closure: after a successful redemption, offer the new member their OWN QR (skippable).
// 3. Fallback: brand-new member with NO token (cross-device scan, private mode) gets a one-time
//    "did someone invite you?" nudge toward people search.
export function InviteRedeemer() {
  const t = useTranslations("invite");
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const [showLoopQr, setShowLoopQr] = useState(false);
  const ran = useRef(false);

  const { mutate: redeem } = useMutation({
    mutationFn: useConvexMutation(gateway.social.redeemInvite),
    onSuccess: (result) => {
      if (
        result.redeemed &&
        window.localStorage.getItem(LOOP_SHOWN_KEY) === null
      ) {
        window.localStorage.setItem(LOOP_SHOWN_KEY, "1");
        setShowLoopQr(true);
      }
    },
  });

  useEffect(() => {
    if (!me || ran.current) return;
    ran.current = true;

    const token = window.localStorage.getItem(INVITE_KEY);
    if (token !== null) {
      window.localStorage.removeItem(INVITE_KEY);
      redeem({ token });
      return;
    }

    // Fallback nudge: only for members created in the last 15 minutes, once ever.
    const isNew = Date.now() - me.createdAt < NEW_MEMBER_WINDOW_MS;
    if (isNew && window.localStorage.getItem(FALLBACK_SHOWN_KEY) === null) {
      window.localStorage.setItem(FALLBACK_SHOWN_KEY, "1");
      toast(t("didSomeoneInviteTitle"), {
        description: t("didSomeoneInviteBody"),
        action: (
          <Link to="/people" className="text-sm font-medium underline">
            {t("findThem")}
          </Link>
        ),
        duration: 15000,
      });
    }
  }, [me, redeem, t]);

  if (!me || !showLoopQr) return null;

  // Loop closure: the new member's own QR, shown once, skippable (Dialog close = skip).
  return (
    <QrDialogAutoOpen
      memberId={me._id}
      displayName={me.name}
      username={me.username}
      avatarUrl={me.avatar}
      title={t("loopTitle")}
      body={t("loopBody")}
      onClose={() => setShowLoopQr(false)}
    />
  );
}
```

`QrDialogAutoOpen` is a thin variant: refactor `qr-dialog.tsx` so the dialog body is a shared
`QrDialogContent` component, and export both `QrDialog` (trigger-button version, Task 7) and
`QrDialogAutoOpen` (controlled-open version with a heading/body line above the avatar and no
trigger). Keep the QR card, caption, and actions identical — one implementation, two shells:

```tsx
export function QrDialogAutoOpen(props: {
  memberId: string;
  displayName: string;
  username: string | null | undefined;
  avatarUrl?: string | null;
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="...same classes as QrDialog...">
        <DialogTitle className="font-heading text-xl">
          {props.title}
        </DialogTitle>
        <p className="text-muted-foreground text-sm">{props.body}</p>
        <QrDialogContent {...props} />
        <Button variant="ghost" onClick={props.onClose}>
          {useTranslations("invite")("loopSkip")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

(Hoist the `useTranslations` call to the component top — hooks can't be called inline in JSX; the snippet marks intent, write it correctly.)

- [ ] **Step 2: Mount it in the dashboard layout**

In `apps/web/src/routes/_dashboard/route.tsx`, render `<InviteRedeemer />` once inside the layout component, next to the `<Outlet />`:

```tsx
import { InviteRedeemer } from "@/components/social/invite-redeemer";
// ... in the layout JSX:
<InviteRedeemer />;
```

- [ ] **Step 3: Verify the full loop in the running app**

With `pnpm dev:web` and two browsers:

1. Browser A (member): open the QR dialog, copy the invite URL.
2. Browser B (private window): open the URL → invited-you teaser → sign up as a new user → land back, `InviteRedeemer` fires → both members now mutually follow (check /people in both browsers) → the loop-closure QR dialog appears once for the new member and is skippable.
3. Clear site data in browser B, sign in again → nothing fires (idempotent).

- [ ] **Step 4: Run web checks**

Run: `pnpm nx run web:type-check --skip-nx-cache 2>&1 | grep -v routeTree.gen` and `pnpm nx lint web --skip-nx-cache`
Expected: PASS (modulo known routeTree.gen noise)

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/components/social/invite-redeemer.tsx apps/web/src/components/social/qr-dialog.tsx apps/web/src/routes/_dashboard/route.tsx
git add apps/web/src/components/social/invite-redeemer.tsx apps/web/src/components/social/qr-dialog.tsx apps/web/src/routes/_dashboard/route.tsx
git commit -m "feat(web): post-signup invite redemption, fallback nudge, loop-closure QR"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full backend suite**

Run: `pnpm nx test backend --skip-nx-cache`
Expected: PASS, including the 9 new tests across `inviteLinks`, `inviteLanding`, `qrFollow`, `redeemInvite`

- [ ] **Step 2: Full repo checks**

Run: `pnpm nx run-many --target=type-check --all --skip-nx-cache && pnpm nx run-many --target=lint --all --skip-nx-cache && pnpm format:check`
Expected: PASS (fix any prettier drift with `pnpm format`)

- [ ] **Step 3: End-to-end walkthrough (manual, on :3001)**

The four landing states: logged-out + valid token (invited framing), logged-out + revoked token (plain teaser, no error), logged-in + foreign valid token (one-tap prompt), logged-in own token (nothing). Then the reset flow: reset invite link → old QR URL degrades to plain teaser.

- [ ] **Step 4: Commit any stragglers and hand off**

Per repo convention, finish via PR (`superpowers:finishing-a-development-branch`).

---

## Self-review notes (already applied)

- **Spec coverage:** stable-id QR URL ✔, username gate ✔, white QR card + quiet zone + mono caption + copy/share ✔, landing states ×4 ✔, localStorage attribution + sessionStorage landing dedupe ✔, redeem idempotency via `inviteRedemptions` ✔, mutual follow with request auto-approve ✔, counters (views/signups/follows) ✔, fallback nudge ✔, skippable one-time loop closure ✔, reset in profile settings ✔. Deep-linking the fallback nudge to `?tab=find` is a Phase 4 follow-up (link goes to `/people` for now) — noted in Phase 4's plan inputs.
- **Type consistency:** `establishMutualFollow(ctx, a, b)` used identically in Tasks 4 and 5; `{ token }` return shape shared by `getMyInviteLink`/`resetInviteLink`; `{ established }` for `acceptQrFollow`; `{ redeemed, inviterId? }` for `redeemInvite`.
- **Known verify-at-implementation points (flagged inline):** Phase 2 `followRequests` field names, `currentUser` DTO field names, `Button` variant names, ConfirmDialog availability. These depend on Phase 1/2 code that doesn't exist yet — the implementer must check the merged code, not guess.
