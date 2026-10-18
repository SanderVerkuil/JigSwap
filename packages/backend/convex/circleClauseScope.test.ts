import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { collectCircleSharedCopies } from "./library/circleSharedCopies";
import schema from "./schema";

// #181: the circle clause must be scoped to a circle the copy was actually shared into, that the
// viewer is CURRENTLY a member of (circleMembers junction only) and that the copy's owner is
// currently a member of. Sharing into circle A must never expose the copy to members of circle B,
// and a stale share row (owner no longer in A) must expose nothing.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };
const NOW = 1_000_000;

type Users = {
  owner: Id<"users">;
  viewerA: Id<"users">;
  viewerB: Id<"users">;
};

const mkUser = (ctx: MutationCtx, clerkId: string, name: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
    username: clerkId,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

// A circle row whose embedded memberships list `listed`, with a circleMembers junction row only for
// `joined` (a listed-but-not-joined member models a pending/stale seat that must not count).
const mkCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  ownerId: Id<"users">,
  listed: Id<"users">[],
  joined: Id<"users">[],
) => {
  await ctx.db.insert("circles", {
    aggregateId,
    ownerId,
    name: aggregateId,
    memberships: listed.map((memberId, i) => ({
      id: `${aggregateId}-m${i}`,
      memberId,
      permission: "ViewOnly" as const,
      joinedAt: NOW,
    })),
    createdAt: NOW,
  });
  for (const memberId of joined) {
    await ctx.db.insert("circleMembers", {
      circleAggregateId: aggregateId,
      memberId,
    });
  }
};

// Seed a PRIVATE owner (no follows, so no mutual/public path), two viewers, a puzzle and one copy
// shared into circle "A". Each test wires the circles it needs via `circles`.
const seed = async (
  t: TestConvex<typeof schema>,
  availability: typeof OPEN,
  circles: (ctx: MutationCtx, u: Users) => Promise<void>,
) =>
  t.run(async (ctx) => {
    const owner = await mkUser(ctx, "clerk_owner", "Hidden Owner");
    const viewerA = await mkUser(ctx, "clerk_a", "Viewer A");
    const viewerB = await mkUser(ctx, "clerk_b", "Viewer B");
    await ctx.db.insert("profiles", {
      memberId: owner,
      displayName: "Hidden Owner",
      visibility: "private",
      updatedAt: NOW,
    });
    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Lighthouse",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-1",
      puzzleId: puzzle,
      ownerId: owner,
      condition: "good",
      availability,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("circleCopyShares", {
      circleId: "A",
      copyId: "copy-1",
      sharedAt: NOW,
    });
    const users = { owner, viewerA, viewerB };
    await circles(ctx, users);
    return { ...users, puzzle, copy };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const as = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });

// Every read surface the circle clause feeds, for one viewer: canViewCopy (getCopyInstanceView),
// browse and the definition view. Returns whether the copy is reachable on each, plus the raw
// browse/definition payloads for leak checks.
const surfaces = async (
  t: TestConvex<typeof schema>,
  clerkId: string,
  s: Seeded,
) => {
  const viewer = as(t, clerkId);
  const instance = await viewer.query(
    api.library.getCopyInstanceView.getCopyInstanceView,
    { copyId: s.copy },
  );
  const browse = await viewer.query(
    api.library.browseOwnedPuzzles.browseOwnedPuzzles,
    {},
  );
  const definition = await viewer.query(
    api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
    { puzzleId: s.puzzle },
  );
  return {
    instance: instance !== null,
    browse: browse.ownedPuzzles.some((c) => c._id === s.copy),
    definition: (definition?.availableCopies ?? []).some(
      (c) => c.copyId === (s.copy as string),
    ),
    payload: JSON.stringify({ browse, definition }),
  };
};

const expectHidden = (r: Awaited<ReturnType<typeof surfaces>>, s: Seeded) => {
  expect(r.instance).toBe(false);
  expect(r.browse).toBe(false);
  expect(r.definition).toBe(false);
  expect(r.payload).not.toContain(s.copy as string);
  expect(r.payload).not.toContain(s.owner as string);
  expect(r.payload).not.toContain("Hidden Owner");
  expect(r.payload).not.toContain("clerk_owner");
};

const collectIds = async (t: TestConvex<typeof schema>, viewer: Id<"users">) =>
  t.run(async (ctx) =>
    (await collectCircleSharedCopies(ctx, viewer)).map((c) => c.aggregateId),
  );

describe("circle clause is scoped to the circle the copy was shared into (#181)", () => {
  test("shared into A: an A member sees the open copy on every surface", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, OPEN, async (ctx, u) => {
      await mkCircle(
        ctx,
        "A",
        u.owner,
        [u.owner, u.viewerA],
        [u.owner, u.viewerA],
      );
    });
    const r = await surfaces(t, "clerk_a", s);
    expect(r.instance).toBe(true);
    expect(r.browse).toBe(true);
    expect(r.definition).toBe(true);
  });

  test("shared into A: a member of B only (B also holds the owner) does not see it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, OPEN, async (ctx, u) => {
      await mkCircle(
        ctx,
        "A",
        u.owner,
        [u.owner, u.viewerA],
        [u.owner, u.viewerA],
      );
      await mkCircle(
        ctx,
        "B",
        u.owner,
        [u.owner, u.viewerB],
        [u.owner, u.viewerB],
      );
    });
    expectHidden(await surfaces(t, "clerk_b", s), s);
    expect(await collectIds(t, s.viewerB)).toEqual([]);
  });

  test("non-open copy: collectCircleSharedCopies counts only a circle it was shared into that also holds the owner", async () => {
    const t = convexTest(schema, modules);
    // Viewer A is in A (where the copy is shared) and in B with the owner; the owner is NOT in A.
    // The common circle B must not stand in for A.
    const s = await seed(t, CLOSED, async (ctx, u) => {
      await mkCircle(ctx, "A", u.viewerA, [u.viewerA], [u.viewerA]);
      await mkCircle(
        ctx,
        "B",
        u.owner,
        [u.owner, u.viewerA],
        [u.owner, u.viewerA],
      );
    });
    expect(await collectIds(t, s.viewerA)).toEqual([]);
  });

  test("non-open copy: shared into A with owner and viewer both in A is collected", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, CLOSED, async (ctx, u) => {
      await mkCircle(
        ctx,
        "A",
        u.owner,
        [u.owner, u.viewerA],
        [u.owner, u.viewerA],
      );
    });
    expect(await collectIds(t, s.viewerA)).toEqual(["copy-1"]);
  });

  test("stale share: open copy shared into A after the owner left A is hidden from A members", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, OPEN, async (ctx, u) => {
      await mkCircle(ctx, "A", u.viewerA, [u.viewerA], [u.viewerA]);
    });
    expectHidden(await surfaces(t, "clerk_a", s), s);
    expect(await collectIds(t, s.viewerA)).toEqual([]);
  });

  test("an owner listed in A's memberships without a circleMembers row does not count", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, OPEN, async (ctx, u) => {
      await mkCircle(ctx, "A", u.viewerA, [u.owner, u.viewerA], [u.viewerA]);
    });
    expectHidden(await surfaces(t, "clerk_a", s), s);
  });

  test("a viewer listed in A's memberships without a circleMembers row does not count", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, OPEN, async (ctx, u) => {
      await mkCircle(ctx, "A", u.owner, [u.owner, u.viewerA], [u.owner]);
    });
    expectHidden(await surfaces(t, "clerk_a", s), s);
    expect(await collectIds(t, s.viewerA)).toEqual([]);
  });
});
