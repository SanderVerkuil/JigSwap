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

// The whole error payload a refused call answers with (code AND message), to compare refusals.
const refusalOf = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return dataOf(error);
};

// A block row written directly (blockMember's side effects are not under test here).
const insertBlock = (
  t: TestConvex<typeof schema>,
  s: Seeded,
  blocker: "owner" | "requester",
) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", {
      blockerId: blocker === "owner" ? s.owner : s.requester,
      blockedId: blocker === "owner" ? s.requester : s.owner,
      createdAt: NOW,
    }),
  );

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

  // A block must not be distinguishable from having no route (SEC-85): the blocked member gets the
  // very same refusal a stranger gets, never a block-specific one.
  describe("a pair blocked either way gets exactly the stranger's refusal", () => {
    for (const blocker of ["owner", "requester"] as const) {
      test(`blocked by the ${blocker}`, async () => {
        const t = convexTest(schema, modules);
        const s = await seed(t);
        // A shared circle is a route a block does not sever, so only the block stands between
        // the requester and the copy.
        await shareViaCircle(t, s);
        await insertBlock(t, s, blocker);
        await t.run((ctx) => mkUser(ctx, "clerk_stranger"));

        const blocked = await refusalOf(propose(t, s));
        const stranger = await refusalOf(
          t
            .withIdentity({ subject: "clerk_stranger" })
            .mutation(api.exchange.propose.propose, {
              type: "sale",
              requestedPuzzleId: s.copy,
              salePrice: 10,
            }),
        );
        expect(stranger.code).toBe("CopyNotReachable");
        expect(blocked).toEqual(stranger);
        const rows = await t.run((ctx) => ctx.db.query("exchanges").collect());
        expect(rows).toHaveLength(0);
      });
    }

    // The member holding the copy passes canViewCopy whatever the block, so propose checks the
    // block separately after it, and answers it the same way.
    test("even for the member holding the copy", async () => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      await t.run((ctx) => ctx.db.patch(s.copy, { heldBy: s.requester }));
      await insertBlock(t, s, "owner");

      await expectCode(propose(t, s), "CopyNotReachable");
      const rows = await t.run((ctx) => ctx.db.query("exchanges").collect());
      expect(rows).toHaveLength(0);
    });
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
