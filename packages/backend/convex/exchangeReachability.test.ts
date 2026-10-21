import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Reachability: a member may only propose an exchange on (or list offerable copies against) a copy
// they could see through canViewCopy. A stranger with no route to a private owner's copy is refused
// with CopyNotReachable; every legitimate route (public profile + open copy, a circle holding the
// share, mutual follow, household) still works.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NOW = 1_000_000;
const FOR_SALE = { forTrade: false, forSale: true, forLend: false };

const mkUser = (ctx: MutationCtx, clerkId: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: clerkId,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

// An owner (private profile unless `publicOwner`) with one copy for sale, and a requester with no
// relationship to them. Each test adds the route it needs.
const seed = async (t: TestConvex<typeof schema>, publicOwner = false) =>
  t.run(async (ctx) => {
    const owner = await mkUser(ctx, "clerk_owner");
    const requester = await mkUser(ctx, "clerk_requester");
    await ctx.db.insert("profiles", {
      memberId: owner,
      displayName: "Owner",
      visibility: publicOwner ? "public" : "private",
      updatedAt: NOW,
    });
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
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
      availability: FOR_SALE,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { owner, requester, copy };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const shareViaCircle = (t: TestConvex<typeof schema>, s: Seeded) =>
  t.run(async (ctx) => {
    await ctx.db.insert("circles", {
      aggregateId: "circle-1",
      ownerId: s.owner,
      name: "Friends",
      memberships: [
        { id: "m0", memberId: s.owner, permission: "Admin", joinedAt: NOW },
        {
          id: "m1",
          memberId: s.requester,
          permission: "Exchange",
          joinedAt: NOW,
        },
      ],
      createdAt: NOW,
    });
    for (const memberId of [s.owner, s.requester]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-1",
        memberId,
      });
    }
    await ctx.db.insert("circleCopyShares", {
      circleId: "circle-1",
      copyId: "copy-1",
      sharedAt: NOW,
    });
  });

const followMutually = (t: TestConvex<typeof schema>, s: Seeded) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: s.owner,
      followeeId: s.requester,
      createdAt: NOW,
    });
    await ctx.db.insert("follows", {
      followerId: s.requester,
      followeeId: s.owner,
      createdAt: NOW,
    });
  });

const shareHousehold = (t: TestConvex<typeof schema>, s: Seeded) =>
  t.run(async (ctx) => {
    await ctx.db.insert("households", { aggregateId: "hh-1", createdAt: NOW });
    await ctx.db.insert("householdMembers", {
      householdId: "hh-1",
      memberId: s.owner,
      role: "admin",
      joinedAt: NOW,
    });
    await ctx.db.insert("householdMembers", {
      householdId: "hh-1",
      memberId: s.requester,
      role: "member",
      joinedAt: NOW,
    });
  });

const propose = (t: TestConvex<typeof schema>, s: Seeded) =>
  t
    .withIdentity({ subject: "clerk_requester" })
    .mutation(api.exchange.propose.propose, {
      type: "sale",
      requestedPuzzleId: s.copy,
      salePrice: 10,
    });

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

describe("exchange.propose reachability", () => {
  test("a stranger with no route to a private owner's copy is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expectCode(propose(t, s), "CopyNotReachable");
    const rows = await t.run((ctx) => ctx.db.query("exchanges").collect());
    expect(rows).toHaveLength(0);
  });

  test("a public owner's open copy stays reachable", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, true);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("a copy shared into a circle both are members of stays reachable", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareViaCircle(t, s);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("mutual followers stay reachable", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await followMutually(t, s);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("household mates stay reachable", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareHousehold(t, s);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });
});

describe("exchange.getOfferableCopies reachability", () => {
  const offerable = (t: TestConvex<typeof schema>, s: Seeded) =>
    t
      .withIdentity({ subject: "clerk_requester" })
      .query(api.exchange.getOfferableCopies.getOfferableCopies, {
        requestedPuzzleId: s.copy,
      });

  const addRequesterCopy = (t: TestConvex<typeof schema>, s: Seeded) =>
    t.run(async (ctx) => {
      const puzzle = await ctx.db.insert("puzzles", {
        title: "Harbour",
        pieceCount: 500,
        status: "approved",
        submittedBy: s.requester,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId: s.requester,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

  test("lists nothing against a copy the viewer cannot reach", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await addRequesterCopy(t, s);
    expect(await offerable(t, s)).toEqual([]);
  });

  test("lists the viewer's copies against a reachable copy", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareViaCircle(t, s);
    const mine = await addRequesterCopy(t, s);
    expect((await offerable(t, s)).map((r) => r._id)).toEqual([mine]);
  });
});
